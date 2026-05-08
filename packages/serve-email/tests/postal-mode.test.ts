import type { PipelineContext, TraceContext } from '@pipeline-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailServe } from '../src/email-serve.js';

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

const postalConfig = {
  provider: 'postal' as const,
  postal: {
    apiUrl: 'https://postal.example.com',
    apiKey: 'test-api-key',
  },
  from: 'sender@example.com',
};

const validMessage = {
  to: 'recipient@example.com',
  subject: 'Test subject',
  text: 'Hello world',
};

function makeFetchResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Postal provider', () => {
  it('sends successfully and returns ok result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, { data: {} })));

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx('postal-idem-1');

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.emitted_at).toBeDefined();
  });

  it('returns validation error on 422 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(422, { error: 'bad input' })),
    );

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('validation');
    expect(result.error?.code).toBe('postal_validation_error');
  });

  it('sends X-Idempotency-Key header when ctx.idempotencyKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const serve = createEmailServe(postalConfig);
    const idempotencyKey = 'postal-idem-key-xyz';
    const ctx = makeCtx(idempotencyKey);

    await serve.emit(validMessage, ctx);

    expect(fetchMock).toHaveBeenCalledOnce();
    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['X-Idempotency-Key']).toBe(idempotencyKey);
  });

  it('classifies 401 response as auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(401, { error: 'unauthorized' })),
    );

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('auth');
    expect(result.error?.code).toBe('postal_auth_failed');
  });

  it('classifies 403 response as auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(403, { error: 'forbidden' })),
    );

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('auth');
    expect(result.error?.code).toBe('postal_auth_failed');
  });

  it('classifies 5xx response as transient error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(502, { error: 'bad gateway' })),
    );

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
    expect(result.error?.code).toBe('postal_server_error');
  });

  it('classifies fetch network throw as network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const serve = createEmailServe(postalConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('network');
    expect(result.error?.code).toBe('postal_network_error');
  });
});
