import type { BaseError } from './base.js';

export type StoreError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'network' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'auth' })
  | (BaseError & { type: 'validation' })
  | (BaseError & { type: 'idempotency_conflict' })
  | (BaseError & { type: 'conflict' })
  | (BaseError & { type: 'not_found' })
  | (BaseError & { type: 'unknown' });
