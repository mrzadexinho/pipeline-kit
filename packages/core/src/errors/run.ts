import type { BaseError } from './base.js';
import type { ProcessError } from './process.js';
import type { ReviewError } from './review.js';
import type { ServeError } from './serve.js';
import type { SourceError } from './source.js';
import type { StoreError } from './store.js';

export type RunError =
  | (BaseError & { type: 'cancelled' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'validation' })
  | (BaseError & { type: 'not_implemented' })
  | (BaseError & { type: 'source_failed'; cause: SourceError })
  | (BaseError & { type: 'process_failed'; cause: ProcessError })
  | (BaseError & { type: 'serve_failed'; cause: ServeError })
  | (BaseError & { type: 'store_failed'; cause: StoreError })
  | (BaseError & { type: 'review_failed'; cause: ReviewError })
  | (BaseError & { type: 'unknown' });
