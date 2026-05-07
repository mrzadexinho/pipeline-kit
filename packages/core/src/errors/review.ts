import type { BaseError } from './base.js';

export type ReviewError =
  | (BaseError & { type: 'transport' })
  | (BaseError & { type: 'auth' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'cancelled' })
  | (BaseError & { type: 'unsupported' })
  | (BaseError & { type: 'unknown' });
