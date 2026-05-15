import { describe, expect, it } from 'vitest';
import {
  isRetryable,
  RETRYABILITY_MAP,
  type StageError,
  type StageErrorCode,
} from '../src/stage-error.js';

const ALL_CODES: StageErrorCode[] = [
  'source_unavailable',
  'source_timeout',
  'source_auth_failed',
  'source_schema_invalid',
  'process_failed',
  'process_timeout',
  'process_invalid_output',
  'serve_failed',
  'serve_timeout',
  'serve_auth_failed',
  'serve_idempotency_conflict',
  'gate_rejected',
  'gate_timeout',
  'gate_hold_expired',
  'runtime_retry_exhausted',
  'runtime_cancelled',
  'runtime_concurrency_rejected',
  'resource_expired',
  'runtime_budget_exceeded',
];

describe('StageErrorCode', () => {
  it('RETRYABILITY_MAP covers every code (completeness)', () => {
    for (const code of ALL_CODES) {
      expect(RETRYABILITY_MAP.has(code), `missing: ${code}`).toBe(true);
    }
  });

  it('RETRYABILITY_MAP has exactly 19 entries', () => {
    expect(RETRYABILITY_MAP.size).toBe(19);
  });

  it('isRetryable returns true for always-retryable codes', () => {
    const always: StageErrorCode[] = [
      'source_unavailable',
      'source_timeout',
      'process_timeout',
      'serve_timeout',
      'gate_timeout',
      'gate_hold_expired',
      'runtime_concurrency_rejected',
      'resource_expired',
    ];
    for (const code of always) {
      expect(isRetryable(code), code).toBe(true);
    }
  });

  it('isRetryable returns false for never-retryable codes', () => {
    const never: StageErrorCode[] = [
      'source_auth_failed',
      'source_schema_invalid',
      'process_invalid_output',
      'serve_auth_failed',
      'serve_idempotency_conflict',
      'gate_rejected',
      'runtime_retry_exhausted',
      'runtime_cancelled',
      'runtime_budget_exceeded',
    ];
    for (const code of never) {
      expect(isRetryable(code), code).toBe(false);
    }
  });

  it('isRetryable returns null for unknown codes', () => {
    expect(isRetryable('process_failed')).toBeNull();
    expect(isRetryable('serve_failed')).toBeNull();
  });

  it('StageError can be constructed with required fields only', () => {
    const e: StageError = {
      type: 'stage_error',
      code: 'process_failed',
      message: 'something went wrong',
    };
    expect(e.type).toBe('stage_error');
    expect(e.code).toBe('process_failed');
  });

  it('StageError accepts all optional fields', () => {
    const e: StageError = {
      type: 'stage_error',
      code: 'serve_auth_failed',
      message: 'unauthorized',
      param: 'api_key',
      doc_url: 'https://example.com/docs',
      retryable: false,
    };
    expect(e.param).toBe('api_key');
    expect(e.doc_url).toBe('https://example.com/docs');
    expect(e.retryable).toBe(false);
  });
});
