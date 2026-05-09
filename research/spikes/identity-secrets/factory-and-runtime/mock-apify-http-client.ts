// Cat VIII spike #3 — mock Apify HTTP client.
// Fixture for the two-site adapter. The factory takes:
//   - bearerToken: a string resolved at FACTORY time and closed over by the
//     interceptor; stamped on every request as Authorization: Bearer <...>.
//   - signRequest: a callable invoked at RUN time per request, producing a
//     fresh per-call id from the live secret value.
//
// "Fires" the request as console.log only — no real network, no fetch, no
// node:http, no library deps beyond node:crypto. Returns ok with the
// stamped headers so harness traces are observable.

import { createHmac } from 'node:crypto';
import { err, ok, type Result } from './mock-secrets-resolver.ts';

export interface ApifyHttpRequestOpts {
  actorId: string;
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

export interface ApifyHttpClientFactoryOpts {
  // Resolved at FACTORY time → installed once on the interceptor closure.
  bearerToken: string;
  // Called at RUN time per request. Returns the per-request signature value.
  signRequest: (atomId: string) => Promise<Result<string, ApifyHttpError>>;
}

export function createApifyHttpClient(opts: ApifyHttpClientFactoryOpts): ApifyHttpClient {
  const { bearerToken, signRequest } = opts;
  return {
    async request(reqOpts: ApifyHttpRequestOpts) {
      // Per-request signer call — the run-time site.
      const sig = await signRequest(reqOpts.atomId);
      if (sig.error !== null) return err(sig.error);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${bearerToken}`,
        'x-apify-call-id': sig.data,
        'x-apify-actor-id': reqOpts.actorId,
        'x-apify-atom-id': reqOpts.atomId,
      };

      // "Fire" the synthetic request — no real network.
      console.log(
        `[apify-http] POST /v1/actors/${reqOpts.actorId}/runs ` +
          `bearer=${bearerToken} call_id=${sig.data} atom=${reqOpts.atomId}`,
      );

      return ok({
        status: 200,
        body: { runId: `apify_run_${reqOpts.atomId}` },
        headers_seen: headers,
      });
    },
  };
}
