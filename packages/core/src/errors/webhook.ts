import type { BaseError } from './base.js';

export type WebhookError =
  | (BaseError & { type: 'invalid_signature' })
  | (BaseError & { type: 'expired_timestamp' })
  | (BaseError & { type: 'malformed_header' })
  | (BaseError & { type: 'missing_secret' })
  | (BaseError & { type: 'invalid_payload' })
  | (BaseError & { type: 'unknown' });
