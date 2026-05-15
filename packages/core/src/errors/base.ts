export const RETRYABLE_ERROR_TYPES = [
  'rate_limited',
  'transient',
  'network',
  'timeout',
  'unavailable',
] as const;

export const NON_RETRYABLE_ERROR_TYPES = [
  'auth',
  'permanent',
  'validation',
  'idempotency_conflict',
] as const;

export type RetryableErrorType = (typeof RETRYABLE_ERROR_TYPES)[number];
export type NonRetryableErrorType = (typeof NON_RETRYABLE_ERROR_TYPES)[number];

export interface BaseError {
  code: string;
  message: string;
  param?: string;
  doc_url?: string;
  request_id?: string;
  metadata?: Record<string, unknown>;
  retryable?: boolean;
}
