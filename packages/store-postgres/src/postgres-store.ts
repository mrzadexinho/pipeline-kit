import type { Atom, PipelineContext, RetryPolicy, StoreError } from '@idriszade/core';
import {
  err,
  type ListResult,
  ok,
  type Result,
  type Store,
  type StoreFilters,
} from '@idriszade/core';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ZodType } from 'zod';
import { atomsTable } from './atom-table.js';
import { checkIdempotencyCache, writeIdempotencyCache } from './idempotency-cache.js';

export interface PostgresStoreConfig<T> {
  id?: string;
  connectionString?: string;
  schema: ZodType<T>;
  idempotencyTtlMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface PostgresStore<T> extends Store<T> {
  readonly id: string;
  readonly schema: ZodType<T>;
  /** @internal — exposed for test injection only */
  _setDb(mockDb: PostgresJsDatabase): void;
}

function makeStoreError(type: StoreError['type'], code: string, message: string): StoreError {
  return { type, code, message } as StoreError;
}

function classifyDbError(e: unknown): StoreError {
  if (!(e instanceof Error)) {
    return makeStoreError('unknown', 'db_unknown', String(e));
  }
  const msg = e.message.toLowerCase();

  if (
    msg.includes('econnrefused') ||
    msg.includes('connection refused') ||
    msg.includes('connect econnrefused') ||
    msg.includes('connection reset') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach')
  ) {
    return makeStoreError('transient', 'db_connection_refused', e.message);
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return makeStoreError('timeout', 'db_timeout', e.message);
  }
  if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('violates unique')) {
    return makeStoreError('validation', 'db_unique_violation', e.message);
  }
  if (
    msg.includes('auth') ||
    msg.includes('password') ||
    msg.includes('role') ||
    msg.includes('permission')
  ) {
    return makeStoreError('auth', 'db_auth_error', e.message);
  }
  return makeStoreError('unknown', 'db_unknown', e.message);
}

function rowToAtom<T>(
  row: typeof atomsTable.$inferSelect,
  schema: ZodType<T>,
): Result<Atom<T>, StoreError> {
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) {
    return err(makeStoreError('validation', 'schema_mismatch', parsed.error.message));
  }

  const result: Atom<T> = {
    id: row.id,
    object: 'atom' as const,
    created_at: row.created_at.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    data: parsed.data,
    source_id: row.source_id ?? undefined,
    stage_id: row.stage_id ?? undefined,
    run_id: row.run_id ?? undefined,
  };
  return ok(result);
}

function atomToRow(a: Atom<unknown>): typeof atomsTable.$inferInsert {
  return {
    id: a.id,
    object: a.object,
    created_at: new Date(a.created_at),
    metadata: a.metadata,
    data: a.data,
    source_id: a.source_id ?? null,
    stage_id: a.stage_id ?? null,
    run_id: a.run_id ?? null,
  };
}

let _storeCounter = 0;

function generateStoreId(): string {
  _storeCounter += 1;
  return `pk_store_${Date.now().toString(36)}_${_storeCounter}`;
}

export function createPostgresStore<T>(config: PostgresStoreConfig<T>): PostgresStore<T> {
  const connectionString = config.connectionString ?? process.env.PG_CONNECTION ?? '';

  if (!connectionString) {
    throw new Error(
      'PostgresStoreConfig: connectionString required (or set PG_CONNECTION env var)',
    );
  }

  const resolvedId = config.id ?? generateStoreId();

  // Lazy db instance — created on first put/get/list so tests can inject before first use
  let db: PostgresJsDatabase | undefined;

  function getDb(): PostgresJsDatabase {
    if (db !== undefined) return db;
    db = drizzle(connectionString);
    return db;
  }

  function _setDb(mockDb: PostgresJsDatabase): void {
    db = mockDb;
  }

  async function put(a: Atom<T>, ctx: PipelineContext): Promise<Result<Atom<T>, StoreError>> {
    const d = getDb();

    try {
      // Idempotency check
      if (ctx.idempotencyKey !== undefined) {
        const cacheResult = await checkIdempotencyCache(d, ctx.idempotencyKey);
        if (cacheResult.found) {
          // Return the atom as-is — idempotent success
          return ok(a);
        }
      }

      const row = atomToRow(a as Atom<unknown>);
      await d
        .insert(atomsTable)
        .values(row)
        .onConflictDoUpdate({
          target: atomsTable.id,
          set: {
            object: row.object,
            created_at: row.created_at,
            metadata: row.metadata,
            data: row.data,
            source_id: row.source_id,
            stage_id: row.stage_id,
            run_id: row.run_id,
          },
        });

      // Write idempotency cache entry on success
      if (ctx.idempotencyKey !== undefined) {
        await writeIdempotencyCache(d, ctx.idempotencyKey, a.id);
      }

      return ok(a);
    } catch (e) {
      return err(classifyDbError(e));
    }
  }

  async function get(
    id: string,
    _ctx: PipelineContext,
  ): Promise<Result<Atom<T> | null, StoreError>> {
    const d = getDb();

    try {
      const rows = await d.select().from(atomsTable).where(eq(atomsTable.id, id)).limit(1);
      const row = rows[0];
      if (row === undefined) {
        return ok(null);
      }
      return rowToAtom(row, config.schema);
    } catch (e) {
      return err(classifyDbError(e));
    }
  }

  async function list(
    filters: StoreFilters,
    _ctx: PipelineContext,
  ): Promise<Result<ListResult<Atom<T>>, StoreError>> {
    const d = getDb();
    const limit = filters.limit ?? 20;
    const offset = filters.cursor !== undefined ? Number(filters.cursor) : 0;

    try {
      const rows = await d
        .select()
        .from(atomsTable)
        .orderBy(atomsTable.created_at)
        .limit(limit + 1)
        .offset(offset);

      const has_more = rows.length > limit;
      const pageRows = has_more ? rows.slice(0, limit) : rows;

      const items: Atom<T>[] = [];
      for (const row of pageRows) {
        const result = rowToAtom(row, config.schema);
        if (result.error !== null) {
          return err(result.error);
        }
        items.push(result.data);
      }

      const nextOffset = offset + pageRows.length;
      return ok({
        items,
        has_more,
        cursor: has_more ? String(nextOffset) : undefined,
      });
    } catch (e) {
      return err(classifyDbError(e));
    }
  }

  return {
    id: resolvedId,
    schema: config.schema,
    put,
    get,
    list,
    _setDb,
  };
}
