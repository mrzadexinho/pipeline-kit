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
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
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

describe('createSqliteStore', () => {
  describe('put + get round-trip', () => {
    it('put atom then get by id returns same atom data', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const a = makeAtom({ id: 'pk_atom_roundtrip1' });

      const putResult = await store.put(a, makeCtx());
      expect(putResult.error).toBeNull();
      expect(putResult.data?.id).toBe(a.id);

      const getResult = await store.get(a.id, makeCtx());
      expect(getResult.error).toBeNull();
      expect(getResult.data?.data).toEqual(a.data);
      expect(getResult.data?.id).toBe(a.id);
    });
  });

  describe('list with cursor', () => {
    it('list with limit=3 and 4 atoms returns has_more=true and cursor=3', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const atoms = Array.from({ length: 4 }, (_, i) =>
        makeAtom({ id: `pk_atom_list_${i}`, data: { name: `item${i}`, value: i } }),
      );

      for (const a of atoms) {
        await store.put(a, makeCtx());
      }

      const result = await store.list({ limit: 3 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(3);
      expect(result.data?.has_more).toBe(true);
      expect(result.data?.cursor).toBe('3');
    });

    it('list with 2 atoms and limit=5 returns has_more=false', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const atoms = Array.from({ length: 2 }, (_, i) =>
        makeAtom({ id: `pk_atom_list2_${i}`, data: { name: `item${i}`, value: i } }),
      );

      for (const a of atoms) {
        await store.put(a, makeCtx());
      }

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(2);
      expect(result.data?.has_more).toBe(false);
      expect(result.data?.cursor).toBeUndefined();
    });
  });

  describe('idempotency', () => {
    it('put with idempotency key: second put is a no-op (same atom returned without duplicate insert)', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const a = makeAtom({ id: 'pk_atom_idem1' });
      const idemKey = 'idem_key_abc123';

      const first = await store.put(a, makeCtx(idemKey));
      expect(first.error).toBeNull();
      expect(first.data?.id).toBe(a.id);

      const second = await store.put(a, makeCtx(idemKey));
      expect(second.error).toBeNull();
      expect(second.data?.id).toBe(a.id);

      const listResult = await store.list({}, makeCtx());
      expect(listResult.data?.items).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('db error propagates as StoreError (broken db throws on operation)', async () => {
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });

      const brokenDb = {
        select: () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        },
        insert: () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        },
        delete: () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        },
      } as unknown as BetterSQLite3Database;

      store._setDb(brokenDb);

      const a = makeAtom({ id: 'pk_atom_broken' });
      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('transient');
    });

    it('get miss returns null (not an error)', async () => {
      const db = createTestDb();
      const store = createSqliteStore({ path: ':memory:', schema: ItemSchema });
      store._setDb(db);

      const result = await store.get('pk_atom_nonexistent', makeCtx());
      expect(result.error).toBeNull();
      expect(result.data).toBeNull();
    });
  });
});
