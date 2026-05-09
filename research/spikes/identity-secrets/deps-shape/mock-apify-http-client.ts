// Cat VIII spike #6 leg-3 — mock Apify HTTP client.
// Forked from spike #5 (naming-vs-scope/mock-apify-http-client.ts) and
// EXTENDED at the constructor surface for the 3-secret demand:
//   - bearerToken: factory-time read of `apify-token`; closed over and
//     stamped on every request as Authorization: Bearer <...>.
//   - actorId: factory-time read of `apify-actor-id`; HTTP-client target
//     identity (was previously per-request — moved to construction time
//     to honour the leg-3 brief: 3 secrets, all 3 needed up-front, only
//     `apify-token` two-site).
//   - webhookSecret: factory-time read of `apify-webhook-secret`; closed
//     over but NOT used by per-request logic. Presence-in-closed-scope
//     is the only requirement (mintWebhookDigest helper exported for
//     completeness; harness does NOT call it).
//   - signRequest: callable invoked at RUN time per request, producing
//     a fresh per-call id from the live `apify-token` value. Unchanged.
//
// "Fires" the request as console.log only — no real network, no fetch,
// no library deps beyond node:crypto. Returns ok with the stamped
// headers so harness traces are observable.

import { createHmac } from 'node:crypto';
import { type Result, err, ok } from './mock-secrets-resolver.ts';

export interface ApifyHttpRequestOpts {
  // actorId removed from per-request opts — now construction-time only.
  atomId: string;
}

export interface ApifyHttpResponse {
  status: number;
  body: unknown;
  headers_seen: Record<string, string>;
}

export type ApifyHttpErrorCode = 'signer_failed' | 'request_failed';

export interface ApifyHttpError {
  type: 'apify_http_error';
  code: ApifyHttpErrorCode;
  message: string;
  param?: string;
}

export interface ApifyHttpClient {
  request(opts: ApifyHttpRequestOpts): Promise<Result<ApifyHttpResponse, ApifyHttpError>>;
}

// Throwaway HMAC: 16-hex-char digest of atomId under the live signer secret.
// Not a real signing scheme — just a way to make "did the signer use the live
// secret?" observable in trace output.
export function mintCallId(secret: string, atomId: string): string {
  return createHmac('sha256', secret).update(atomId).digest('hex').slice(0, 16);
}

// Companion helper for the webhook-secret read-site. The harness does
// NOT call this — its only purpose is to make the closed-over
// `webhookSecret` observably "in scope" at the call-site level. If a
// future spike or adapter wants real outbound-webhook signing, this is
// the natural lift surface.
export function mintWebhookDigest(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
}

export interface ApifyHttpClientFactoryOpts {
  // Resolved at FACTORY time → installed once on the interceptor closure.
  bearerToken: string;
  // Resolved at FACTORY time → HTTP-client target identity.
  actorId: string;
  // Resolved at FACTORY time → handed to a no-op outbound-webhook-signer
  // stub. Closed over but not invoked per-request in this spike.
  webhookSecret: string;
  // Called at RUN time per request. Returns the per-request signature value.
  signRequest: (atomId: string) => Promise<Result<string, ApifyHttpError>>;
}

export function createApifyHttpClient(opts: ApifyHttpClientFactoryOpts): ApifyHttpClient {
  const { bearerToken, actorId, webhookSecret, signRequest } = opts;

  // One-line construction trace so the 3 factory-time reads are
  // observable in the harness output. We log the webhook secret's last
  // 4 chars only (no real backends, but pretend it's secret-y).
  const tail = webhookSecret.slice(-4);
  console.log(
    `[apify-http] client built bearer=${bearerToken} actor=${actorId} webhook_secret_tail=${tail}`,
  );

  return {
    async request(reqOpts: ApifyHttpRequestOpts) {
      // Per-request signer call — the run-time site for `apify-token`.
      const sig = await signRequest(reqOpts.atomId);
      if (sig.error !== null) return err(sig.error);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${bearerToken}`,
        'x-apify-call-id': sig.data,
        'x-apify-actor-id': actorId,
        'x-apify-atom-id': reqOpts.atomId,
      };

      // "Fire" the synthetic request — no real network.
      console.log(
        `[apify-http] POST /v1/actors/${actorId}/runs ` +
          `bearer=${bearerToken} call_id=${sig.data} atom=${reqOpts.atomId}`,
      );

      // Closed-over `webhookSecret` is intentionally referenced via
      // mintWebhookDigest export shape only; per-request logic does
      // not invoke it. (TS would otherwise emit unused-binding
      // warnings under strict noUnusedLocals — we read tail above.)
      void mintWebhookDigest;

      return ok({
        status: 200,
        body: { runId: `apify_run_${reqOpts.atomId}` },
        headers_seen: headers,
      });
    },
  };
}
