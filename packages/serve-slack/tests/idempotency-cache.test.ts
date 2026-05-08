import type {
  Atom,
  ListResult,
  PipelineContext,
  Result,
  Store,
  StoreError,
  StoreFilters,
  TraceContext,
} from '@pipeline-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock @slack/web-api before any imports that use it
// ---------------------------------------------------------------------------

const postMessageMock = vi.fn();

vi.mock('@slack/web-api', () => {
  function WebClient(_token: string) {
    return { chat: { postMessage: postMessageMock } };
  }
  return { WebClient };
});

// Dynamic import AFTER mock is set up
const { createSlackServe } = await import('../src/slack-serve.js');

// ---------------------------------------------------------------------------
// In-memory Store implementation for testing
// ---------------------------------------------------------------------------

type CacheData = { ts: string; channel: string };

function createInMemoryStore(): Store<CacheData> {
  const storage = new Map<string, Atom<CacheData>>();

  return {
    id: 'in-memory-store',
    schema: z.object({ ts: z.string(), channel: z.string() }),

    async put(
      atom: Atom<CacheData>,
      _ctx: PipelineContext,
    ): Promise<Result<Atom<CacheData>, StoreError>> {
      storage.set(atom.id, atom);
      return { data: atom, error: null };
    },

    async get(
      id: string,
      _ctx: PipelineContext,
    ): Promise<Result<Atom<CacheData> | null, StoreError>> {
      const atom = storage.get(id) ?? null;
      return { data: atom, error: null };
    },

    async list(
      _filters: StoreFilters,
      _ctx: PipelineContext,
    ): Promise<Result<ListResult<Atom<CacheData>>, StoreError>> {
      const items = [...storage.values()];
      return { data: { items, has_more: false }, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(idempotencyKey?: string): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: {} as unknown as TraceContext,
    idempotencyKey,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

const baseConfig = {
  token: 'xoxb-test-token',
  channel: 'C123',
};

const validMessage = { text: 'Idempotency test message' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdempotencyCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('case 1: real in-memory cache deduplicates on second emit', async () => {
    postMessageMock.mockResolvedValue({
      ok: true,
      ts: '1111111111.111111',
      channel: 'C123',
    });

    const cache = createInMemoryStore();
    const serve = createSlackServe({ ...baseConfig, idempotencyCache: cache });
    const ctx = makeCtx('dedup-key-1');

    // First emit: cache miss → postMessage called → cache written
    const first = await serve.emit(validMessage, ctx);
    expect(first.error).toBeNull();
    expect(first.data?.id).toBe('1111111111.111111');
    expect(postMessageMock).toHaveBeenCalledTimes(1);

    // Second emit: cache hit → postMessage NOT called
    const second = await serve.emit(validMessage, ctx);
    expect(second.error).toBeNull();
    expect(second.data?.id).toBe('1111111111.111111');
    expect(postMessageMock).toHaveBeenCalledTimes(1); // still only 1 call
  });

  it('case 2: without cache, same idempotency key triggers postMessage twice', async () => {
    postMessageMock.mockResolvedValue({
      ok: true,
      ts: '2222222222.222222',
      channel: 'C123',
    });

    // No idempotencyCache in config
    const serve = createSlackServe(baseConfig);
    const ctx = makeCtx('same-key-no-cache');

    await serve.emit(validMessage, ctx);
    await serve.emit(validMessage, ctx);

    expect(postMessageMock).toHaveBeenCalledTimes(2);
  });
});
