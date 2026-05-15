import { NonRetriableError } from 'inngest';
import type { Result, StageError } from '@idriszade/core';
import { isRetryable } from '@idriszade/core';

export async function kitStep<T>(
  step: { run: <R>(id: string, fn: () => R | Promise<R>) => Promise<R> },
  id: string,
  fn: () => Promise<Result<T, StageError>>,
): Promise<T> {
  const result = await step.run(id, fn);
  if (result.error !== null) {
    const retryable = isRetryable(result.error.code);
    if (retryable === false) {
      throw new NonRetriableError(`kit:${result.error.code}: ${result.error.message}`);
    }
    throw new Error(`kit:${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}
