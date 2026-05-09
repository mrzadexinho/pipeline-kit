import type { Atom, PipelineContext, TraceContext } from '@idriszade/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPostgresStore } from '../src/postgres-store.js';

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

/**
 * Creates a chainable promise proxy — every method call in the chain returns
 * `this` (another proxy), and `then` resolves to `resolveValue`.
 * This is the minimal shim needed to satisfy the Drizzle builder chain.
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

/**
 * Builds a simple partial mock of PostgresJsDatabase.
 * `selectRows` controls what the `select().from().where().limit()` chain resolves to.
 */
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
      onConflictDoNothing: vi.fn(() => makeChainablePromise([])),
    })),
  }));
}

function buildDeleteMock() {
  return vi.fn(() => ({ where: vi.fn(() => makeChainablePromise([])) }));
}

function buildMockDb(opts: {
  selectRows?: unknown[];
  onConflictDoUpdateImpl?: () => unknown;
}): PostgresJsDatabase {
  return {
    select: buildSelectMock(opts.selectRows ?? []),
    insert: buildInsertMock(opts.onConflictDoUpdateImpl),
    delete: buildDeleteMock(),
  } as unknown as PostgresJsDatabase;
}

function makeAtomRow(a: Atom<Item>) {
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

// ---- Tests ----

describe('createPostgresStore', () => {
  describe('config validation', () => {
    it('throws when connectionString is absent and PG_CONNECTION is unset', () => {
      const prev = process.env.PG_CONNECTION;
      delete process.env.PG_CONNECTION;
      expect(() => createPostgresStore({ connectionString: '', schema: ItemSchema })).toThrow(
        'connectionString required',
      );
      if (prev !== undefined) process.env.PG_CONNECTION = prev;
    });
  });

  describe('put + get round-trip', () => {
    it('put atom then get by id returns same atom data', async () => {
      const a = makeAtom({ id: 'pk_atom_roundtrip1' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: [makeAtomRow(a)] }));

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
    it('list with limit=3 returns 3 atoms and has_more=true when 4 rows available', async () => {
      const atoms = Array.from({ length: 4 }, (_, i) =>
        makeAtom({ id: `pk_atom_list_${i}`, data: { name: `item${i}`, value: i } }),
      );

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: atoms.map(makeAtomRow) }));

      const result = await store.list({ limit: 3 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(3);
      expect(result.data?.has_more).toBe(true);
      expect(result.data?.cursor).toBe('3');
    });

    it('list returns all items with has_more=false when count <= limit', async () => {
      const atoms = Array.from({ length: 2 }, (_, i) =>
        makeAtom({ id: `pk_atom_list2_${i}`, data: { name: `item${i}`, value: i } }),
      );

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: atoms.map(makeAtomRow) }));

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.error).toBeNull();
      expect(result.data?.items).toHaveLength(2);
      expect(result.data?.has_more).toBe(false);
      expect(result.data?.cursor).toBeUndefined();
    });

    it('list error during db call → StoreError', async () => {
      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn().mockRejectedValue(new Error('connection timed out')),
              })),
            })),
          })),
        })),
        insert: buildInsertMock(),
        delete: buildDeleteMock(),
      } as unknown as PostgresJsDatabase);

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('timeout');
    });

    it('list schema validation failure in row → StoreError with type: validation', async () => {
      // Row with data that does not match ItemSchema (name is missing)
      const badRow = {
        id: 'pk_atom_badrow',
        object: 'atom',
        created_at: new Date(),
        metadata: {},
        data: { wrong: 'field' }, // does not match ItemSchema
        source_id: null,
        stage_id: null,
        run_id: null,
      };

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: [badRow] }));

      const result = await store.list({ limit: 5 }, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('validation');
    });
  });

  describe('idempotency', () => {
    it('idempotency cache hit: put with existing key returns success without inserting', async () => {
      const a = makeAtom({ id: 'pk_atom_idempotent1' });
      const idemKey = 'idem_key_abc123';
      const idempotencyRow = { key: idemKey, atom_id: a.id, created_at: new Date() };

      let callCount = 0;
      const mockInsert = buildInsertMock();

      const mockSelect = vi.fn(() => {
        callCount += 1;
        const rows = callCount === 1 ? [idempotencyRow] : [makeAtomRow(a)];
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => makeChainablePromise(rows)),
            })),
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => makeChainablePromise(rows)),
              })),
            })),
          })),
        };
      });

      const mockDb = {
        select: mockSelect,
        insert: mockInsert,
        delete: buildDeleteMock(),
      } as unknown as PostgresJsDatabase;

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(mockDb);

      const result = await store.put(a, makeCtx(idemKey));
      expect(result.error).toBeNull();
      expect(result.data?.id).toBe(a.id);
      // insert must NOT be called — cache hit returns early
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('idempotency cache miss: new key inserts atom and writes to cache', async () => {
      const a = makeAtom({ id: 'pk_atom_idempotent2' });
      const idemKey = 'idem_key_new_xyz';

      const mockInsert = buildInsertMock();
      const mockSelect = buildSelectMock([]);

      const mockDb = {
        select: mockSelect,
        insert: mockInsert,
        delete: buildDeleteMock(),
      } as unknown as PostgresJsDatabase;

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(mockDb);

      const result = await store.put(a, makeCtx(idemKey));
      expect(result.error).toBeNull();
      // insert called twice: atom upsert + idempotency cache write
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('connection refused → StoreError with type: transient', async () => {
      const a = makeAtom({ id: 'pk_atom_fail1' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('transient');
    });

    it('timeout error → StoreError with type: timeout', async () => {
      const a = makeAtom({ id: 'pk_atom_timeout' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error('Query timed out after 5000ms');
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('timeout');
    });

    it('unique constraint violation → StoreError with type: validation', async () => {
      const a = makeAtom({ id: 'pk_atom_unique' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error(
              'ERROR: duplicate key value violates unique constraint "pipeline_atoms_pkey"',
            );
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('validation');
    });

    it('auth error → StoreError with type: auth', async () => {
      const a = makeAtom({ id: 'pk_atom_auth' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error('FATAL: password authentication failed for user "app"');
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('auth');
    });

    it('non-Error thrown → StoreError with type: unknown', async () => {
      const a = makeAtom({ id: 'pk_atom_nonError' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            // eslint-disable-next-line no-throw-literal
            throw 'string error — not an Error instance';
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('unknown');
    });

    it('unknown error message → StoreError with type: unknown', async () => {
      const a = makeAtom({ id: 'pk_atom_unknown_err' });

      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(
        buildMockDb({
          onConflictDoUpdateImpl: () => {
            throw new Error('some completely unexpected database error');
          },
        }),
      );

      const result = await store.put(a, makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('unknown');
    });

    it('get db error → StoreError', async () => {
      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
            })),
          })),
        })),
        insert: buildInsertMock(),
        delete: buildDeleteMock(),
      } as unknown as PostgresJsDatabase);

      const result = await store.get('pk_atom_test', makeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.type).toBe('transient');
    });

    it('get miss → returns null (not an error)', async () => {
      const store = createPostgresStore({
        connectionString: 'postgres://mock',
        schema: ItemSchema,
      });
      store._setDb(buildMockDb({ selectRows: [] }));

      const result = await store.get('pk_atom_nonexistent', makeCtx());
      expect(result.error).toBeNull();
      expect(result.data).toBeNull();
    });
  });
});
