import type { BaseError } from './base.js';

export type ProcessError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'permanent' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'validation' })
  | (BaseError & { type: 'process'; reason?: string })
  | (BaseError & { type: 'unknown' });
