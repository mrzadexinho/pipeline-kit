/**
 * Atomic sliding-window rate-limit Lua script for Redis.
 *
 * Arguments (KEYS / ARGV):
 *   KEYS[1]  — ZSET key (prefixed rate-limit key)
 *   ARGV[1]  — now (Unix timestamp in milliseconds, string)
 *   ARGV[2]  — window (windowMs as string)
 *   ARGV[3]  — limit (max requests per window, string)
 *   ARGV[4]  — member (unique `${now}-${uuid}` to avoid ZADD collisions)
 *
 * Returns an array of three integers:
 *   [0]  1 = allowed, 0 = denied
 *   [1]  remaining capacity (0 when denied)
 *   [2]  retryAfterMs (0 when allowed)
 *
 * @remarks
 * Modelled on Upstash ratelimit-js sliding-window pattern.
 * PEXPIRE sets key TTL = windowMs to prevent unbounded ZSET growth on cold keys.
 */
export const SLIDING_WINDOW_SCRIPT: string = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfterMs = math.ceil((tonumber(oldest[2]) + window) - now)
return {0, 0, retryAfterMs}
`;
