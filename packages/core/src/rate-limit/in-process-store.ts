import type { RateLimitResult, RateLimitStore } from '../trigger.js';

const MAX_KEYS = 1024;

/**
 * Parse a window string like '10s', '1m', '24h' into milliseconds.
 * Throws synchronously for invalid formats — this is a programmer error,
 * not a runtime condition.
 */
export function parseWindowMs(window: string): number {
  const match = /^([1-9]\d*)(s|m|h)$/.exec(window);
  if (!match) {
    throw new Error(
      `[@idriszade/core] invalid window format: "${window}". ` +
        `Expected e.g. '10s', '1m', '24h' (positive integer + s/m/h suffix).`,
    );
  }
  const value = parseInt(match[1] ?? '', 10);
  const unit = match[2] ?? '';
  if (unit === 's') return value * 1_000;
  if (unit === 'm') return value * 60_000;
  // unit === 'h'
  return value * 3_600_000;
}

/**
 * In-process sliding-window log rate limiter.
 *
 * @remarks
 * Single-process only. Timestamps are stored in-memory; the store resets on
 * process restart. For distributed rate limiting across multiple workers or
 * replicas, use `@idriszade/rate-limit-redis` (deferred to M7).
 *
 * LRU eviction caps the key space at 1024 entries using Map insertion-order.
 */
export class InProcessRateLimitStore implements RateLimitStore {
  private readonly log = new Map<string, number[]>();

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Retrieve or initialise the timestamp log for this key.
    let timestamps = this.log.get(key);
    if (timestamps === undefined) {
      // Evict oldest key if at capacity (insertion-order LRU via Map).
      if (this.log.size >= MAX_KEYS) {
        const oldest = this.log.keys().next().value;
        if (oldest !== undefined) {
          this.log.delete(oldest);
        }
      }
      timestamps = [];
      this.log.set(key, timestamps);
    } else {
      // Prune expired timestamps in place (mutate the array reference stored in the Map).
      let i = 0;
      while (i < timestamps.length && (timestamps[i] ?? Infinity) <= windowStart) {
        i++;
      }
      if (i > 0) {
        timestamps.splice(0, i);
      }
      // Re-insert to update insertion-order position (promotes to MRU).
      this.log.delete(key);
      this.log.set(key, timestamps);
    }

    const count = timestamps.length;

    if (count >= limit) {
      // Window is full; find how long until the oldest entry expires.
      const oldest = timestamps[0] ?? now;
      const retryAfterMs = Math.min(oldest + windowMs - now, windowMs);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
    }

    // Allowed — record this timestamp.
    timestamps.push(now);
    const remaining = limit - timestamps.length;

    return { allowed: true, remaining, retryAfterMs: 0 };
  }
}

/**
 * Parse a window string and delegate to an `InProcessRateLimitStore`.
 * Convenience wrapper used by enforcement adapters that receive the `rateLimit`
 * RunGuard declaration.
 */
export function parseWindowAndConsume(
  store: RateLimitStore,
  key: string,
  limit: number,
  window: string,
): Promise<RateLimitResult> {
  const windowMs = parseWindowMs(window);
  return store.consume(key, limit, windowMs);
}
