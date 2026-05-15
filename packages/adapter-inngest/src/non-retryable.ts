import { NonRetriableError } from 'inngest';
import type { StageError } from '@idriszade/core';
import { isRetryable } from '@idriszade/core';

/**
 * Maps a StageError to the appropriate Error subclass for Inngest retry behaviour:
 * - non-retryable codes → NonRetryableError (Inngest dead-letters)
 * - retryable or unknown codes → Error (Inngest retries)
 */
export function mapToNonRetryable(error: StageError): Error {
  if (isRetryable(error.code) === false) {
    return new NonRetriableError(`kit:${error.code}: ${error.message}`);
  }
  return new Error(`kit:${error.code}: ${error.message}`);
}
