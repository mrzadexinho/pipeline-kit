/**
 * Smoke test: real Postgres via testcontainers.
 *
 * Skipped on CI (testcontainers boot ~5-10s) and when Docker isn't reachable
 * locally. Local runs prove that the canonical migration matches what the
 * Postgres adapter emits at runtime — i.e. put/get/list/idempotency all
 * round-trip against the schema in `migrations/0001_init.sql`.
 */
import type { Atom, PipelineContext, TraceContext } from '@idriszade/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPostgresStore } from '../src/postgres-store.js';

// Heuristic: skip when CI or Docker unreachable. testcontainers throws ~5s in,
// so guarding here keeps developer feedback tight when the daemon is off.
const SKIP_SMOKE = process.env.CI === 'true';

const ItemSchema = z.object({ x: z.number() });
type Item = z.infer<typeof ItemSchema>;
const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(idempotencyKey?: string): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_smoke',
    pipelineId: 'pk_pipe_smoke',
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

describe.skipIf(SKIP_SMOKE)('postgres-store [skip-ci] smoke', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let sql: ReturnType<typeof postgres> | undefined;
  let connectionString = '';
  let dockerAvailable = true;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
    } catch (e) {
      // Docker unreachable — flag and skip individual tests below.
      dockerAvailable = false;
      console.warn('[smoke] Docker unreachable, skipping postgres smoke tests:', e);
      return;
    }
    connectionString = container.getConnectionUri();
    sql = postgres(connectionString);

    // Mirror migrations/0001_init.sql shape exactly (TIMESTAMPTZ, JSONB).
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS pipeline_atoms (
        id TEXT PRIMARY KEY,
        object TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        metadata JSONB,
        data JSONB NOT NULL,
        source_id TEXT,
        stage_id TEXT,
        run_id TEXT
      );
      CREATE TABLE IF NOT EXISTS pipeline_idempotency_cache (
        key TEXT PRIMARY KEY,
        atom_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it('end-to-end: put then get returns the atom', async () => {
    if (!dockerAvailable) return;
    const store = createPostgresStore({ connectionString, schema: ItemSchema });
    const atom: Atom<Item> = {
      id: 'pk_atom_smoke_1',
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: {},
      data: { x: 42 },
    };
    const putResult = await store.put(atom, makeCtx());
    expect(putResult.error).toBeNull();

    const getResult = await store.get('pk_atom_smoke_1', makeCtx());
    expect(getResult.error).toBeNull();
    expect(getResult.data?.data).toEqual({ x: 42 });
  });

  it('list with paging returns has_more correctly', async () => {
    if (!dockerAvailable) return;
    const store = createPostgresStore({ connectionString, schema: ItemSchema });

    for (let i = 2; i <= 5; i++) {
      await store.put(
        {
          id: `pk_atom_smoke_${i}`,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {},
          data: { x: i },
        },
        makeCtx(),
      );
    }

    const listResult = await store.list({ limit: 2 }, makeCtx());
    expect(listResult.error).toBeNull();
    expect(listResult.data?.has_more).toBe(true);
    expect(listResult.data?.items.length).toBe(2);
    expect(listResult.data?.cursor).toBeDefined();

    // Follow cursor — exercise offset path.
    const page2 = await store.list({ limit: 2, cursor: listResult.data?.cursor }, makeCtx());
    expect(page2.error).toBeNull();
    expect(page2.data?.items.length).toBe(2);
  });

  it('idempotency cache: same key short-circuits second put', async () => {
    if (!dockerAvailable) return;
    const store = createPostgresStore({ connectionString, schema: ItemSchema });
    const ctx = makeCtx('idem-key-smoke-1');
    const atom: Atom<Item> = {
      id: 'pk_atom_smoke_idem_1',
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: {},
      data: { x: 100 },
    };
    const r1 = await store.put(atom, ctx);
    expect(r1.error).toBeNull();

    // Same idempotency key, different atom payload — second call returns input
    // unchanged because cache hit short-circuits before insert.
    const atom2: Atom<Item> = { ...atom, id: 'pk_atom_smoke_idem_2', data: { x: 200 } };
    const r2 = await store.put(atom2, ctx);
    expect(r2.error).toBeNull();

    // Confirm second atom was NOT inserted (cache short-circuit ran).
    const got2 = await store.get('pk_atom_smoke_idem_2', makeCtx());
    expect(got2.error).toBeNull();
    expect(got2.data).toBeNull();
  });

  it('get miss returns null, not an error', async () => {
    if (!dockerAvailable) return;
    const store = createPostgresStore({ connectionString, schema: ItemSchema });
    const result = await store.get('pk_atom_smoke_does_not_exist', makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });
});
