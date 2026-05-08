import {
  type EmitResult,
  err,
  ok,
  type PipelineContext,
  type Result,
  type ServeError,
} from '@pipeline-kit/core';
import type { EmailMessage, EmailServeConfigSmtp } from '../email-serve.js';
import { generateEmitId, makeServeError } from '../internal.js';

function classifySmtpError(e: unknown): ServeError {
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  const code =
    e instanceof Error && 'code' in e ? String((e as NodeJS.ErrnoException).code ?? '') : '';

  if (
    code === 'EAUTH' ||
    msg.includes('authentication') ||
    msg.includes('535') ||
    msg.includes('534')
  ) {
    return makeServeError('auth', 'smtp_auth_failed', e instanceof Error ? e.message : String(e));
  }

  if (msg.includes('429') || msg.includes('too many')) {
    return makeServeError(
      'rate_limited',
      'smtp_rate_limited',
      e instanceof Error ? e.message : String(e),
    );
  }

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return makeServeError('transient', 'smtp_timeout', e instanceof Error ? e.message : String(e));
  }

  return makeServeError('transient', 'smtp_error', e instanceof Error ? e.message : String(e));
}

export async function sendSmtp(
  config: EmailServeConfigSmtp,
  input: EmailMessage,
  ctx: PipelineContext,
): Promise<Result<EmitResult, ServeError>> {
  let nodemailerMod: typeof import('nodemailer') | undefined;
  try {
    nodemailerMod = await import('nodemailer');
  } catch {
    return err(
      makeServeError(
        'unknown',
        'provider_not_installed',
        'nodemailer peer dependency is not installed',
      ),
    );
  }

  // nodemailer v6/v7 ships CJS with a `.default` re-export in ESM interop;
  // v8+ may expose createTransport directly. Support both shapes.
  const nm: typeof import('nodemailer') =
    (nodemailerMod as unknown as { default?: typeof import('nodemailer') }).default ??
    nodemailerMod;

  const fromDomain = config.from.includes('@')
    ? (config.from.split('@')[1] ?? 'localhost')
    : 'localhost';

  const transporter = nm.createTransport(config.smtp);

  const headers: Record<string, string> = {};
  if (ctx.idempotencyKey) {
    headers['Message-ID'] = `<${ctx.idempotencyKey}@${fromDomain}>`;
  }

  try {
    await transporter.sendMail({
      from: config.from,
      to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      cc: input.cc?.join(', '),
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      headers,
    });
  } catch (e) {
    return err(classifySmtpError(e));
  }

  return ok({
    id: ctx.idempotencyKey ?? generateEmitId(),
    emitted_at: new Date().toISOString(),
    metadata: {},
  });
}
