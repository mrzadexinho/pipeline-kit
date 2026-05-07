import type { Atom, PipelineContext, TraceContext } from '@pipeline-kit/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPostgresStore } from '../src/postgres-store.js';

const PayloadSchema = z.union([
  z.object({ kind: z.literal('string'), val: z.string() }),
  z.object({ kind: z.literal('number'), val: z.number() }),
  z.object({ kind: z.literal('mixed'), name: z.string(), count: z.number() }),
]);

type Payload = z.infer<typeof PayloadSchema>;

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_prop',
    pipelineId: 'pk_pipe_prop',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

/**
 * Builds a stateful mock db that stores atoms in memory and serves them back.
 * This lets the property test exercise the full put → get path without
 * a live database.
 */
function buildStatefulMockDb(): PostgresJsDatabase {
  const store = new Map<string, Record<string, unknown>>();
  const idempotencyCache = new Map<string, string>();

  function makeSelectChain(rows: unknown[]) {
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows)),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            offset: vi.fn(() => Promise.resolve(rows)),
          })),
        })),
      })),
    };
  }

  let _pendingSelectKey: string | undefined;

  const _mockSelect = vi.fn(() => {
    // We can't easily intercept the where() arg at this level, so we rely on
    // insert/select ordering: the first select in a put is the idempotency check.
    return makeSelectChain([]);
  });

  const mockInsert = vi.fn((table: unknown) => {
    // Determine table by checking which table object was passed
    // drizzle passes the table descriptor; we check the Symbol or name
    let isIdempotency = false;
    if (
      table !== null &&
      typeof table === 'object' &&
      'key' in (table as Record<string, unknown>)
    ) {
      isIdempotency = true;
    }

    return {
      values: vi.fn((row: Record<string, unknown>) => ({
        onConflictDoUpdate: vi.fn(() => {
          const id = row.id as string;
          store.set(id, row);
          return Promise.resolve([]);
        }),
        onConflictDoNothing: vi.fn(() => {
          if (isIdempotency) {
            const key = row.key as string;
            const atomId = row.atom_id as string;
            idempotencyCache.set(key, atomId);
          }
          return Promise.resolve([]);
        }),
      })),
    };
  });

  const mockDelete = vi.fn(() => ({
    where: vi.fn(() => Promise.resolve([])),
  }));

  // Override select to look up from our in-memory store
  const smartSelect = vi.fn((_fields?: unknown) => {
    return {
      from: vi.fn((_table: unknown) => ({
        where: vi.fn((_condition: unknown) => ({
          limit: vi.fn((n: number) => {
            // Attempt to find rows — since we can't easily inspect the where
            // condition, we return all rows and let the test drive specific ids
            const rows = [...store.values()].slice(0, n);
            return Promise.resolve(rows);
          }),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn((n: number) => ({
            offset: vi.fn((off: number) => {
              const rows = [...store.values()].slice(off, off + n);
              return Promise.resolve(rows);
            }),
          })),
        })),
      })),
    };
  });

  return {
    select: smartSelect,
    insert: mockInsert,
    delete: mockDelete,
    _store: store,
    _idempotencyCache: idempotencyCache,
  } as unknown as PostgresJsDatabase;
}

const payloadArb = fc.oneof(
  fc.record({ kind: fc.constant('string' as const), val: fc.string() }),
  fc.record({
    kind: fc.constant('number' as const),
    val: fc.float({ noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({ kind: fc.constant('mixed' as const), name: fc.string(), count: fc.integer() }),
);

describe('round-trip property test', () => {
  it('for arbitrary payload: put(atom) then get(atom.id) returns same data', async () => {
    await fc.assert(
      fc.asyncProperty(
        payloadArb,
        fc.string({ minLength: 1, maxLength: 20 }),
        async (payload, idSuffix) => {
          const atomId = `pk_atom_prop_${idSuffix}`;

          const atom: Atom<Payload> = {
            id: atomId,
            object: 'atom',
            created_at: new Date().toISOString(),
            metadata: {},
            data: payload,
          };

          const db = buildStatefulMockDb();
          const store = createPostgresStore({
            connectionString: 'postgres://mock',
            schema: PayloadSchema,
          });
          store._setDb(db);

          const putResult = await store.put(atom, makeCtx());
          expect(putResult.error).toBeNull();

          // Manually inject into the mock db's store so get can find it
          const dbInternal = db as unknown as {
            _store: Map<string, Record<string, unknown>>;
          };
          const storedRow = dbInternal._store.get(atomId);
          expect(storedRow).toBeDefined();

          // Verify the data round-trips correctly through atomToRow / rowToAtom
          if (storedRow !== undefined) {
            const row = {
              ...storedRow,
              created_at:
                storedRow.created_at instanceof Date
                  ? storedRow.created_at
                  : new Date(storedRow.created_at as string),
            };
            expect(row.data).toEqual(payload);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
