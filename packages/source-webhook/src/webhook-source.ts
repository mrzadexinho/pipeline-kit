import {
  type Atom,
  atom as atomId,
  ok,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type Source,
  type SourceError,
  type SourceQuery,
  src as srcId,
  verify,
} from '@pipeline-kit/core';
import { Hono } from 'hono';
import type { ZodType } from 'zod';
import { AsyncQueue } from './async-queue.js';

const DEFAULT_HEADER_NAME = 'X-Pipeline-Kit-Signature';
const DEFAULT_TOLERANCE_MS = 300_000;

export type WebhookHandler = (req: Request) => Promise<Response>;

export interface WebhookVerifyConfig {
  /** Timestamp drift tolerance in ms. Default 300_000 (5 min). */
  tolerance?: number;
  /** HMAC algorithm variants to accept. Default ['v1']. */
  acceptedAlgorithms?: ('v1' | 'v2')[];
  /** Header to read the signature from. Default 'X-Pipeline-Kit-Signature'. */
  headerName?: string;
}

export interface WebhookSourceConfig<O> {
  id?: string;
  /** HTTP path to register, e.g. '/webhooks/stripe'. */
  path: string;
  /** HMAC secret used to verify incoming requests. */
  secret: string;
  /** Zod schema to parse and validate the request body. */
  schema: ZodType<O>;
  verify?: WebhookVerifyConfig;
  /** Header name whose value is used as idempotency key on buffered atoms. */
  idempotencyHeader?: string;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface WebhookSource<O> extends Source<O> {
  /** Pre-wired Hono app with the POST route registered. */
  readonly app: Hono;
  /** Raw web-standards handler — delegates to the Hono app. */
  readonly handler: WebhookHandler;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createWebhookSource<O>(config: WebhookSourceConfig<O>): WebhookSource<O> {
  const resolvedId = config.id ?? srcId();
  const headerName = config.verify?.headerName ?? DEFAULT_HEADER_NAME;
  const tolerance = config.verify?.tolerance ?? DEFAULT_TOLERANCE_MS;
  const acceptedAlgorithms = config.verify?.acceptedAlgorithms ?? (['v1'] as const);

  // Internal buffer shared between the HTTP handler and iter/fetch callers.
  const queue = new AsyncQueue<Atom<O>>();

  const app = new Hono();

  app.post(config.path, async (c) => {
    const sigHeader = c.req.header(headerName);
    if (!sigHeader) {
      return jsonError(400, 'missing_signature', `Missing required header: ${headerName}`);
    }

    const rawBody = await c.req.text();

    // HMAC verification — we re-use core's verify but only for sig + timestamp.
    // The schema parse below validates the actual payload shape, so we tolerate
    // non-PipelineKitEvent bodies by calling the lower-level path.
    // core's verify() also JSON.parses and type-checks for PipelineKitEvent.
    // For arbitrary schemas we just need sig + timestamp check, then let Zod run.
    const verifyResult = verify(rawBody, sigHeader, config.secret, {
      tolerance,
      acceptedAlgorithms,
    });

    if (verifyResult.error !== null) {
      const e = verifyResult.error;
      if (e.type === 'expired_timestamp') {
        return jsonError(400, e.code, e.message);
      }
      if (e.type === 'missing_secret' || e.type === 'malformed_header') {
        return jsonError(400, e.code, e.message);
      }
      if (e.type === 'invalid_signature') {
        return jsonError(400, e.code, e.message);
      }
      // invalid_payload from JSON/event-type check is fine — we'll re-parse with Zod below.
      if (e.type !== 'invalid_payload') {
        return jsonError(400, e.code, e.message);
      }
    }

    // Parse raw JSON for schema validation.
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(rawBody) as unknown;
    } catch {
      return jsonError(400, 'json_parse', 'Request body is not valid JSON');
    }

    const parsed = config.schema.safeParse(rawParsed);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      return jsonError(400, 'schema_mismatch', message);
    }

    const idempotencyKey = config.idempotencyHeader
      ? c.req.header(config.idempotencyHeader)
      : undefined;

    const atomItem: Atom<O> = {
      id: atomId(),
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: idempotencyKey ? { idempotency_key: idempotencyKey } : {},
      data: parsed.data,
      source_id: resolvedId,
    };

    queue.push(atomItem);

    return new Response(JSON.stringify({ id: atomItem.id, object: 'atom' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  async function* iterImpl(_query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>> {
    for await (const item of queue[Symbol.asyncIterator](ctx.signal)) {
      yield item;
    }
  }

  async function fetchImpl(
    _query: SourceQuery,
    _ctx: PipelineContext,
  ): Promise<Result<Atom<O>[], SourceError>> {
    // Non-blocking snapshot drain — returns whatever is buffered and clears it.
    const buffered = queue.drain();
    return ok(buffered);
  }

  const handler: WebhookHandler = (req: Request): Promise<Response> =>
    Promise.resolve(app.fetch(req));

  return {
    id: resolvedId,
    schema: config.schema,
    retryPolicy: config.retryPolicy,
    app,
    handler,
    iter: iterImpl,
    fetch: fetchImpl,
  };
}
