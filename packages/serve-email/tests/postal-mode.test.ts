import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEmailServe } from '../src/email-serve.js';
import { createContext } from '../../core/src/context.js';

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

function makeCtx(idempotencyKey?: string) {
  return createContext({ pipelineId: 'pipe_test', idempotencyKey });
}

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
});
