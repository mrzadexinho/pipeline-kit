import type { BaseError } from './base.js';

export type ServeError =
  | (BaseError & { type: 'rate_limited'; retry_after_ms?: number })
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'network' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'unavailable' })
  | (BaseError & { type: 'auth' })
  | (BaseError & { type: 'validation' })
  | (BaseError & { type: 'idempotency_conflict' })
  | (BaseError & { type: 'unsupported' })
  | (BaseError & { type: 'unknown' });
