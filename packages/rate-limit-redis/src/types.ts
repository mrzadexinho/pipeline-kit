import type { RedisClientType } from 'redis';

/**
 * Options for {@link RedisRateLimitStore}.
 */
export interface RedisRateLimitStoreOptions {
  /** node-redis v5+ client. Must already be connected — the store does NOT manage connection lifecycle. */
  client: RedisClientType;
  /**
   * Key prefix applied to every Redis ZSET key.
   * @default 'pk:ratelimit:'
   */
  keyPrefix?: string;
}
