import {
  type EmitResult,
  err,
  ok,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type Serve,
  type ServeError,
  sign,
  type TokenBucketConfig,
} from '@idriszade/core';
import ipaddr from 'ipaddr.js';
import type { ZodType } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WebhookServeConfig<I> {
  id?: string;
  url: string;
  secret?: string;
  auth?: 'hmac' | 'basic' | 'bearer' | 'apiKey' | 'none';
  authValue?: string;
  headerName?: string;
  idempotencyHeader?: string;
  schema: ZodType<I>;
  ssrf?: { enabled: boolean };
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
}

// ---------------------------------------------------------------------------
// WebhookPayload type alias
// ---------------------------------------------------------------------------

export type WebhookPayload<I> = I;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `pk_emit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeServeError(type: ServeError['type'], code: string, message: string): ServeError {
  // narrowing cast: type is the union discriminant, BaseError fields are common
  return { type, code, message } as ServeError;
}

// Uses ipaddr.js directly rather than ssrf-req-filter: that lib wraps http.Agent for
// node-fetch/axios and is incompatible with native fetch (no agent option). ipaddr.js
// is the underlying primitive ssrf-req-filter uses internally for IP range checks.
export function isSsrfBlocked(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    if (!ipaddr.isValid(hostname)) return false;
    const addr = ipaddr.parse(hostname);
    return addr.range() !== 'unicast';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWebhookServe<I>(config: WebhookServeConfig<I>): Serve<I> {
  const authMode = config.auth ?? 'hmac';

  if (authMode === 'hmac' && !config.secret) {
    throw new Error('WebhookServe: secret is required when auth is "hmac". Pass config.secret.');
  }

  const id = config.id ?? generateId();
  const idempotencyHeader = config.idempotencyHeader ?? 'X-Webhook-Id';

  return {
    id,
    schema: config.schema,
    idempotencySupport: 'required',
    retryPolicy: config.retryPolicy,
    rateLimit: config.rateLimit,

    async emit(input: I, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>> {
      // 1. Validate input
      const parsed = config.schema.safeParse(input);
      if (!parsed.success) {
        return err(
          makeServeError(
            'validation',
            'webhook_validation_error',
            parsed.error.issues.map((i) => i.message).join('; '),
          ),
        );
      }

      // 2. Idempotency key required (idempotencySupport: 'required' contract)
      if (!ctx.idempotencyKey) {
        return err(
          makeServeError(
            'validation',
            'idempotency_key_required',
            'Webhook serve requires ctx.idempotencyKey (idempotencySupport: required)',
          ),
        );
      }

      // 3. SSRF guard
      if (config.ssrf?.enabled && isSsrfBlocked(config.url)) {
        return err(
          makeServeError('validation', 'ssrf_blocked', 'Request to private/loopback IP is blocked'),
        );
      }

      // 4. Serialize body
      const body = JSON.stringify(parsed.data);

      // 5. Build headers
      const headers: Record<string, string> = {};

      // 6. Idempotency header (key guaranteed non-empty by guard above)
      headers[idempotencyHeader] = ctx.idempotencyKey;

      // 7. Auth header
      switch (authMode) {
        case 'hmac': {
          const sig = sign(body, config.secret!, { timestamp: new Date() });
          headers[config.headerName ?? 'X-Pipeline-Kit-Signature'] = sig;
          break;
        }
        case 'bearer': {
          headers['Authorization'] = 'Bearer ' + (config.authValue ?? '');
          break;
        }
        case 'basic': {
          headers['Authorization'] = 'Basic ' + btoa(config.authValue ?? '');
          break;
        }
        case 'apiKey': {
          headers[config.headerName ?? 'X-Api-Key'] = config.authValue ?? '';
          break;
        }
        case 'none':
          break;
      }

      // 8. POST the body
      let response: Response;
      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
        });
      } catch (e) {
        return err(
          makeServeError(
            'network',
            'webhook_network_error',
            e instanceof Error ? e.message : String(e),
          ),
        );
      }

      // 9. Classify response
      if (response.ok) {
        return ok({
          id: ctx.idempotencyKey,
          emitted_at: new Date().toISOString(),
          metadata: {},
        });
      }

      const status = response.status;

      if (status === 401 || status === 403) {
        return err(
          makeServeError('auth', 'webhook_auth_failed', `HTTP ${status}: authentication failed`),
        );
      }

      if (status === 429) {
        return err(
          makeServeError('rate_limited', 'webhook_rate_limited', 'HTTP 429: rate limited'),
        );
      }

      if (status >= 400 && status < 500) {
        return err(
          makeServeError('validation', 'webhook_client_error', `HTTP ${status}: client error`),
        );
      }

      if (status >= 500) {
        return err(
          makeServeError('transient', 'webhook_server_error', `HTTP ${status}: server error`),
        );
      }

      return err(
        makeServeError('unknown', 'webhook_unknown_error', `HTTP ${status}: unexpected status`),
      );
    },
  };
}
