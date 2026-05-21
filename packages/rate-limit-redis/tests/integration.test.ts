/**
 * Integration tests for RedisRateLimitStore — real Redis via @testcontainers/redis.
 *
 * These tests exercise the actual Lua sliding-window script against a real Redis instance.
 * Mocked tests cannot verify Lua atomicity; this is the only fidelity path (per RF-4).
 *
 * Gate: `describe.skipIf(process.env.SKIP_TESTCONTAINERS)` per RF-1.
 *
 * Acceptance criteria covered:
 *   AC-1: 5 allows + 6th denied in same window
 *   AC-2: 6th consume returns allowed:false, remaining:0, retryAfterMs > 0
 *   AC-3: After real windowMs elapses, next consume returns allowed:true
 *   AC-4: Property test — count(allowed) <= limit for N concurrent consumers
 *   AC-5: scriptExists([cachedSha]) returns [true] after first consume
 *   AC-6: scriptFlush between consumes; second call still succeeds
 *   AC-7: After windowMs, ZCARD key === 0 (PEXPIRE honoured)
 */

import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';
import * as fc from 'fast-check';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisRateLimitStore, RedisRateLimitStore } from '../src/store.js';

const SKIP = !!process.env.SKIP_TESTCONTAINERS;

describe.skipIf(SKIP)('RedisRateLimitStore [integration] [skip-ci]', () => {
  let container: StartedRedisContainer | undefined;
  let client: ReturnType<typeof createClient>;
  let store: RedisRateLimitStore;
  let dockerAvailable = true;

  beforeAll(async () => {
    try {
      container = await new RedisContainer().start();
      client = createClient({ url: container.getConnectionUrl() });
      await client.connect();
      store = createRedisRateLimitStore({ client });
    } catch (e) {
      dockerAvailable = false;
      console.warn('[integration] Docker unreachable, skipping Redis integration tests:', e);
    }
  }, 60_000);

  afterAll(async () => {
    if (client?.isOpen) {
      await client.quit();
    }
    if (container) {
      await container.stop();
    }
  }, 30_000);

  // Helper to skip individual tests if Docker unavailable
  function skipIfNoDocker() {
    if (!dockerAvailable) {
      return true;
    }
    return false;
  }

  // --- AC-1 + AC-2: 5 allows, 6th denied ---

  it('AC-1+2: consume(key, 5, 10s) x5 returns allowed:true with decrementing remaining; 6th denied', async () => {
    if (skipIfNoDocker()) return;

    const key = `test:ac1:${Date.now()}`;
    const limit = 5;
    const windowMs = 10_000;

    const results = [];
    for (let i = 0; i < limit; i++) {
      results.push(await store.consume(key, limit, windowMs));
    }

    // All 5 allowed; remaining decrements 4→3→2→1→0
    for (let i = 0; i < limit; i++) {
      expect(results[i]?.allowed).toBe(true);
      expect(results[i]?.remaining).toBe(limit - 1 - i);
      expect(results[i]?.retryAfterMs).toBe(0);
    }

    // 6th is denied
    const denied = await store.consume(key, limit, windowMs);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  // --- AC-3: window expiry allows again ---

  it('AC-3: after real windowMs elapses, next consume returns allowed:true', async () => {
    if (skipIfNoDocker()) return;

    const windowMs = 500; // short window for test speed
    const key = `test:ac3:${Date.now()}`;

    // Fill the window
    const firstResult = await store.consume(key, 1, windowMs);
    expect(firstResult.allowed).toBe(true);

    // One over limit
    const denied = await store.consume(key, 1, windowMs);
    expect(denied.allowed).toBe(false);

    // Wait for window to expire
    await new Promise<void>((resolve) => {
      setTimeout(resolve, windowMs + 50);
    });

    // Should be allowed again
    const after = await store.consume(key, 1, windowMs);
    expect(after.allowed).toBe(true);
  }, 5_000);

  // --- AC-4: property test — count(allowed) <= limit ---

  it('AC-4: property — concurrent consumers; count(allowed) <= limit', async () => {
    if (skipIfNoDocker()) return;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }), // limit
        fc.integer({ min: 2, max: 15 }), // N concurrent consumers
        async (limit, n) => {
          const key = `test:prop:${Date.now()}-${Math.random()}`;
          const windowMs = 5_000;

          const promises = Array.from({ length: n }, () => store.consume(key, limit, windowMs));
          const results = await Promise.all(promises);

          const allowedCount = results.filter((r) => r.allowed).length;
          expect(allowedCount).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);

  // --- AC-5: SHA caching ---

  it('AC-5: scriptExists([cachedSha]) returns [true] after first consume', async () => {
    if (skipIfNoDocker()) return;

    const key = `test:ac5:${Date.now()}`;
    // Use a fresh store to ensure SHA is loaded on this consume
    const freshStore = new RedisRateLimitStore({ client });

    await freshStore.consume(key, 5, 10_000);

    // Access private field for verification (acceptable in tests)
    const sha: string | null = (freshStore as unknown as { scriptSha: string | null }).scriptSha;
    expect(sha).not.toBeNull();
    expect(typeof sha).toBe('string');
    expect(sha?.length).toBeGreaterThan(0);

    // sha is asserted non-null above; use empty-string fallback to satisfy strict types
    const exists = await client.scriptExists([sha ?? '']);
    expect(exists).toEqual([true]);
  });

  // --- AC-6: NOSCRIPT fallback ---

  it('AC-6: scriptFlush between two consumes; second call succeeds', async () => {
    if (skipIfNoDocker()) return;

    const freshStore = new RedisRateLimitStore({ client });
    const key = `test:ac6:${Date.now()}`;

    const first = await freshStore.consume(key, 5, 10_000);
    expect(first.allowed).toBe(true);

    // Flush all scripts — simulates server restart / SCRIPT FLUSH
    await client.scriptFlush();

    // Second consume should succeed via NOSCRIPT fallback
    const second = await freshStore.consume(key, 5, 10_000);
    expect(second.allowed).toBe(true);

    // SHA should be refreshed
    const sha: string | null = (freshStore as unknown as { scriptSha: string | null }).scriptSha;
    if (sha !== null) {
      const exists = await client.scriptExists([sha]);
      expect(exists).toEqual([true]);
    }
  });

  // --- AC-7: PEXPIRE honoured — ZSET cleaned up after windowMs ---

  it('AC-7: after windowMs elapses, ZCARD key === 0 (PEXPIRE honoured)', async () => {
    if (skipIfNoDocker()) return;

    const windowMs = 300;
    const key = `test:ac7:${Date.now()}`;
    const redisKey = `pk:ratelimit:${key}`;

    await store.consume(key, 5, windowMs);

    // ZSET should be non-empty immediately
    const before = await client.zCard(redisKey);
    expect(before).toBeGreaterThan(0);

    // Wait for PEXPIRE to fire
    await new Promise<void>((resolve) => {
      setTimeout(resolve, windowMs + 100);
    });

    // ZSET should be gone (key expired)
    const after = await client.zCard(redisKey);
    expect(after).toBe(0);
  }, 5_000);
});
