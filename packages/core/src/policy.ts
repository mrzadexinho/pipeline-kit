export type Jitter = 'none' | 'full' | 'equal';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: Jitter;
  respectRetryAfter: boolean;
  retryableErrorTypes: ReadonlyArray<string>;
  nonRetryableErrorTypes: ReadonlyArray<string>;
}

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  intervalMs: number;
}
