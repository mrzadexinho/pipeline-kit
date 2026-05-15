import type { StageError } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { kitStep } from '../src/kit-step.js';

function makeStep<T>(_returnValue: T) {
  const run = vi.fn(async (_id: string, fn: () => T | Promise<T>) => fn());
  return { run, step: { run } };
}

const nonRetryableError: StageError = {
  type: 'stage_error',
  code: 'source_auth_failed',
  message: 'credentials rejected',
};

const retryableError: StageError = {
  type: 'stage_error',
  code: 'source_unavailable',
  message: 'upstream offline',
};

const unknownError: StageError = {
  type: 'stage_error',
  code: 'process_failed',
  message: 'process blew up',
};

describe('kitStep', () => {
  it('returns unwrapped value on Result.ok', async () => {
    const { step } = makeStep(ok('hello'));
    const result = await kitStep(step, 'my-step', async () => ok('hello'));
    expect(result).toBe('hello');
  });

  it('calls step.run with the correct id', async () => {
    const { step, run } = makeStep(ok(42));
    await kitStep(step, 'step-id-123', async () => ok(42));
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toBe('step-id-123');
  });

  it('throws NonRetriableError on Result.err with a non-retryable code', async () => {
    const { step } = makeStep(err(nonRetryableError));
    await expect(kitStep(step, 'auth-step', async () => err(nonRetryableError))).rejects.toThrow(
      NonRetriableError,
    );
  });

  it('NonRetriableError message includes code and message', async () => {
    const { step } = makeStep(err(nonRetryableError));
    await expect(kitStep(step, 'auth-step', async () => err(nonRetryableError))).rejects.toThrow(
      'kit:source_auth_failed: credentials rejected',
    );
  });

  it('throws plain Error (not NonRetriableError) on Result.err with a retryable code', async () => {
    const { step } = makeStep(err(retryableError));
    await expect(kitStep(step, 'unavail-step', async () => err(retryableError))).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !(e instanceof NonRetriableError),
    );
  });

  it('retryable Error message includes code and message', async () => {
    const { step } = makeStep(err(retryableError));
    await expect(kitStep(step, 'unavail-step', async () => err(retryableError))).rejects.toThrow(
      'kit:source_unavailable: upstream offline',
    );
  });

  it('throws plain Error (not NonRetriableError) on Result.err with unknown retryability', async () => {
    const { step } = makeStep(err(unknownError));
    await expect(kitStep(step, 'process-step', async () => err(unknownError))).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && !(e instanceof NonRetriableError),
    );
  });

  it('passes through the fn result to step.run', async () => {
    const fn = vi.fn(async () => ok({ x: 1 }));
    const { step } = makeStep(ok({ x: 1 }));
    await kitStep(step, 'obj-step', fn);
    expect(fn).toHaveBeenCalledOnce();
  });
});
