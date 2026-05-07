import { err, ok, type EmitResult, type PipelineContext, type Result, type ServeError } from '@pipeline-kit/core';
import type { CreateEmailOptions, CreateEmailRequestOptions } from 'resend';
import type { EmailServeConfigResend, EmailMessage } from '../email-serve.js';
import { generateEmitId, makeServeError } from '../internal.js';

function classifyResendError(name: string, statusCode: number | null, message: string): ServeError {
  const nameLower = name.toLowerCase();
  if (
    nameLower === 'invalid_api_key' ||
    nameLower === 'missing_api_key' ||
    nameLower === 'restricted_api_key' ||
    nameLower === 'unauthorized' ||
    statusCode === 401
  ) {
    return makeServeError('auth', 'resend_auth_failed', message);
  }
  if (nameLower === 'rate_limit_exceeded' || statusCode === 429) {
    return makeServeError('rate_limited', 'resend_rate_limited', message);
  }
  if (statusCode !== null && statusCode >= 500) {
    return makeServeError('transient', 'resend_server_error', message);
  }
  return makeServeError('unknown', 'resend_error', message);
}

export async function sendResend(
  config: EmailServeConfigResend,
  input: EmailMessage,
  ctx: PipelineContext,
): Promise<Result<EmitResult, ServeError>> {
  let ResendClass: typeof import('resend').Resend;
  try {
    const mod = await import('resend');
    ResendClass = mod.Resend;
  } catch {
    return err(
      makeServeError('unknown', 'provider_not_installed', 'resend peer dependency is not installed'),
    );
  }

  const client = new ResendClass(config.resend.apiKey);

  // CreateEmailOptions requires at least one of react/html/text; our EmailMessage
  // schema allows both optional. The cast is intentional: if neither is provided,
  // the SDK returns a validation error that is caught by the error-handling block
  // below, so the invariant is enforced at runtime rather than compile time.
  const payload = {
    from: config.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    cc: input.cc,
    attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  } as unknown as CreateEmailOptions;

  const options: CreateEmailRequestOptions | undefined = ctx.idempotencyKey
    ? { idempotencyKey: ctx.idempotencyKey }
    : undefined;

  let result: { data: { id: string } | null; error: { name: string; statusCode: number | null; message: string } | null };
  try {
    result = await (options
      ? client.emails.send(payload, options)
      : client.emails.send(payload)) as typeof result;
  } catch (e) {
    return err(
      makeServeError('unknown', 'resend_unexpected', e instanceof Error ? e.message : String(e)),
    );
  }

  if (result.error) {
    return err(
      classifyResendError(result.error.name, result.error.statusCode, result.error.message),
    );
  }

  return ok({
    id: ctx.idempotencyKey ?? result.data?.id ?? generateEmitId(),
    emitted_at: new Date().toISOString(),
    metadata: {},
  });
}
