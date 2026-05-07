import type { Atom, PipelineContext, TraceContext } from '@pipeline-kit/core';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { z } from 'zod';
import { createSqliteStore } from '../src/sqlite-store.js';

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

const payloadArb = fc.oneof(
  fc.record({ kind: fc.constant('string' as const), val: fc.string() }),
  fc.record({
    kind: fc.constant('number' as const),
    val: fc.float({ noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({ kind: fc.constant('mixed' as const), name: fc.string(), count: fc.integer() }),
);

describe('round-trip property', () => {
  it('for arbitrary payload: put then get returns same data', async () => {
    await fc.assert(
      fc.asyncProperty(
        payloadArb,
        fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/),
        async (payload, suffix) => {
          const db = createTestDb();
          const store = createSqliteStore({ path: ':memory:', schema: PayloadSchema });
          store._setDb(db);

          const atom: Atom<Payload> = {
            id: `pk_atom_${suffix}`,
            object: 'atom' as const,
            created_at: new Date().toISOString(),
            metadata: {},
            data: payload,
          };

          const putR = await store.put(atom, makeCtx());
          if (putR.error !== null) return false;

          const getR = await store.get(atom.id, makeCtx());
          if (getR.error !== null) return false;
          return JSON.stringify(getR.data?.data) === JSON.stringify(payload);
        },
      ),
      { numRuns: 30 },
    );
  });
});
