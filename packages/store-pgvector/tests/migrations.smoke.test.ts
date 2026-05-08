/**
 * Smoke test: real Postgres with pgvector extension via testcontainers.
 *
 * Boots `pgvector/pgvector:pg16` (extension preinstalled), enables it, and
 * exercises put/get/list plus all three KNN distance operators against the
 * canonical embedding table. Skipped on CI and when Docker is unreachable.
 */
import type { Atom, PipelineContext, TraceContext } from '@pipeline-kit/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPgvectorStore } from '../src/pgvector-store.js';

const SKIP_SMOKE = process.env.CI === 'true';

const ItemSchema = z.object({ name: z.string(), value: z.number() });
type Item = z.infer<typeof ItemSchema>;
const NOOP_TRACE = {} as unknown as TraceContext;

const DIM = 3; // small dimension keeps fixtures readable

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_pgv_smoke',
    pipelineId: 'pk_pipe_pgv_smoke',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

function makeAtom(id: string, value: number): Atom<Item> {
  return {
    id,
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: {},
    data: { name: `item-${value}`, value },
  };
}

describe.skipIf(SKIP_SMOKE)('pgvector-store [skip-ci] smoke', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let sql: ReturnType<typeof postgres> | undefined;
  let connectionString = '';
  let dockerAvailable = true;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    } catch (e) {
      dockerAvailable = false;
      console.warn('[smoke] Docker unreachable, skipping pgvector smoke tests:', e);
      return;
    }
    connectionString = container.getConnectionUri();
    sql = postgres(connectionString);

    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS pipeline_embeddings (
        id TEXT PRIMARY KEY,
        object TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        metadata JSONB,
        data JSONB NOT NULL,
        source_id TEXT,
        stage_id TEXT,
        run_id TEXT,
        embedding vector(${DIM})
      );
    `);
  }, 90_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it('vector(N) column accepts a Float32Array round-trip', async () => {
    if (!dockerAvailable) return;
    const store = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'cosine',
      schema: ItemSchema,
    });

    const a = makeAtom('pk_atom_pgv_rt_1', 1);
    const embedding = new Float32Array([0.1, 0.2, 0.3]);

    const putResult = await store.put({ ...a, embedding }, makeCtx());
    expect(putResult.error).toBeNull();

    const getResult = await store.get(a.id, makeCtx());
    expect(getResult.error).toBeNull();
    expect(getResult.data?.embedding).toBeInstanceOf(Float32Array);
    const got = Array.from(getResult.data?.embedding ?? []);
    expect(got.length).toBe(DIM);
    // pgvector stores float4 so allow tiny rounding tolerance
    expect(got[0]).toBeCloseTo(0.1, 5);
    expect(got[1]).toBeCloseTo(0.2, 5);
    expect(got[2]).toBeCloseTo(0.3, 5);
  });

  // Seed three distinct embeddings once, then exercise each distance op.
  async function seedSearchFixtures(): Promise<void> {
    if (!dockerAvailable) return;
    const seedStore = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'cosine',
      schema: ItemSchema,
    });
    const fixtures: Array<{ id: string; vec: Float32Array }> = [
      { id: 'pk_atom_pgv_search_a', vec: new Float32Array([1, 0, 0]) },
      { id: 'pk_atom_pgv_search_b', vec: new Float32Array([0, 1, 0]) },
      { id: 'pk_atom_pgv_search_c', vec: new Float32Array([0, 0, 1]) },
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (f === undefined) continue;
      const put = await seedStore.put({ ...makeAtom(f.id, i + 100), embedding: f.vec }, makeCtx());
      expect(put.error).toBeNull();
    }
  }

  it('KNN search with cosine distance returns nearest neighbour first', async () => {
    if (!dockerAvailable) return;
    await seedSearchFixtures();

    const store = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'cosine',
      schema: ItemSchema,
    });
    const query = new Float32Array([0.99, 0.01, 0.01]); // closest to vec_a
    const result = await store.search(query, 3, undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.length).toBe(3);
    expect(result.data?.[0]?.id).toBe('pk_atom_pgv_search_a');
  });

  it('KNN search with l2 distance returns nearest neighbour first', async () => {
    if (!dockerAvailable) return;
    await seedSearchFixtures();

    const store = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'l2',
      schema: ItemSchema,
    });
    const query = new Float32Array([0, 1, 0]); // exactly vec_b
    const result = await store.search(query, 3, undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.length).toBe(3);
    expect(result.data?.[0]?.id).toBe('pk_atom_pgv_search_b');
  });

  it('KNN search with inner_product distance returns nearest neighbour first', async () => {
    if (!dockerAvailable) return;
    await seedSearchFixtures();

    const store = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'inner_product',
      schema: ItemSchema,
    });
    // For pgvector inner-product distance (<#>), smaller (more negative) =
    // higher dot product. Query aligned with vec_c gives the smallest value.
    const query = new Float32Array([0, 0, 1]);
    const result = await store.search(query, 3, undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.length).toBe(3);
    expect(result.data?.[0]?.id).toBe('pk_atom_pgv_search_c');
  });

  it('list with limit returns paging metadata', async () => {
    if (!dockerAvailable) return;
    await seedSearchFixtures();

    const store = createPgvectorStore({
      connectionString,
      dimension: DIM,
      distance: 'cosine',
      schema: ItemSchema,
    });
    const result = await store.list({ limit: 2 }, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.items.length).toBeLessThanOrEqual(2);
    if ((result.data?.items.length ?? 0) === 2) {
      expect(result.data?.has_more).toBe(true);
      expect(result.data?.cursor).toBeDefined();
    }
  });
});
