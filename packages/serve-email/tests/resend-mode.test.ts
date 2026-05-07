import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContext } from '../../core/src/context.js';

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

function makeCtx(idempotencyKey?: string) {
  return createContext({ pipelineId: 'pipe_test', idempotencyKey });
}

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
});
