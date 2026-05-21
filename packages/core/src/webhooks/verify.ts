import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookError } from '../errors/webhook.js';
import { err, ok, type Result } from '../result.js';
import type { PipelineKitEvent, VerifyOptions, WebhookAlgorithm } from './types.js';

const DEFAULT_TOLERANCE_MS = 300_000;
const DEFAULT_ACCEPTED_ALGORITHMS: ReadonlyArray<WebhookAlgorithm> = ['v1'];

const VALID_EVENT_TYPES: ReadonlyArray<PipelineKitEvent['type']> = [
  'pipeline.run.created',
  'pipeline.run.completed',
  'pipeline.run.failed',
  'review.created',
  'review.decided',
];

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

function isPipelineKitEvent(value: unknown): value is PipelineKitEvent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
  if (!VALID_EVENT_TYPES.includes(obj.type as PipelineKitEvent['type'])) return false;
  return typeof obj.data === 'object' && obj.data !== null;
}

/**
 * Domain-typed inbound webhook verifier for pipeline-kit's own events.
 *
 * Verifies the HMAC signature, checks timestamp tolerance, parses the body
 * as JSON, and validates it as a `PipelineKitEvent` — returning the typed
 * event on success.
 *
 * Use this when **receiving** pipeline-kit webhook deliveries (e.g. in a
 * server route that handles `pipeline.run.completed` events).
 *
 * For verifying arbitrary inbound payloads (e.g. from third-party callers
 * signing with `sign()`), use the raw-primitive `verifyWebhook()` instead.
 *
 * @param rawBody   Raw UTF-8 request body string.
 * @param sigHeader The signature header value (`t=<ts>,v1=<hex>`).
 * @param secret    Webhook signing secret.
 * @param options   Optional tolerance and accepted-algorithms overrides.
 */
export function verify(
  rawBody: string,
  sigHeader: string,
  secret: string,
  options?: VerifyOptions,
): Result<PipelineKitEvent, WebhookError> {
  if (secret === '') {
    return err({
      type: 'missing_secret',
      code: 'no_secret',
      message: 'Webhook verification requires a non-empty secret',
    });
  }

  const parsed = parseHeader(sigHeader);
  if (parsed === null) {
    return err({
      type: 'malformed_header',
      code: 'parse_failed',
      message: 'Signature header is not in t=...,v1=... format',
    });
  }

  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE_MS;
  const accepted = options?.acceptedAlgorithms ?? DEFAULT_ACCEPTED_ALGORITHMS;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const driftMs = Math.abs((nowSeconds - parsed.timestamp) * 1000);
  if (driftMs > tolerance) {
    return err({
      type: 'expired_timestamp',
      code: 'tolerance_exceeded',
      message: `Signature timestamp drift ${driftMs}ms exceeds tolerance ${tolerance}ms`,
    });
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  let matched = false;
  for (const alg of accepted) {
    const provided = parsed.signatures[alg];
    if (provided === undefined) continue;
    if (signaturesEqual(provided, expected)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return err({
      type: 'invalid_signature',
      code: 'sig_mismatch',
      message: 'No accepted algorithm signature matched',
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return err({
      type: 'invalid_payload',
      code: 'json_parse',
      message: 'Webhook body is not valid JSON',
    });
  }

  if (!isPipelineKitEvent(parsedBody)) {
    return err({
      type: 'invalid_payload',
      code: 'unknown_event',
      message: 'Webhook body is not a recognised PipelineKitEvent',
    });
  }

  return ok(parsedBody);
}
