/**
 * Raw web-standards handler that can be used without Hono.
 * Validates HMAC, parses body with a Zod schema, and calls an onAtom callback.
 *
 * This is intentionally a thin function so callers that already have a
 * web-standards Request/Response runtime (e.g. Cloudflare Workers, Deno Deploy)
 * can use it directly without pulling in Hono.
 */
import { verify } from '@pipeline-kit/core';
import type { ZodType } from 'zod';

const DEFAULT_HEADER_NAME = 'X-Pipeline-Kit-Signature';
const DEFAULT_TOLERANCE_MS = 300_000;

export interface RawHandlerConfig<O> {
  secret: string;
  schema: ZodType<O>;
  onAtom: (data: O, idempotencyKey?: string) => void;
  verify?: {
    tolerance?: number;
    acceptedAlgorithms?: ('v1' | 'v2')[];
    headerName?: string;
  };
  idempotencyHeader?: string;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function createRawHandler<O>(
  req: Request,
  cfg: RawHandlerConfig<O>,
): Promise<Response> {
  const headerName = cfg.verify?.headerName ?? DEFAULT_HEADER_NAME;
  const tolerance = cfg.verify?.tolerance ?? DEFAULT_TOLERANCE_MS;
  const acceptedAlgorithms = cfg.verify?.acceptedAlgorithms ?? (['v1'] as const);

  const sigHeader = req.headers.get(headerName);
  if (!sigHeader) {
    return jsonError(400, 'missing_signature', `Missing required header: ${headerName}`);
  }

  const rawBody = await req.text();

  const verifyResult = verify(rawBody, sigHeader, cfg.secret, {
    tolerance,
    acceptedAlgorithms,
  });

  if (verifyResult.error !== null) {
    const e = verifyResult.error;
    if (e.type !== 'invalid_payload') {
      return jsonError(400, e.code, e.message);
    }
  }

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError(400, 'json_parse', 'Request body is not valid JSON');
  }

  const parsed = cfg.schema.safeParse(rawParsed);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return jsonError(400, 'schema_mismatch', message);
  }

  const idempotencyKey = cfg.idempotencyHeader
    ? (req.headers.get(cfg.idempotencyHeader) ?? undefined)
    : undefined;

  cfg.onAtom(parsed.data, idempotencyKey);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
