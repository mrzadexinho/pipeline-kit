/**
 * Branch coverage uplift for sqlite-store.
 *
 * The existing sqlite-store.test.ts covers happy paths, the ECONNREFUSED
 * (transient) error mapping, idempotency-cache hit, get-miss, and list
 * pagination. This file adds the branches that classifySqliteError exposes
 * but aren't yet hit: timeout, unique violation (validation), auth,
 * non-Error throw fallback, and the empty-list path.
 */
import type { Atom, PipelineContext, TraceContext } from '@pipeline-kit/core';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSqliteStore } from '../src/sqlite-store.js';

const ItemSchema = z.object({ name: z.string(), value: z.number() });
type Item = z.infer<typeof ItemSchema>;

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(idempotencyKey?: string): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_branch',
    pipelineId: 'pk_pipe_branch',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    idempotencyKey,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

function makeAtom(overrides: Partial<Atom<Item>> = {}): Atom<Item> {
  return {
    id: `pk_atom_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: {},
    data: { name: 'test', value: 42 },
    ...overrides,
  };
}

function createTestDb(): BetterSQLite3Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE pipeline_atoms (
      id TEXT PRIMARY KEY NOT NULL,
      object TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata TEXT,
      data TEXT NOT NULL,
      source_id TEXT,
      stage_id TEXT,
      run_id TEXT
    )
  `);
  sqlite.exec(`
    CREATE TABLE pipeline_idempotency_cache (
      key TEXT PRIMARY KEY NOT NULL,
      atom_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return drizzle(sqlite);
}

/**
 * Builds a mock db whose insert chain throws errorToThrow synchronously
 * inside the .onConflictDoUpdate(...).run() call. Stubs select/delete to
 * no-op so the put codepath is the only one in play.
 */
function makeThrowingDb(errorToThrow: unknown): BetterSQLite3Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            get: () => undefined,
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          run: () => {
            throw errorToThrow;
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => undefined,
    }),
  } as unknown as BetterSQLite3Database;
}

describe('sqlite-store branch coverage', () => {
  describe('error classification', () => {
    it('maps timeout error to StoreError type=timeout', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(makeThrowingDb(new Error('operation timed out after 5000ms')));

      const result = await store.put(makeAtom({ id: 'pk_atom_branch_timeout' }), makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('timeout');
      expect(result.error?.code).toBe('db_timeout');
    });

    it('maps unique-violation error to StoreError type=validation', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(makeThrowingDb(new Error('UNIQUE constraint failed: pipeline_atoms.id')));

      const result = await store.put(makeAtom({ id: 'pk_atom_branch_unique' }), makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('validation');
      expect(result.error?.code).toBe('db_unique_violation');
    });

    it('maps auth/permission error to StoreError type=auth', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(makeThrowingDb(new Error('attempt to write a readonly database (permission denied)')));

      const result = await store.put(makeAtom({ id: 'pk_atom_branch_auth' }), makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('auth');
      expect(result.error?.code).toBe('db_auth_error');
    });

    it('maps non-Error throw to StoreError type=unknown via String() fallback', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      // Throw a non-Error value to hit the !(e instanceof Error) branch.
      store._setDb(makeThrowingDb('plain string failure'));

      const result = await store.put(makeAtom({ id: 'pk_atom_branch_nonerror' }), makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('unknown');
      expect(result.error?.code).toBe('db_unknown');
      expect(result.error?.message).toBe('plain string failure');
    });

    it('maps generic Error message (no keyword match) to StoreError type=unknown', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(makeThrowingDb(new Error('something completely opaque happened')));

      const result = await store.put(makeAtom({ id: 'pk_atom_branch_generic' }), makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('unknown');
      expect(result.error?.code).toBe('db_unknown');
    });
  });

  describe('idempotency key absent vs present', () => {
    it('put with NO idempotency key skips cache check and write entirely', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const a = makeAtom({ id: 'pk_atom_branch_noidem' });
      const result = await store.put(a, makeCtx(/* no key */));
      expect(result.error).toBeNull();
      expect(result.data?.id).toBe(a.id);

      // Re-put same atom with no key — exercises the
      // idempotencyKey === undefined branch on a second pass too.
      const second = await store.put(a, makeCtx());
      expect(second.error).toBeNull();
    });

    it('put with idempotency key writes cache then short-circuits on second call', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const a = makeAtom({ id: 'pk_atom_branch_idem_a' });
      const idem = 'idem_branch_key_1';
      const r1 = await store.put(a, makeCtx(idem));
      expect(r1.error).toBeNull();

      // Different atom payload, same key — cache hit short-circuits, returns
      // input atom (b) unchanged without inserting it.
      const b = makeAtom({ id: 'pk_atom_branch_idem_b', data: { name: 'other', value: 99 } });
      const r2 = await store.put(b, makeCtx(idem));
      expect(r2.error).toBeNull();
      expect(r2.data?.id).toBe(b.id);

      // Confirm only the first atom landed in the table.
      const list = await store.list({}, makeCtx());
      expect(list.error).toBeNull();
      expect(list.data?.items).toHaveLength(1);
      expect(list.data?.items[0]?.id).toBe(a.id);
    });
  });

  describe('list edge cases', () => {
    it('list before any put returns empty items and has_more=false', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const result = await store.list({}, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(0);
      expect(result.data?.has_more).toBe(false);
      expect(result.data?.cursor).toBeUndefined();
    });

    it('list with explicit cursor follows offset path', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      // Insert 3 atoms with ascending created_at to make ordering deterministic.
      for (let i = 0; i < 3; i++) {
        await store.put(
          makeAtom({
            id: `pk_atom_branch_cursor_${i}`,
            created_at: new Date(Date.now() + i * 1000).toISOString(),
            data: { name: 'c', value: i },
          }),
          makeCtx(),
        );
      }

      const page1 = await store.list({ limit: 2 }, makeCtx());
      expect(page1.error).toBeNull();
      expect(page1.data?.items).toHaveLength(2);
      expect(page1.data?.has_more).toBe(true);
      expect(page1.data?.cursor).toBe('2');

      // Following the cursor exercises the cursor !== undefined branch.
      const page2 = await store.list({ limit: 2, cursor: page1.data?.cursor }, makeCtx());
      expect(page2.error).toBeNull();
      expect(page2.data?.items).toHaveLength(1);
      expect(page2.data?.has_more).toBe(false);
    });

    it('list error path: select throws non-transient error mapped to StoreError', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb({
        select: () => ({
          from: () => ({
            orderBy: () => ({
              limit: () => ({
                offset: () => ({
                  all: () => {
                    throw new Error('something opaque happened during list');
                  },
                }),
              }),
            }),
          }),
        }),
        insert: () => ({}),
        delete: () => ({}),
      } as unknown as BetterSQLite3Database);

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('unknown');
    });

    it('get error path: select throws timeout mapped to StoreError type=timeout', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                get: () => {
                  throw new Error('query timeout exceeded');
                },
              }),
            }),
          }),
        }),
        insert: () => ({}),
        delete: () => ({}),
      } as unknown as BetterSQLite3Database);

      const result = await store.get('pk_atom_branch_get_timeout', makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('timeout');
    });
  });

  describe('schema mismatch on read', () => {
    it('rowToAtom returns validation StoreError when stored data fails schema parse', async () => {
      const db = createTestDb();
      // Store with a permissive schema, then read back with strict ItemSchema
      // to surface the parsed.success === false branch in rowToAtom.
      const permissive = createSqliteStore({
        path: ':memory:',
        schema: z.unknown().transform((v) => v as Item),
      });
      permissive._setDb(db);

      const a = makeAtom({
        id: 'pk_atom_branch_bad_data',
        // shape doesn't match ItemSchema — stored as-is
        data: { unexpected: 'shape' } as unknown as Item,
      });
      await permissive.put(a, makeCtx());

      const strict = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      strict._setDb(db);

      const get = await strict.get(a.id, makeCtx());
      expect(get.data).toBeNull();
      expect(get.error?.type).toBe('validation');
      expect(get.error?.code).toBe('schema_mismatch');
    });
  });
});
