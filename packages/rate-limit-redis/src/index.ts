/**
 * @idriszade/rate-limit-redis
 *
 * Distributed sliding-window `RateLimitStore` adapter backed by Redis.
 * Implements ADR X-5 (distributed-tier completion) via atomic Lua EVAL.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * import { createRedisRateLimitStore } from '@idriszade/rate-limit-redis';
 *
 * const client = createClient({ url: process.env.REDIS_URL });
 * await client.connect();
 *
 * const store = createRedisRateLimitStore({ client });
 * const result = await store.consume('user:42', 10, 60_000);
 * ```
 */

export { SLIDING_WINDOW_SCRIPT } from './lua.js';
export { createRedisRateLimitStore, RedisRateLimitStore } from './store.js';
export type { RedisRateLimitStoreOptions } from './types.js';
