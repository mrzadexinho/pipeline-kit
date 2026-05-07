import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext, TraceContext } from '@pipeline-kit/core';

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: {} as unknown as TraceContext,
    attachMetadata(k: string, v: unknown) { meta[k] = v; },
  };
}

describe('provider-not-installed', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('smtp: returns provider_not_installed when nodemailer is missing', async () => {
    vi.doMock('nodemailer', () => {
      throw Object.assign(new Error('Cannot find module nodemailer'), { code: 'MODULE_NOT_FOUND' });
    });
    // Re-import after mocking so the fresh module hasn't cached nodemailer yet
    const { createEmailServe } = await import('../src/email-serve.js');
    const serve = createEmailServe({
      provider: 'smtp',
      smtp: { host: 'smtp.test', port: 587, auth: { user: 'u', pass: 'p' } },
      from: 'test@example.com',
    });
    const ctx = makeCtx();
    const result = await serve.emit({ to: 'to@example.com', subject: 'Hi' }, ctx);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('provider_not_installed');
    expect(result.error?.type).toBe('unknown');
  });

  it('resend: returns provider_not_installed when resend is missing', async () => {
    vi.doMock('resend', () => {
      throw Object.assign(new Error('Cannot find module resend'), { code: 'MODULE_NOT_FOUND' });
    });
    // Re-import after mocking so the fresh module hasn't cached resend yet
    const { createEmailServe } = await import('../src/email-serve.js');
    const serve = createEmailServe({
      provider: 'resend',
      resend: { apiKey: 'key' },
      from: 'test@example.com',
    });
    const ctx = makeCtx();
    const result = await serve.emit({ to: 'to@example.com', subject: 'Hi' }, ctx);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('provider_not_installed');
    expect(result.error?.type).toBe('unknown');
  });
});
