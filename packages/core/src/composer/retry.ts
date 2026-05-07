import pRetry, { AbortError } from 'p-retry';
import { NON_RETRYABLE_ERROR_TYPES, RETRYABLE_ERROR_TYPES } from '../errors/base.js';
import type { RetryPolicy } from '../policy.js';
import type { Result } from '../result.js';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 30_000,
  jitter: 'full',
  respectRetryAfter: true,
  retryableErrorTypes: [...RETRYABLE_ERROR_TYPES],
  nonRetryableErrorTypes: [...NON_RETRYABLE_ERROR_TYPES],
};

export function mergeRetryPolicy(base: RetryPolicy, overrides?: Partial<RetryPolicy>): RetryPolicy {
  if (!overrides) return base;
  return { ...base, ...overrides };
}

export type RetryClassification = 'retry' | 'abort';

export function classifyError(errType: string, policy: RetryPolicy): RetryClassification {
  if (policy.nonRetryableErrorTypes.includes(errType)) return 'abort';
  if (policy.retryableErrorTypes.includes(errType)) return 'retry';
  return 'abort';
}

export interface RetryBudget {
  attempt(): boolean;
  remaining(): number;
}

export function createRetryBudget(maxRetries: number): RetryBudget {
  let used = 0;
  return {
    attempt(): boolean {
      if (used >= maxRetries) return false;
      used++;
      return true;
    },
    remaining(): number {
      return Math.max(0, maxRetries - used);
    },
  };
}

export interface WithRetryOpts {
  policy: RetryPolicy;
  signal?: AbortSignal;
  globalBudget?: RetryBudget;
  onRetry?: (errType: string, attempt: number) => void;
}

class RetryableStageError extends Error {
  constructor(public readonly errType: string) {
    super(errType);
    this.name = 'RetryableStageError';
  }
}

export async function withRetry<
  T,
  E extends { type: string; retry_after_ms?: number; message: string },
>(fn: (attempt: number) => Promise<Result<T, E>>, opts: WithRetryOpts): Promise<Result<T, E>> {
  const { policy, signal, globalBudget, onRetry } = opts;
  let last: Result<T, E> | null = null;

  const wrapped = async (attempt: number): Promise<T> => {
    if (signal?.aborted) {
      throw new AbortError('cancelled');
    }
    const r: Result<T, E> = await fn(attempt);
    last = r;
    const stageError = r.error;
    if (stageError === null) {
      return r.data as T;
    }
    const errType = stageError.type;
    if (classifyError(errType, policy) === 'abort') {
      throw new AbortError(errType);
    }
    if (globalBudget && !globalBudget.attempt()) {
      throw new AbortError('budget_exhausted');
    }
    onRetry?.(errType, attempt);
    if (policy.respectRetryAfter && stageError.retry_after_ms !== undefined) {
      await sleep(stageError.retry_after_ms);
    }
    throw new RetryableStageError(errType);
  };

  try {
    const data = await pRetry(wrapped, {
      retries: Math.max(0, policy.maxAttempts - 1),
      factor: 2,
      minTimeout: policy.baseDelayMs,
      maxTimeout: policy.maxDelayMs,
      randomize: policy.jitter !== 'none',
    });
    return { data, error: null };
  } catch {
    if (last !== null) {
      return last;
    }
    const synthetic = {
      type: 'cancelled',
      code: 'cancelled',
      message: 'aborted before first attempt',
    };
    return { data: null, error: synthetic as unknown as E };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
