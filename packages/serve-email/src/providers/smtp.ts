import { err, ok, type EmitResult, type PipelineContext, type Result, type ServeError } from '@pipeline-kit/core';
import type { EmailServeConfigSmtp } from '../email-serve.js';
import type { EmailMessage } from '../email-serve.js';
import { generateEmitId, makeServeError } from '../email-serve.js';

function classifySmtpError(e: unknown): ServeError {
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  const code = (e as { code?: string }).code ?? '';

  if (
    code === 'EAUTH' ||
    msg.includes('authentication') ||
    msg.includes('535') ||
    msg.includes('534')
  ) {
    return makeServeError('auth', 'smtp_auth_failed', e instanceof Error ? e.message : String(e));
  }

  if (msg.includes('429') || msg.includes('too many')) {
    return makeServeError('rate_limited', 'smtp_rate_limited', e instanceof Error ? e.message : String(e));
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodemailerMod: any;
  try {
    nodemailerMod = await import('nodemailer');
  } catch {
    return err(
      makeServeError('unknown', 'provider_not_installed', 'nodemailer peer dependency is not installed'),
    );
  }

  // nodemailer v8 exports CJS-style; handle both default and direct export
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const nm: { createTransport(opts: unknown): { sendMail(msg: unknown): Promise<unknown> } } =
    nodemailerMod.default ?? nodemailerMod;

  const fromDomain = config.from.includes('@')
    ? (config.from.split('@')[1] ?? 'localhost')
    : 'localhost';

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const transporter = nm.createTransport(config.smtp);

  const headers: Record<string, string> = {};
  if (ctx.idempotencyKey) {
    headers['Message-ID'] = `<${ctx.idempotencyKey}@${fromDomain}>`;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
