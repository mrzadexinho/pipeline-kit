import { NonRetriableError } from 'inngest';
import { describe, expect, it } from 'vitest';
import { RETRYABILITY_MAP } from '@idriszade/core';
import type { StageError, StageErrorCode } from '@idriszade/core';
import { mapToNonRetryable } from '../src/non-retryable.js';

function makeError(code: StageErrorCode): StageError {
  return { type: 'stage_error', code, message: `test: ${code}` };
}

const nonRetryableCodes: StageErrorCode[] = [...RETRYABILITY_MAP.entries()]
  .filter(([, v]) => v === 'never')
  .map(([k]) => k);

const retryableCodes: StageErrorCode[] = [...RETRYABILITY_MAP.entries()]
  .filter(([, v]) => v === 'always')
  .map(([k]) => k);

const unknownCodes: StageErrorCode[] = [...RETRYABILITY_MAP.entries()]
  .filter(([, v]) => v === 'unknown')
  .map(([k]) => k);

describe('mapToNonRetryable', () => {
  it('returns NonRetriableError for all non-retryable codes', () => {
    for (const code of nonRetryableCodes) {
      const result = mapToNonRetryable(makeError(code));
      expect(result, `code: ${code}`).toBeInstanceOf(NonRetriableError);
    }
  });

  it('returns plain Error (not NonRetriableError) for all retryable codes', () => {
    for (const code of retryableCodes) {
      const result = mapToNonRetryable(makeError(code));
      expect(result, `code: ${code}`).toBeInstanceOf(Error);
      expect(result, `code: ${code}`).not.toBeInstanceOf(NonRetriableError);
    }
  });

  it('returns plain Error (not NonRetriableError) for unknown-retryability codes', () => {
    for (const code of unknownCodes) {
      const result = mapToNonRetryable(makeError(code));
      expect(result, `code: ${code}`).toBeInstanceOf(Error);
      expect(result, `code: ${code}`).not.toBeInstanceOf(NonRetriableError);
    }
  });

  it('error message includes code', () => {
    const error = makeError('source_auth_failed');
    const result = mapToNonRetryable(error);
    expect(result.message).toContain('source_auth_failed');
  });

  it('error message includes original message', () => {
    const error: StageError = { type: 'stage_error', code: 'gate_rejected', message: 'denied by reviewer' };
    const result = mapToNonRetryable(error);
    expect(result.message).toContain('denied by reviewer');
  });

  it('error message follows kit:<code>: <message> format', () => {
    const error: StageError = { type: 'stage_error', code: 'runtime_budget_exceeded', message: 'over budget' };
    const result = mapToNonRetryable(error);
    expect(result.message).toBe('kit:runtime_budget_exceeded: over budget');
  });
});
