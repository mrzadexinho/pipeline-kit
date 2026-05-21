import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InProcessRateLimitStore, parseWindowMs } from '../../src/rate-limit/in-process-store.js';
import type { RunGuard } from '../../src/trigger.js';

// ─── parseWindowMs unit tests ────────────────────────────────────────────────

describe('parseWindowMs', () => {
  it("'10s' parses to 10_000ms", () => {
    expect(parseWindowMs('10s')).toBe(10_000);
  });

  it("'1m' parses to 60_000ms", () => {
    expect(parseWindowMs('1m')).toBe(60_000);
  });

  it("'24h' parses to 86_400_000ms", () => {
    expect(parseWindowMs('24h')).toBe(86_400_000);
  });

  it("'1s' parses to 1_000ms", () => {
    expect(parseWindowMs('1s')).toBe(1_000);
  });

  it("'60m' parses to 3_600_000ms", () => {
    expect(parseWindowMs('60m')).toBe(3_600_000);
  });

  it.each([
    '5d',
    '',
    '10',
    'sm',
    '-1s',
    'foo',
    '0s',
    '1h30m',
    ' 10s',
  ])("'%s' throws synchronously", (invalid) => {
    expect(() => parseWindowMs(invalid)).toThrow('@idriszade/core');
  });
});

// ─── InProcessRateLimitStore unit tests ─────────────────────────────────────

describe('InProcessRateLimitStore', () => {
  it('first request in a window is allowed with remaining = limit - 1', async () => {
    const store = new InProcessRateLimitStore();
    const result = await store.consume('key1', 5, 10_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterMs).toBe(0);
  });

  it('allows up to limit requests, then blocks', async () => {
    const store = new InProcessRateLimitStore();
    const limit = 3;
    const windowMs = 60_000;

    for (let i = 0; i < limit; i++) {
      const result = await store.consume('key2', limit, windowMs);
      expect(result.allowed).toBe(true);
    }

    const blocked = await store.consume('key2', limit, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('retryAfterMs is 0 when allowed', async () => {
    const store = new InProcessRateLimitStore();
    const result = await store.consume('key3', 10, 10_000);
    expect(result.retryAfterMs).toBe(0);
  });

  it('retryAfterMs <= windowMs always (algorithm guarantee)', async () => {
    const store = new InProcessRateLimitStore();
    const windowMs = 5_000;
    // Fill the window.
    await store.consume('key4', 1, windowMs);
    const blocked = await store.consume('key4', 1, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  it('distinct keys are independent', async () => {
    const store = new InProcessRateLimitStore();
    const a = await store.consume('a', 1, 10_000);
    const b = await store.consume('b', 1, 10_000);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it('LRU: handles 1025 distinct keys without error (oldest key evicted)', async () => {
    const store = new InProcessRateLimitStore();
    for (let i = 0; i < 1025; i++) {
      await expect(store.consume(`key-${i}`, 10, 60_000)).resolves.toBeDefined();
    }
  });

  it('remaining decrements correctly across multiple allowed requests', async () => {
    const store = new InProcessRateLimitStore();
    const limit = 5;
    for (let i = 0; i < limit; i++) {
      const result = await store.consume('decrement-key', limit, 60_000);
      expect(result.remaining).toBe(limit - 1 - i);
    }
  });
});

// ─── RunGuard type smoke test ────────────────────────────────────────────────

describe('RunGuard rateLimit field', () => {
  it('compiles with rateLimit field present', () => {
    const guard: RunGuard = {
      rateLimit: {
        kind: 'rateLimit',
        key: (ctx) => `pipeline:${ctx.runId}`,
        limit: 100,
        window: '1m',
        discardExcess: true,
      },
    };
    expect(guard.rateLimit?.kind).toBe('rateLimit');
    expect(guard.rateLimit?.limit).toBe(100);
  });

  it('compiles without rateLimit field (backwards compatible)', () => {
    const guard: RunGuard = {};
    expect(guard.rateLimit).toBeUndefined();
  });

  it('composes with concurrency + dedup (orthogonal concerns)', () => {
    const store = new InProcessRateLimitStore();
    const guard: RunGuard = {
      concurrency: { limit: 5, overflow: 'queue' },
      dedup: { period: '24h' },
      rateLimit: {
        kind: 'rateLimit',
        key: (ctx) => `user:${String(ctx.metadata?.userId ?? 'anon')}`,
        limit: 10,
        window: '10s',
        discardExcess: false,
        store,
      },
    };
    expect(guard.concurrency?.limit).toBe(5);
    expect(guard.dedup?.period).toBe('24h');
    expect(guard.rateLimit?.window).toBe('10s');
  });

  it('discardExcess flag is preserved', () => {
    const discard: RunGuard = {
      rateLimit: {
        kind: 'rateLimit',
        key: (ctx) => ctx.runId,
        limit: 5,
        window: '1m',
        discardExcess: true,
      },
    };
    const throttle: RunGuard = {
      rateLimit: {
        kind: 'rateLimit',
        key: (ctx) => ctx.runId,
        limit: 5,
        window: '1m',
        discardExcess: false,
      },
    };
    expect(discard.rateLimit?.discardExcess).toBe(true);
    expect(throttle.rateLimit?.discardExcess).toBe(false);
  });
});

// ─── Property test ───────────────────────────────────────────────────────────

describe('InProcessRateLimitStore property tests', () => {
  it('count(allowed results) <= limit for N concurrent consumes in the same window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }), // limit
        fc.integer({ min: 1, max: 50 }), // N requests
        async (limit, n) => {
          const store = new InProcessRateLimitStore();
          const results = await Promise.all(
            Array.from({ length: n }, () => store.consume('prop-key', limit, 60_000)),
          );
          const allowedCount = results.filter((r) => r.allowed).length;
          return allowedCount <= limit;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('retryAfterMs <= windowMs for all blocked results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // limit
        fc.integer({ min: 1, max: 3 }), // unit in seconds
        async (limit, unitSec) => {
          const windowMs = unitSec * 1_000;
          const store = new InProcessRateLimitStore();
          // Exhaust the window.
          for (let i = 0; i < limit; i++) {
            await store.consume('retryAfter-prop', limit, windowMs);
          }
          const blocked = await store.consume('retryAfter-prop', limit, windowMs);
          if (!blocked.allowed) {
            return blocked.retryAfterMs <= windowMs;
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
