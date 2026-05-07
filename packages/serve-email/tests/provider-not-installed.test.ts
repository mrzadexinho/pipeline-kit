import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContext } from '../../core/src/context.js';

// We test the provider_not_installed error code by mocking the dynamic import
// at the provider module level. Since vi.mock hoists to the top, we declare
// the mocks here and control them per-test via the internal __fail__ flag.

let nodemailerShouldFail = false;
let resendShouldFail = false;

vi.mock('nodemailer', async (importOriginal) => {
  if (nodemailerShouldFail) {
    throw Object.assign(new Error('Cannot find module nodemailer'), { code: 'MODULE_NOT_FOUND' });
  }
  return importOriginal();
});

vi.mock('resend', async (importOriginal) => {
  if (resendShouldFail) {
    throw Object.assign(new Error('Cannot find module resend'), { code: 'MODULE_NOT_FOUND' });
  }
  return importOriginal();
});

// Import providers AFTER mocks are declared so they use the mocked modules
const { sendSmtp } = await import('../src/providers/smtp.js');
const { sendResend } = await import('../src/providers/resend.js');

const validMessage = {
  to: 'recipient@example.com',
  subject: 'Test',
  text: 'Hello',
};

const smtpConfig = {
  provider: 'smtp' as const,
  smtp: { host: 'smtp.example.com', port: 587, auth: { user: 'u', pass: 'p' } },
  from: 'test@example.com',
};

const resendConfig = {
  provider: 'resend' as const,
  resend: { apiKey: 'key' },
  from: 'test@example.com',
};

function makeCtx() {
  return createContext({ pipelineId: 'pipe_test' });
}

describe('provider-not-installed', () => {
  beforeEach(() => {
    nodemailerShouldFail = false;
    resendShouldFail = false;
    vi.resetModules();
  });

  it('returns provider_not_installed when nodemailer dynamic import fails', async () => {
    nodemailerShouldFail = true;

    const result = await sendSmtp(smtpConfig, validMessage, makeCtx());

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('provider_not_installed');
    expect(result.error?.type).toBe('unknown');
  });

  it('returns provider_not_installed when resend dynamic import fails', async () => {
    resendShouldFail = true;

    const result = await sendResend(resendConfig, validMessage, makeCtx());

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('provider_not_installed');
    expect(result.error?.type).toBe('unknown');
  });
});
