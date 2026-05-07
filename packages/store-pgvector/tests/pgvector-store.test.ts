import type { Atom, PipelineContext, TraceContext } from '@pipeline-kit/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPgvectorStore } from '../src/pgvector-store.js';

const ItemSchema = z.object({ name: z.string(), value: z.number() });
type Item = z.infer<typeof ItemSchema>;

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    idempotencyKey: undefined,
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

/**
 * Creates a chainable promise proxy — every method call in the chain returns
 * `this` (another proxy), and `then` resolves to `resolveValue`.
 */
function makeChainablePromise(resolveValue: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(resolve);
      }
      if (prop === Symbol.toPrimitive || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      return () => makeChainablePromise(resolveValue);
    },
  };
  return new Proxy({}, handler);
}

function buildSelectMock(selectRows: unknown[]) {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => makeChainablePromise(selectRows)),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn(() => makeChainablePromise(selectRows)),
        })),
      })),
    })),
  }));
}

function buildInsertMock(onConflictDoUpdateImpl?: () => unknown) {
  return vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(onConflictDoUpdateImpl ?? (() => makeChainablePromise([]))),
    })),
  }));
}

function buildMockDb(opts: {
  selectRows?: unknown[];
  onConflictDoUpdateImpl?: () => unknown;
}): PostgresJsDatabase {
  return {
    select: buildSelectMock(opts.selectRows ?? []),
    insert: buildInsertMock(opts.onConflictDoUpdateImpl),
  } as unknown as PostgresJsDatabase;
}

function makeEmbeddingRow(a: Atom<Item>, embedding: Float32Array | null = null) {
  return {
    id: a.id,
    object: a.object,
    created_at: new Date(a.created_at),
    metadata: a.metadata,
    data: a.data,
    source_id: a.source_id ?? null,
    stage_id: a.stage_id ?? null,
    run_id: a.run_id ?? null,
    embedding,
  };
}

// ---- Tests ----

describe('createPgvectorStore', () => {
  describe('config validation', () => {
    it('throws when connectionString is empty', () => {
      expect(() =>
        createPgvectorStore({
          connectionString: '',
          dimension: 1536,
          distance: 'cosine',
          schema: ItemSchema,
        }),
      ).toThrow('connectionString required');
    });
  });

  describe('put + get with embedding', () => {
    it('stores and retrieves Float32Array embedding', async () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3]);
      const a = makeAtom({ id: 'pk_atom_vec_roundtrip' });

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 3,
        distance: 'cosine',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: [makeEmbeddingRow(a, embedding)] }));

      const putResult = await store.put({ ...a, embedding }, makeCtx());
      expect(putResult.error).toBeNull();
      expect(putResult.data?.id).toBe(a.id);

      const getResult = await store.get(a.id, makeCtx());
      expect(getResult.error).toBeNull();
      expect(getResult.data?.id).toBe(a.id);
      expect(getResult.data?.embedding).toBeInstanceOf(Float32Array);
      expect(Array.from(getResult.data?.embedding ?? [])).toEqual(Array.from(embedding));
    });
  });

  describe('search', () => {
    it('returns rows ordered by distance (cosine)', async () => {
      const atoms = Array.from({ length: 2 }, (_, i) =>
        makeAtom({ id: `pk_atom_search_${i}`, data: { name: `item${i}`, value: i } }),
      );
      const embedding = new Float32Array([1.0, 0.0, 0.0]);

      const selectMock = vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => makeChainablePromise(atoms.map((a) => makeEmbeddingRow(a, null)))),
          })),
          where: vi.fn(() => ({
            limit: vi.fn(() => makeChainablePromise([])),
          })),
        })),
      }));

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 3,
        distance: 'cosine',
        schema: ItemSchema,
      });
      store._setDb({
        select: selectMock,
        insert: buildInsertMock(),
      } as unknown as PostgresJsDatabase);

      const result = await store.search(embedding, 2, undefined, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.id).toBe(atoms[0]?.id);
      // select was called once for the search
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('search with l2 distance — mock still returns shaped results', async () => {
      const a = makeAtom({ id: 'pk_atom_l2_search' });
      const embedding = new Float32Array([0.5, 0.5]);

      const selectMock = vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => makeChainablePromise([makeEmbeddingRow(a, null)])),
          })),
          where: vi.fn(() => ({
            limit: vi.fn(() => makeChainablePromise([])),
          })),
        })),
      }));

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 2,
        distance: 'l2',
        schema: ItemSchema,
      });
      store._setDb({
        select: selectMock,
        insert: buildInsertMock(),
      } as unknown as PostgresJsDatabase);

      const result = await store.search(embedding, 1, undefined, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.id).toBe(a.id);
    });
  });

  describe('pgvector extension missing error', () => {
    it('maps "type vector does not exist" to pgvector_extension_missing StoreError', async () => {
      const a = makeAtom({ id: 'pk_atom_pgvec_err' });

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 1536,
        distance: 'cosine',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error('type "vector" does not exist');
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('validation');
      expect(result.error?.code).toBe('pgvector_extension_missing');
    });
  });

  describe('list with cursor pagination', () => {
    it('list with limit=3 returns 3 items and has_more=true when 4 rows available', async () => {
      const atoms = Array.from({ length: 4 }, (_, i) =>
        makeAtom({ id: `pk_atom_pgv_list_${i}`, data: { name: `item${i}`, value: i } }),
      );

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 1536,
        distance: 'cosine',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: atoms.map((a) => makeEmbeddingRow(a)) }));

      const result = await store.list({ limit: 3 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(3);
      expect(result.data?.has_more).toBe(true);
      expect(result.data?.cursor).toBe('3');
    });

    it('list returns all items with has_more=false when count <= limit', async () => {
      const atoms = Array.from({ length: 2 }, (_, i) =>
        makeAtom({ id: `pk_atom_pgv_list2_${i}`, data: { name: `item${i}`, value: i } }),
      );

      const store = createPgvectorStore({
        connectionString: 'postgres://mock',
        dimension: 1536,
        distance: 'cosine',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: atoms.map((a) => makeEmbeddingRow(a)) }));

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(2);
      expect(result.data?.has_more).toBe(false);
      expect(result.data?.cursor).toBeUndefined();
    });
  });
});
