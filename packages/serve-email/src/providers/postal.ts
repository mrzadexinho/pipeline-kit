import { err, ok, type EmitResult, type PipelineContext, type Result, type ServeError } from '@pipeline-kit/core';
import type { EmailServeConfigPostal, EmailMessage } from '../email-serve.js';
import { generateEmitId, makeServeError } from '../internal.js';

function classifyPostalStatus(status: number, body: unknown): ServeError {
  const msg = JSON.stringify(body);
  if (status === 422) {
    return makeServeError('validation', 'postal_validation_error', msg);
  }
  if (status === 401 || status === 403) {
    return makeServeError('auth', 'postal_auth_failed', msg);
  }
  if (status === 429) {
    return makeServeError('rate_limited', 'postal_rate_limited', msg);
  }
  if (status >= 500) {
    return makeServeError('transient', 'postal_server_error', msg);
  }
  return makeServeError('unknown', 'postal_unexpected_status', `Unexpected status ${status}: ${msg}`);
}

export async function sendPostal(
  config: EmailServeConfigPostal,
  input: EmailMessage,
  ctx: PipelineContext,
): Promise<Result<EmitResult, ServeError>> {
  const url = `${config.postal.apiUrl}/api/v1/send/message`;

  const body = {
    from: config.from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html_body: input.html,
    plain_body: input.text,
    cc: input.cc,
    attachments: input.attachments?.map((a) => ({
      name: a.filename,
      content_type: 'application/octet-stream',
      data: a.content,
    })),
  };

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Server-API-Key': config.postal.apiKey,
  };

  if (ctx.idempotencyKey) {
    requestHeaders['X-Idempotency-Key'] = ctx.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return err(
      makeServeError('network', 'postal_network_error', e instanceof Error ? e.message : String(e)),
    );
  }

  if (!response.ok) {
    let respBody: unknown;
    try {
      respBody = await response.json();
    } catch {
      respBody = { raw: await response.text().catch(() => '') };
    }
    return err(classifyPostalStatus(response.status, respBody));
  }

  return ok({
    id: ctx.idempotencyKey ?? generateEmitId(),
    emitted_at: new Date().toISOString(),
    metadata: {},
  });
}
