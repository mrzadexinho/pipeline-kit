import type { Atom, PipelineContext, RetryPolicy, StoreError } from '@idriszade/core';
import {
  err,
  type ListResult,
  ok,
  type Result,
  type Store,
  type StoreFilters,
} from '@idriszade/core';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import type { ZodType } from 'zod';
import {
  type AtomsTable,
  atomsTable as defaultAtomsTable,
  idempotencyTable as defaultIdempotencyTable,
} from './atom-table.js';

export interface SqliteStoreConfig<T> {
  id?: string;
  path: string;
  schema: ZodType<T>;
  /** Override the default `pipeline_atoms` table (e.g. from `defineAtomTable`). */
  table?: AtomsTable;
  /** Override the default `pipeline_idempotency_cache` table. */
  idempotencyTable?: typeof defaultIdempotencyTable;
  idempotencyTtlMs?: number; // default 86_400_000 — TTL eviction not yet implemented; reserved for M1
  retryPolicy?: Partial<RetryPolicy>;
}

export interface SqliteStore<T> extends Store<T> {
  readonly id: string;
  readonly schema: ZodType<T>;
  /** @internal — exposed for test injection only */
  _setDb(mockDb: BetterSQLite3Database): void;
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
  row: typeof defaultAtomsTable.$inferSelect,
  schema: ZodType<T>,
): Result<Atom<T>, StoreError> {
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) {
    return err(makeStoreError('validation', 'schema_mismatch', parsed.error.message));
  }

  const result: Atom<T> = {
    id: row.id,
    object: 'atom' as const,
    created_at: row.created_at,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    data: parsed.data,
    source_id: row.source_id ?? undefined,
    stage_id: row.stage_id ?? undefined,
    run_id: row.run_id ?? undefined,
  };
  return ok(result);
}

function normalizeJson(v: unknown): unknown {
  // Drizzle's better-sqlite3 driver checks constructor for JSON columns,
  // which throws if the value is a null-prototype object (e.g. from fast-check).
  // Round-tripping through JSON gives a plain object with a real prototype.
  return JSON.parse(JSON.stringify(v));
}

function atomToRow(a: Atom<unknown>): typeof defaultAtomsTable.$inferInsert {
  return {
    id: a.id,
    object: a.object,
    created_at: a.created_at,
    metadata:
      a.metadata !== undefined ? (normalizeJson(a.metadata) as Record<string, unknown>) : null,
    data: normalizeJson(a.data),
    source_id: a.source_id ?? null,
    stage_id: a.stage_id ?? null,
    run_id: a.run_id ?? null,
  };
}

function checkIdempotencyCache(
  db: BetterSQLite3Database,
  idemTable: typeof defaultIdempotencyTable,
  key: string,
): { found: true; atomId: string } | { found: false } {
  const row = db.select().from(idemTable).where(eq(idemTable.key, key)).limit(1).get();

  if (row !== undefined) {
    return { found: true, atomId: row.atom_id };
  }
  return { found: false };
}

function writeIdempotencyCache(
  db: BetterSQLite3Database,
  idemTable: typeof defaultIdempotencyTable,
  key: string,
  atomId: string,
): void {
  db.insert(idemTable)
    .values({
      key,
      atom_id: atomId,
      created_at: new Date(),
    })
    .onConflictDoNothing()
    .run();
}

let _storeCounter = 0;

function generateStoreId(): string {
  _storeCounter += 1;
  return `pk_store_${Date.now().toString(36)}_${_storeCounter}`;
}

function buildStore<T>(
  config: SqliteStoreConfig<T>,
  getDb: () => BetterSQLite3Database,
  setDb: (db: BetterSQLite3Database) => void,
  resolvedId: string,
): SqliteStore<T> {
  const atoms = config.table ?? defaultAtomsTable;
  const idem = config.idempotencyTable ?? defaultIdempotencyTable;

  async function put(a: Atom<T>, ctx: PipelineContext): Promise<Result<Atom<T>, StoreError>> {
    const d = getDb();

    try {
      if (ctx.idempotencyKey !== undefined) {
        const cacheResult = checkIdempotencyCache(d, idem, ctx.idempotencyKey);
        if (cacheResult.found) {
          return ok(a);
        }
      }

      const row = atomToRow(a as Atom<unknown>);
      d.insert(atoms)
        .values(row)
        .onConflictDoUpdate({
          target: atoms.id,
          set: {
            object: row.object,
            created_at: row.created_at,
            metadata: row.metadata,
            data: row.data,
            source_id: row.source_id,
            stage_id: row.stage_id,
            run_id: row.run_id,
          },
        })
        .run();

      if (ctx.idempotencyKey !== undefined) {
        writeIdempotencyCache(d, idem, ctx.idempotencyKey, a.id);
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
      const row = d.select().from(atoms).where(eq(atoms.id, id)).limit(1).get();
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
      const rows = d
        .select()
        .from(atoms)
        .orderBy(atoms.created_at)
        .limit(limit + 1)
        .offset(offset)
        .all();

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
    _setDb: setDb,
  };
}

export function createSqliteStore<T>(config: SqliteStoreConfig<T>): SqliteStore<T> {
  const resolvedId = config.id ?? generateStoreId();

  let db: BetterSQLite3Database | undefined;

  function getDb(): BetterSQLite3Database {
    if (db !== undefined) return db;
    const sqlite = new Database(config.path);
    db = drizzle(sqlite);
    return db;
  }

  function setDb(mockDb: BetterSQLite3Database): void {
    db = mockDb;
  }

  return buildStore(config, getDb, setDb, resolvedId);
}

export async function createSqliteStoreForBun<T>(
  config: SqliteStoreConfig<T>,
): Promise<SqliteStore<T>> {
  const resolvedId = config.id ?? generateStoreId();

  const [{ default: BunSqliteDb }, { drizzle: bunDrizzle }] = await Promise.all([
    import('bun:sqlite' as string),
    import('drizzle-orm/bun-sqlite'),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const sqlite = new (BunSqliteDb as new (path: string) => unknown)(config.path);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const bunDb = (bunDrizzle as (db: unknown) => unknown)(sqlite);
  if (
    typeof bunDb !== 'object' ||
    bunDb === null ||
    typeof (bunDb as Record<string, unknown>).select !== 'function' ||
    typeof (bunDb as Record<string, unknown>).insert !== 'function'
  ) {
    throw new Error('createSqliteStoreForBun: unexpected Bun Drizzle db shape');
  }
  // Bun SQLite and better-sqlite3 share the same sync Drizzle interface at runtime.
  let db = bunDb as unknown as BetterSQLite3Database;

  function getDb(): BetterSQLite3Database {
    return db;
  }

  function setDb(mockDb: BetterSQLite3Database): void {
    db = mockDb;
  }

  return buildStore(config, getDb, setDb, resolvedId);
}
