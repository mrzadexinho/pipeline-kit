import crypto from 'node:crypto';
import type { RateLimitResult, RateLimitStore } from '@idriszade/core';
import { SLIDING_WINDOW_SCRIPT } from './lua.js';
import type { RedisRateLimitStoreOptions } from './types.js';

const DEFAULT_KEY_PREFIX = 'pk:ratelimit:';

/**
 * Distributed sliding-window {@link RateLimitStore} backed by Redis.
 *
 * Implements ADR X-5 (distributed-tier completion). The in-process counterpart
 * is `InProcessRateLimitStore` from `@idriszade/core` (single-process, no Redis
 * dependency).
 *
 * ### SHA caching
 * On first `consume()` call the Lua script is loaded via `client.scriptLoad()`.
 * The returned SHA is cached on the instance. Subsequent calls use
 * `client.evalSha()`. If Redis returns a `NOSCRIPT` error (e.g. after a server
 * restart or SCRIPT FLUSH), the adapter falls back to `client.eval()` and
 * refreshes the cached SHA automatically.
 *
 * ### Connection ownership
 * The caller is responsible for connecting and disconnecting the `redis` client.
 * The store never calls `client.connect()` or `client.quit()`.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * import { createRedisRateLimitStore } from '@idriszade/rate-limit-redis';
 *
 * const client = createClient();
 * await client.connect();
 *
 * const store = createRedisRateLimitStore({ client });
 * const result = await store.consume('user:42', 10, 60_000);
 * console.log(result); // { allowed: true, remaining: 9, retryAfterMs: 0 }
 * ```
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisRateLimitStoreOptions['client'];
  private readonly keyPrefix: string;
  private scriptSha: string | null = null;

  constructor(opts: RedisRateLimitStoreOptions) {
    this.client = opts.client;
    this.keyPrefix = opts.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  /**
   * Consume one request unit for `key` against a sliding-window of `windowMs`.
   *
   * Implements ADR X-5 distributed-tier via atomic Lua EVAL. See also
   * `InProcessRateLimitStore` in `@idriszade/core` for the single-process variant.
   *
   * @param key      Rate-limit key (e.g. `'user:42'` or `'ip:1.2.3.4'`).
   * @param limit    Maximum allowed requests within `windowMs`.
   * @param windowMs Sliding-window duration in milliseconds.
   */
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `${this.keyPrefix}${key}`;
    const now = Date.now();
    const member = `${now}-${crypto.randomUUID()}`;

    const evalOpts = {
      keys: [redisKey],
      arguments: [String(now), String(windowMs), String(limit), member],
    };

    // Load script SHA on first call.
    if (this.scriptSha === null) {
      this.scriptSha = await this.client.scriptLoad(SLIDING_WINDOW_SCRIPT);
    }

    let rawResult: unknown;

    try {
      rawResult = await this.client.evalSha(this.scriptSha, evalOpts);
    } catch (err: unknown) {
      // NOSCRIPT: script not in Redis cache (e.g. after server restart / SCRIPT FLUSH).
      // Fall back to raw eval and refresh cached SHA.
      if (isNoscriptError(err)) {
        rawResult = await this.client.eval(SLIDING_WINDOW_SCRIPT, evalOpts);
        // Refresh SHA so subsequent calls use evalSha again.
        this.scriptSha = await this.client.scriptLoad(SLIDING_WINDOW_SCRIPT);
      } else {
        throw err;
      }
    }

    return parseResult(rawResult);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNoscriptError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('NOSCRIPT');
  }
  return false;
}

function parseResult(raw: unknown): RateLimitResult {
  // Lua returns an array of three integers.
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error('[@idriszade/rate-limit-redis] Unexpected Lua response shape');
  }
  const [allowed, remaining, retryAfterMs] = raw as [number, number, number];
  return {
    allowed: allowed === 1,
    remaining: remaining ?? 0,
    retryAfterMs: retryAfterMs ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a {@link RedisRateLimitStore} from `opts`.
 *
 * Convenience factory — equivalent to `new RedisRateLimitStore(opts)`.
 */
export function createRedisRateLimitStore(opts: RedisRateLimitStoreOptions): RedisRateLimitStore {
  return new RedisRateLimitStore(opts);
}
