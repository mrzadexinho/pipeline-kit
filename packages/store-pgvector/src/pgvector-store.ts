import type { Atom, PipelineContext, RetryPolicy, StoreError } from '@pipeline-kit/core';
import {
  err,
  type ListResult,
  ok,
  type Result,
  type Store,
  type StoreFilters,
} from '@pipeline-kit/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ZodType } from 'zod';
import { embeddingTable } from './embedding-table.js';

export interface PgvectorStoreConfig<T> {
  id?: string;
  connectionString: string;
  dimension: number;
  distance: 'cosine' | 'l2' | 'inner_product';
  indexType?: 'hnsw' | 'ivfflat';
  schema: ZodType<T>;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface PgvectorStore<T> extends Store<T> {
  readonly id: string;
  readonly schema: ZodType<T>;
  put(
    atom: Atom<T> & { embedding?: Float32Array },
    ctx: PipelineContext,
  ): Promise<Result<Atom<T>, StoreError>>;
  get(
    id: string,
    ctx: PipelineContext,
  ): Promise<Result<(Atom<T> & { embedding: Float32Array | null }) | null, StoreError>>;
  search(
    embedding: Float32Array,
    k: number,
    filters: StoreFilters | undefined,
    ctx: PipelineContext,
  ): Promise<Result<Array<Atom<T> & { embedding: Float32Array | null }>, StoreError>>;
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

  // pgvector extension missing — check before generic unknown
  if (
    msg.includes('vector') ||
    msg.includes('pgvector') ||
    msg.includes('vector_in') ||
    msg.includes('type "vector" does not exist')
  ) {
    return makeStoreError(
      'validation',
      'pgvector_extension_missing',
      'pgvector extension not installed — run CREATE EXTENSION IF NOT EXISTS vector',
    );
  }

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

type EmbeddingRow = typeof embeddingTable.$inferSelect;

function rowToAtom<T>(
  row: EmbeddingRow,
  schema: ZodType<T>,
): Result<Atom<T> & { embedding: Float32Array | null }, StoreError> {
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) {
    return err(makeStoreError('validation', 'schema_mismatch', parsed.error.message));
  }

  const result: Atom<T> & { embedding: Float32Array | null } = {
    id: row.id,
    object: 'atom' as const,
    created_at: row.created_at.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    data: parsed.data,
    source_id: row.source_id ?? undefined,
    stage_id: row.stage_id ?? undefined,
    run_id: row.run_id ?? undefined,
    embedding: row.embedding ?? null,
  };
  return ok(result);
}

let _storeCounter = 0;

function generateStoreId(): string {
  _storeCounter += 1;
  return `pk_store_pgv_${Date.now().toString(36)}_${_storeCounter}`;
}

export function createPgvectorStore<T>(config: PgvectorStoreConfig<T>): PgvectorStore<T> {
  if (!config.connectionString) {
    throw new Error('PgvectorStoreConfig: connectionString required');
  }

  const resolvedId = config.id ?? generateStoreId();

  // Lazy db instance — created on first use so tests can inject before first call
  let db: PostgresJsDatabase | undefined;

  function getDb(): PostgresJsDatabase {
    if (db !== undefined) return db;
    db = drizzle(config.connectionString);
    return db;
  }

  function _setDb(mockDb: PostgresJsDatabase): void {
    db = mockDb;
  }

  async function put(
    atom: Atom<T> & { embedding?: Float32Array },
    _ctx: PipelineContext,
  ): Promise<Result<Atom<T>, StoreError>> {
    const d = getDb();

    try {
      const row: typeof embeddingTable.$inferInsert = {
        id: atom.id,
        object: atom.object,
        created_at: new Date(atom.created_at),
        metadata: atom.metadata,
        data: atom.data,
        source_id: atom.source_id ?? null,
        stage_id: atom.stage_id ?? null,
        run_id: atom.run_id ?? null,
        embedding: atom.embedding ?? null,
      };

      await d
        .insert(embeddingTable)
        .values(row)
        .onConflictDoUpdate({
          target: embeddingTable.id,
          set: {
            object: row.object,
            created_at: row.created_at,
            metadata: row.metadata,
            data: row.data,
            source_id: row.source_id,
            stage_id: row.stage_id,
            run_id: row.run_id,
            embedding: row.embedding,
          },
        });

      return ok(atom);
    } catch (e) {
      return err(classifyDbError(e));
    }
  }

  async function get(
    id: string,
    _ctx: PipelineContext,
  ): Promise<Result<(Atom<T> & { embedding: Float32Array | null }) | null, StoreError>> {
    const d = getDb();

    try {
      const rows = await d.select().from(embeddingTable).where(eq(embeddingTable.id, id)).limit(1);

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
        .from(embeddingTable)
        .orderBy(embeddingTable.created_at)
        .limit(limit + 1)
        .offset(offset);

      const has_more = rows.length > limit;
      const pageRows = has_more ? rows.slice(0, limit) : rows;

      const items: Array<Atom<T>> = [];
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

  async function search(
    embedding: Float32Array,
    k: number,
    _filters: StoreFilters | undefined,
    _ctx: PipelineContext,
  ): Promise<Result<Array<Atom<T> & { embedding: Float32Array | null }>, StoreError>> {
    const d = getDb();

    try {
      const embStr = `[${Array.from(embedding).join(',')}]`;
      const distOp =
        config.distance === 'cosine'
          ? sql`${embeddingTable.embedding} <=> ${embStr}::vector`
          : config.distance === 'l2'
            ? sql`${embeddingTable.embedding} <-> ${embStr}::vector`
            : sql`${embeddingTable.embedding} <#> ${embStr}::vector`;

      const rows = await d.select().from(embeddingTable).orderBy(distOp).limit(k);

      const results: Array<Atom<T> & { embedding: Float32Array | null }> = [];
      for (const row of rows) {
        const result = rowToAtom(row, config.schema);
        if (result.error !== null) {
          return err(result.error);
        }
        results.push(result.data);
      }

      return ok(results);
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
    search,
    _setDb,
  };
}
