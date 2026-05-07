import { describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  createRetryBudget,
  DEFAULT_RETRY_POLICY,
  mergeRetryPolicy,
  withRetry,
} from '../../src/composer/retry.js';
import { NON_RETRYABLE_ERROR_TYPES, RETRYABLE_ERROR_TYPES } from '../../src/errors/base.js';
import type { RetryPolicy } from '../../src/policy.js';
import { err, ok, type Result } from '../../src/result.js';

const fastPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 5,
  jitter: 'none',
  respectRetryAfter: false,
  retryableErrorTypes: [...RETRYABLE_ERROR_TYPES],
  nonRetryableErrorTypes: [...NON_RETRYABLE_ERROR_TYPES],
};

type StageErr = { type: string; code: string; message: string; retry_after_ms?: number };

describe('DEFAULT_RETRY_POLICY', () => {
  it('matches AWS canonical defaults from ADR13', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(100);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(30_000);
    expect(DEFAULT_RETRY_POLICY.jitter).toBe('full');
    expect(DEFAULT_RETRY_POLICY.respectRetryAfter).toBe(true);
  });

  it('seeds retryable + non-retryable type tables from base error module', () => {
    expect(DEFAULT_RETRY_POLICY.retryableErrorTypes).toEqual([...RETRYABLE_ERROR_TYPES]);
    expect(DEFAULT_RETRY_POLICY.nonRetryableErrorTypes).toEqual([...NON_RETRYABLE_ERROR_TYPES]);
  });
});

describe('mergeRetryPolicy', () => {
  it('returns base unchanged when overrides are absent', () => {
    expect(mergeRetryPolicy(DEFAULT_RETRY_POLICY)).toEqual(DEFAULT_RETRY_POLICY);
  });

  it('shallow merges overrides into base', () => {
    const merged = mergeRetryPolicy(DEFAULT_RETRY_POLICY, { maxAttempts: 5, jitter: 'equal' });
    expect(merged.maxAttempts).toBe(5);
    expect(merged.jitter).toBe('equal');
    expect(merged.baseDelayMs).toBe(100);
  });
});

describe('classifyError', () => {
  it('marks retryable types as retry', () => {
    for (const t of RETRYABLE_ERROR_TYPES) {
      expect(classifyError(t, DEFAULT_RETRY_POLICY)).toBe('retry');
    }
  });

  it('marks non-retryable types as abort', () => {
    for (const t of NON_RETRYABLE_ERROR_TYPES) {
      expect(classifyError(t, DEFAULT_RETRY_POLICY)).toBe('abort');
    }
  });

  it('treats unclassified types as abort (safe default)', () => {
    expect(classifyError('mystery_type', DEFAULT_RETRY_POLICY)).toBe('abort');
  });
});

describe('createRetryBudget', () => {
  it('allows up to maxRetries attempts', () => {
    const b = createRetryBudget(2);
    expect(b.attempt()).toBe(true);
    expect(b.attempt()).toBe(true);
    expect(b.attempt()).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  it('remaining decrements per consumed attempt', () => {
    const b = createRetryBudget(3);
    expect(b.remaining()).toBe(3);
    b.attempt();
    expect(b.remaining()).toBe(2);
  });
});

describe('withRetry', () => {
  it('returns success on first attempt without retry', async () => {
    const fn = vi.fn(async () => ok('hello'));
    const r = await withRetry<string, StageErr>(fn, { policy: fastPolicy });
    expect(r.data).toBe('hello');
    expect(r.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error then succeeds', async () => {
    const fn = vi
      .fn<(_attempt: number) => Promise<Result<string, StageErr>>>()
      .mockResolvedValueOnce(err({ type: 'transient', code: 'flap', message: 'one' }))
      .mockResolvedValueOnce(ok('recovered'));
    const r = await withRetry<string, StageErr>(fn, { policy: fastPolicy });
    expect(r.data).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('aborts on non-retryable error without further attempts', async () => {
    const fn = vi
      .fn<(_attempt: number) => Promise<Result<string, StageErr>>>()
      .mockResolvedValueOnce(err({ type: 'auth', code: 'bad_token', message: 'denied' }));
    const r = await withRetry<string, StageErr>(fn, { policy: fastPolicy });
    expect(r.data).toBeNull();
    expect(r.error?.type).toBe('auth');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and returns last observed error', async () => {
    const fn = vi.fn(async () =>
      err<StageErr>({ type: 'transient', code: 'flap', message: 'forever' }),
    );
    const r = await withRetry<string, StageErr>(fn, { policy: fastPolicy });
    expect(r.error?.type).toBe('transient');
    expect(fn).toHaveBeenCalledTimes(fastPolicy.maxAttempts);
  });

  it('aborts when AbortSignal is set before invocation', async () => {
    const ac = new AbortController();
    ac.abort();
    const fn = vi.fn(async () => ok('never'));
    const r = await withRetry<string, StageErr>(fn, { policy: fastPolicy, signal: ac.signal });
    expect(r.error).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  it('global budget exhaustion halts further retries', async () => {
    const fn = vi.fn(async () =>
      err<StageErr>({ type: 'transient', code: 'flap', message: 'forever' }),
    );
    const budget = createRetryBudget(1);
    const r = await withRetry<string, StageErr>(fn, {
      policy: fastPolicy,
      globalBudget: budget,
    });
    expect(r.error?.type).toBe('transient');
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('respects retry_after_ms when respectRetryAfter is enabled', async () => {
    const policy: RetryPolicy = { ...fastPolicy, respectRetryAfter: true };
    const fn = vi
      .fn<(_attempt: number) => Promise<Result<string, StageErr>>>()
      .mockResolvedValueOnce(
        err({ type: 'rate_limited', code: 'rl', message: 'wait', retry_after_ms: 5 }),
      )
      .mockResolvedValueOnce(ok('done'));
    const start = Date.now();
    const r = await withRetry<string, StageErr>(fn, { policy });
    const elapsed = Date.now() - start;
    expect(r.data).toBe('done');
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it('invokes onRetry callback with errType and attempt', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn<(_attempt: number) => Promise<Result<string, StageErr>>>()
      .mockResolvedValueOnce(err({ type: 'transient', code: 't', message: '1' }))
      .mockResolvedValueOnce(ok('x'));
    await withRetry<string, StageErr>(fn, { policy: fastPolicy, onRetry });
    expect(onRetry).toHaveBeenCalledWith('transient', 1);
  });
});
