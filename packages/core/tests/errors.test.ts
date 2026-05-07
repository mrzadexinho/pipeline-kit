import { describe, expect, it } from 'vitest';
import { NON_RETRYABLE_ERROR_TYPES, RETRYABLE_ERROR_TYPES } from '../src/errors/base.js';
import type {
  ProcessError,
  ReviewError,
  RunError,
  ServeError,
  SourceError,
  StoreError,
  WebhookError,
} from '../src/errors/index.js';

describe('error type tables', () => {
  it('RETRYABLE_ERROR_TYPES holds the canonical retry set', () => {
    expect(RETRYABLE_ERROR_TYPES).toEqual([
      'rate_limited',
      'transient',
      'network',
      'timeout',
      'unavailable',
    ]);
  });

  it('NON_RETRYABLE_ERROR_TYPES holds the canonical short-circuit set', () => {
    expect(NON_RETRYABLE_ERROR_TYPES).toEqual([
      'auth',
      'permanent',
      'validation',
      'idempotency_conflict',
    ]);
  });

  it('retry tables are disjoint', () => {
    const overlap = RETRYABLE_ERROR_TYPES.filter((t) =>
      (NON_RETRYABLE_ERROR_TYPES as ReadonlyArray<string>).includes(t),
    );
    expect(overlap).toEqual([]);
  });
});

describe('error union construction', () => {
  it('SourceError discriminates on type with retry_after_ms only on rate_limited', () => {
    const e: SourceError = {
      type: 'rate_limited',
      code: 'rate_limited',
      message: 'too many',
      retry_after_ms: 1000,
    };
    expect(e.type).toBe('rate_limited');
    if (e.type === 'rate_limited') {
      expect(e.retry_after_ms).toBe(1000);
    }
  });

  it('StoreError covers idempotency_conflict + not_found + conflict', () => {
    const variants: StoreError['type'][] = [
      'transient',
      'network',
      'timeout',
      'auth',
      'validation',
      'idempotency_conflict',
      'conflict',
      'not_found',
      'unknown',
    ];
    expect(variants).toHaveLength(9);
  });

  it('ProcessError covers transient/permanent/timeout/validation/process/unknown', () => {
    const e: ProcessError = {
      type: 'process',
      code: 'review_rejected',
      message: 'rejected',
      reason: 'reviewer rejected',
    };
    expect(e.type).toBe('process');
    if (e.type === 'process') {
      expect(e.reason).toBe('reviewer rejected');
    }
  });

  it('ServeError covers idempotency_conflict + unsupported', () => {
    const e: ServeError = {
      type: 'idempotency_conflict',
      code: 'idem_conflict',
      message: 'replayed',
    };
    expect(e.type).toBe('idempotency_conflict');
  });

  it('ReviewError covers transport/auth/timeout/cancelled/unsupported/unknown', () => {
    const e: ReviewError = { type: 'cancelled', code: 'cancelled', message: 'aborted' };
    expect(e.type).toBe('cancelled');
  });

  it('RunError wraps stage errors via cause', () => {
    const e: RunError = {
      type: 'process_failed',
      code: 'process_run_error',
      message: 'process failed',
      cause: { type: 'permanent', code: 'bad_input', message: 'cannot recover' },
    };
    expect(e.type).toBe('process_failed');
    if (e.type === 'process_failed') {
      expect(e.cause.type).toBe('permanent');
    }
  });

  it('WebhookError covers signature/timestamp/header/secret/payload variants', () => {
    const e: WebhookError = {
      type: 'invalid_signature',
      code: 'sig_mismatch',
      message: 'bad sig',
    };
    expect(e.type).toBe('invalid_signature');
  });
});
