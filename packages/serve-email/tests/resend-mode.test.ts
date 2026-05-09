import type { PipelineContext, TraceContext } from '@idriszade/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Mock the resend module before any imports use it
vi.mock('resend', () => {
  const sendMock = vi.fn();
  class MockResend {
    emails = { send: sendMock };
    static __sendMock = sendMock;
    constructor(_apiKey: string) {}
  }
  return { Resend: MockResend, __sendMock: sendMock };
});

const { createEmailServe } = await import('../src/email-serve.js');
const resendModule = await import('resend');
const sendMock = (resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> }).__sendMock;

const resendConfig = {
  provider: 'resend' as const,
  resend: {
    apiKey: 'test-resend-api-key',
  },
  from: 'sender@example.com',
};

const validMessage = {
  to: 'recipient@example.com',
  subject: 'Resend test',
  html: '<p>Hello</p>',
};

describe('Resend provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends successfully and returns ok result', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-msg-abc' }, error: null });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.emitted_at).toBeDefined();
  });

  it('succeeds with idempotency key and does not crash', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-msg-idem' }, error: null });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx('resend-idem-key-123');

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe('resend-idem-key-123');
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'resend-idem-key-123' }),
    );
  });

  it('classifies rate_limit_exceeded as rate_limited', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'rate_limit_exceeded',
        message: 'rate limit hit',
        statusCode: 429,
      },
    });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('rate_limited');
    expect(result.error?.code).toBe('resend_rate_limited');
  });

  it('classifies invalid_api_key (401) as auth error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_api_key',
        message: 'Invalid API key',
        statusCode: 401,
      },
    });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('auth');
    expect(result.error?.code).toBe('resend_auth_failed');
  });

  it('classifies generic SDK error as unknown with code resend_error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'something_unexpected',
        message: 'unexpected payload',
        statusCode: 400,
      },
    });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('unknown');
    expect(result.error?.code).toBe('resend_error');
  });

  it('calls send with no second-arg when ctx has no idempotency key', async () => {
    sendMock.mockResolvedValue({ data: { id: 'resend-msg-noidem' }, error: null });

    const serve = createEmailServe(resendConfig);
    const ctx = makeCtx();

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(sendMock).toHaveBeenCalledOnce();
    // When no idempotency key, send is called with just the payload (single arg)
    const callArgs = sendMock.mock.calls[0] as unknown[];
    expect(callArgs.length).toBe(1);
  });
});
