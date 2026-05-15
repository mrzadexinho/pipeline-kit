import type {
  Atom,
  PipelineContext,
  Result,
  Store,
  StoreError,
  TraceContext,
} from '@idriszade/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function makeMockStore(initialAtom?: Atom<{ ts: string; channel: string }>): Store<{
  ts: string;
  channel: string;
}> & {
  putMock: ReturnType<typeof vi.fn>;
  getMock: ReturnType<typeof vi.fn>;
} {
  const putMock = vi.fn();
  const getMock = vi.fn();

  if (initialAtom) {
    getMock.mockResolvedValue({ data: initialAtom, error: null });
  } else {
    getMock.mockResolvedValue({ data: null, error: null });
  }
  putMock.mockResolvedValue({ data: null, error: null });

  const store: Store<{ ts: string; channel: string }> & {
    putMock: ReturnType<typeof vi.fn>;
    getMock: ReturnType<typeof vi.fn>;
  } = {
    id: 'mock-store',
    schema: {} as Store<{ ts: string; channel: string }>['schema'],
    put: putMock as (
      atom: Atom<{ ts: string; channel: string }>,
      ctx: PipelineContext,
    ) => Promise<Result<Atom<{ ts: string; channel: string }>, StoreError>>,
    get: getMock as (
      id: string,
      ctx: PipelineContext,
    ) => Promise<Result<Atom<{ ts: string; channel: string }> | null, StoreError>>,
    list: vi.fn().mockResolvedValue({ data: { items: [], has_more: false }, error: null }),
    putMock,
    getMock,
  };

  return store;
}

const baseConfig = {
  token: 'xoxb-test-token',
  channel: 'C123',
};

const validMessage = {
  text: 'Hello pipeline!',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackServe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('case 1: postMessage success returns ok with ts as id', async () => {
    postMessageMock.mockResolvedValue({
      ok: true,
      ts: '1234567890.123456',
      channel: 'C123',
    });

    const serve = createSlackServe(baseConfig);
    const ctx = makeCtx('idem-key-1');

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.id).toBe('1234567890.123456');
    expect(result.data?.metadata).toMatchObject({ channel: 'C123' });
  });

  it('case 2: idempotency cache hit short-circuits postMessage', async () => {
    const cachedAtom: Atom<{ ts: string; channel: string }> = {
      id: 'idem-key-hit',
      object: 'atom',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {},
      data: { ts: 'cached-ts', channel: 'C123' },
    };

    const store = makeMockStore(cachedAtom);
    const serve = createSlackServe({ ...baseConfig, idempotencyCache: store });
    const ctx = makeCtx('idem-key-hit');

    const result = await serve.emit(validMessage, ctx);

    expect(postMessageMock).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe('cached-ts');
  });

  it('case 3: cache miss writes atom to cache after successful postMessage', async () => {
    postMessageMock.mockResolvedValue({
      ok: true,
      ts: '9876543210.654321',
      channel: 'C123',
    });

    const store = makeMockStore(); // returns null (cache miss)
    const serve = createSlackServe({ ...baseConfig, idempotencyCache: store });
    const ctx = makeCtx('idem-key-miss');

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(store.putMock).toHaveBeenCalledOnce();

    const putCallArg = store.putMock.mock.calls[0]?.[0] as Atom<{ ts: string; channel: string }>;
    expect(putCallArg.id).toBe('idem-key-miss');
    expect(putCallArg.data.ts).toBe('9876543210.654321');
    expect(putCallArg.data.channel).toBe('C123');
  });

  it('case 4: rate-limit error from Slack maps to rate_limited type', async () => {
    postMessageMock.mockRejectedValue(new Error('ratelimited'));

    const serve = createSlackServe(baseConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('rate_limited');
    expect(result.error?.code).toBe('slack_rate_limited');
  });

  it('case 5: auth failure maps to auth type', async () => {
    postMessageMock.mockRejectedValue(new Error('invalid_auth'));

    const serve = createSlackServe(baseConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('auth');
    expect(result.error?.code).toBe('slack_auth_error');
  });

  it('case 6: thread posting passes thread_ts to postMessage', async () => {
    postMessageMock.mockResolvedValue({
      ok: true,
      ts: '1234567890.999999',
      channel: 'C123',
    });

    const serve = createSlackServe(baseConfig);
    const ctx = makeCtx();

    const result = await serve.emit({ text: 'Thread reply', thread_ts: '1234567890.000001' }, ctx);

    expect(result.error).toBeNull();
    expect(postMessageMock).toHaveBeenCalledOnce();

    const callArg = postMessageMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg.thread_ts).toBe('1234567890.000001');
  });
});
