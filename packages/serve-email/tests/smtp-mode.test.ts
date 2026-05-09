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

// Mock nodemailer at module level — must be before any imports that use it
vi.mock('nodemailer', () => {
  const sendMail = vi.fn();
  return {
    default: {
      createTransport: vi.fn(() => ({ sendMail })),
    },
    createTransport: vi.fn(() => ({ sendMail })),
    __sendMail: sendMail,
  };
});

// Dynamic import AFTER mock is set up
const { createEmailServe } = await import('../src/email-serve.js');
const nodemailer = await import('nodemailer');

function getSendMail() {
  // Get the sendMail mock from the transport created by createTransport
  const createTransportMock = (
    nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
  ).default.createTransport as ReturnType<typeof vi.fn>;
  const transport = createTransportMock.mock.results[0]?.value as
    | { sendMail: ReturnType<typeof vi.fn> }
    | undefined;
  return transport?.sendMail;
}

const smtpConfig = {
  provider: 'smtp' as const,
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user@example.com', pass: 'secret' },
  },
  from: 'sender@example.com',
};

const validMessage = {
  to: 'recipient@example.com',
  subject: 'Test subject',
  text: 'Hello world',
};

describe('SMTP provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends successfully and returns ok result', async () => {
    const serve = createEmailServe(smtpConfig);
    const ctx = makeCtx('idem-key-1');

    // Ensure a fresh transport mock with resolved sendMail
    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    });

    const result = await serve.emit(validMessage, ctx);

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.emitted_at).toBeDefined();
  });

  it('classifies EAUTH error as auth type', async () => {
    const serve = createEmailServe(smtpConfig);
    const ctx = makeCtx();

    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Invalid credentials'), { code: 'EAUTH' })),
    });

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('auth');
    expect(result.error?.code).toBe('smtp_auth_failed');
  });

  it('classifies rate-limit error as rate_limited type', async () => {
    const serve = createEmailServe(smtpConfig);
    const ctx = makeCtx();

    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error('too many requests')),
    });

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('rate_limited');
  });

  it('sets Message-ID header containing idempotency key', async () => {
    const serve = createEmailServe(smtpConfig);
    const idempotencyKey = 'unique-idem-key-123';
    const ctx = makeCtx(idempotencyKey);

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'msg-id' });
    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: sendMailMock,
    });

    await serve.emit(validMessage, ctx);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const callArg = sendMailMock.mock.calls[0]?.[0] as { headers?: Record<string, string> };
    expect(callArg?.headers?.['Message-ID']).toContain(idempotencyKey);
    // Message-ID should follow `<key@from-domain>` pattern
    expect(callArg?.headers?.['Message-ID']).toBe(`<${idempotencyKey}@example.com>`);
  });

  it('falls back to localhost when from address has no @ symbol', async () => {
    const cfgNoAt = { ...smtpConfig, from: 'no-at-symbol' };
    const serve = createEmailServe(cfgNoAt);
    const idempotencyKey = 'idem-no-at';
    const ctx = makeCtx(idempotencyKey);

    const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'msg-id' });
    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: sendMailMock,
    });

    await serve.emit(validMessage, ctx);

    expect(sendMailMock).toHaveBeenCalledOnce();
    const callArg = sendMailMock.mock.calls[0]?.[0] as { headers?: Record<string, string> };
    expect(callArg?.headers?.['Message-ID']).toBe(`<${idempotencyKey}@localhost>`);
  });

  it('classifies generic non-classified error as transient with code smtp_error', async () => {
    const serve = createEmailServe(smtpConfig);
    const ctx = makeCtx();

    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error('something else')),
    });

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
    expect(result.error?.code).toBe('smtp_error');
  });

  it('classifies timeout error as transient with code smtp_timeout', async () => {
    const serve = createEmailServe(smtpConfig);
    const ctx = makeCtx();

    (
      nodemailer as unknown as { default: { createTransport: ReturnType<typeof vi.fn> } }
    ).default.createTransport.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error('connection timeout')),
    });

    const result = await serve.emit(validMessage, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
    expect(result.error?.code).toBe('smtp_timeout');
  });
});
