import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { err, ok, type Result } from '../result.js';
import type { VerifyError, VerifyWebhookOptions } from './types.js';

const DEFAULT_TOLERANCE_MS = 300_000;
const DEFAULT_PREFIX = 'v1';

interface ParsedHeader {
  timestamp: number;
  signatures: Record<string, string>;
}

function parseHeader(sigHeader: string): ParsedHeader | null {
  const parts = sigHeader.split(',');
  let timestamp: number | undefined;
  const signatures: Record<string, string> = {};

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') return null;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return null;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) return null;
      timestamp = parsed;
    } else if (key !== '') {
      signatures[key] = value;
    }
  }

  if (timestamp === undefined) return null;
  return { timestamp, signatures };
}

function signaturesEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * General-purpose raw-payload HMAC verifier symmetric to `sign()`.
 *
 * Use this in **Serve adapter authors** to verify arbitrary inbound webhook
 * payloads where the caller owns the secret rotation lifecycle. Returns a
 * `Result<true, VerifyError>` — a raw crypto primitive that does NOT parse
 * or return a typed domain event.
 *
 * For verifying pipeline-kit's own inbound webhook events (which also parse
 * and validate the body as a `PipelineKitEvent`), use `verify()` instead.
 *
 * @example
 * ```ts
 * const result = verifyWebhook(req.rawBody, req.headers['x-signature'], secret);
 * if (result.error) { ... }
 * ```
 *
 * @param payload       Raw request body — `Buffer` or `string`.
 * @param signatureHeader  The signature header value (`t=<ts>,v1=<hex>`).
 * @param secret        One secret or an ordered array for key rotation.
 *                      Returns `ok(true)` on the **first** matching key.
 * @param opts          Optional overrides for tolerance and prefix.
 */
export function verifyWebhook(
  payload: Buffer | string,
  signatureHeader: string,
  secret: string | string[],
  opts?: VerifyWebhookOptions,
): Result<true, VerifyError> {
  const tolerance = opts?.tolerance ?? DEFAULT_TOLERANCE_MS;
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;

  // Normalise payload to string for hashing
  const rawPayload = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;

  // Parse header
  const parsed = parseHeader(signatureHeader);
  if (parsed === null) {
    return err({
      code: 'malformed_header',
      message: `Signature header is not in t=...,${prefix}=... format`,
    });
  }

  // Timestamp tolerance check
  const nowSeconds = Math.floor(Date.now() / 1000);
  const driftMs = Math.abs((nowSeconds - parsed.timestamp) * 1000);
  if (driftMs > tolerance) {
    return err({
      code: 'timestamp_expired',
      message: `Signature timestamp drift ${driftMs}ms exceeds tolerance ${tolerance}ms`,
    });
  }

  // Extract the signature for the requested prefix
  const providedSig = parsed.signatures[prefix];
  if (providedSig === undefined) {
    return err({
      code: 'malformed_header',
      message: `No signature found for prefix '${prefix}' in header`,
    });
  }

  // Multi-key: try each secret in sequence; ok(true) on first match
  const secrets = Array.isArray(secret) ? secret : [secret];
  const signedPayload = `${parsed.timestamp}.${rawPayload}`;

  for (const s of secrets) {
    const expected = createHmac('sha256', s).update(signedPayload).digest('hex');
    if (signaturesEqual(providedSig, expected)) {
      return ok(true);
    }
  }

  return err({
    code: 'signature_mismatch',
    message: 'No provided secret matched the signature',
  });
}
