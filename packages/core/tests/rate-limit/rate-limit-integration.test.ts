/**
 * Rate-limit integration tests — fake-timer window roll-over
 *
 * CRITICAL constraints (M5 GHA flake lesson):
 * - vi.useFakeTimers({ now: Date.now() }) pins system time at start of each test.
 * - Every vi.advanceTimersByTime() call uses N <= 2_000ms.
 * - '6s' window roll-over uses 3 × 2_000ms advances (NOT a single 6_000ms advance).
 * - vi.runAllTimers() is NEVER used.
 * - vi.useRealTimers() is restored in afterEach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InProcessRateLimitStore,
  parseWindowAndConsume,
} from '../../src/rate-limit/in-process-store.js';

describe('InProcessRateLimitStore — fake-timer window roll-over', () => {
  let store: InProcessRateLimitStore;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.now() });
    store = new InProcessRateLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request, blocks at limit, allows again after window expires', async () => {
    const key = 'rollover-test';
    const limit = 2;
    const windowMs = 6_000; // '6s' window

    // Fill window (2 requests).
    const r1 = await store.consume(key, limit, windowMs);
    const r2 = await store.consume(key, limit, windowMs);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // Third request in same window — should be blocked.
    const blocked = await store.consume(key, limit, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);

    // Advance time in 3 × 2_000ms steps to move past the 6s window.
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(2_000);

    // Window has now expired — next request should be allowed.
    const afterRollover = await store.consume(key, limit, windowMs);
    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBe(limit - 1);
    expect(afterRollover.retryAfterMs).toBe(0);
  });

  it('window expires partially: only timestamps older than windowMs are pruned', async () => {
    const key = 'partial-expire';
    const limit = 3;
    const windowMs = 6_000;

    // Request 1 at t=0.
    const r1 = await store.consume(key, limit, windowMs);
    expect(r1.allowed).toBe(true);

    // Advance 2s — t=2000.
    vi.advanceTimersByTime(2_000);

    // Request 2 at t=2000.
    const r2 = await store.consume(key, limit, windowMs);
    expect(r2.allowed).toBe(true);

    // Advance 2s — t=4000.
    vi.advanceTimersByTime(2_000);

    // Request 3 at t=4000.
    const r3 = await store.consume(key, limit, windowMs);
    expect(r3.allowed).toBe(true);

    // Window now full (3/3). Next request should be blocked.
    const blocked = await store.consume(key, limit, windowMs);
    expect(blocked.allowed).toBe(false);

    // Advance 2s — t=6000. Request 1 (at t=0) is now exactly at boundary (windowStart = t-6000 = 0).
    // windowStart <= 0 means t=0 timestamp is at or beyond boundary → pruned.
    vi.advanceTimersByTime(2_000);

    // After pruning t=0, only t=2000 and t=4000 remain (2 in window). One slot free.
    const afterPartial = await store.consume(key, limit, windowMs);
    expect(afterPartial.allowed).toBe(true);
  });

  it('retryAfterMs > 0 and <= windowMs when blocked (fake-timer stable)', async () => {
    const key = 'retry-after-check';
    const windowMs = 4_000; // 2 × 2_000ms

    // Fill window with 1 request.
    await store.consume(key, 1, windowMs);

    // Now blocked.
    const blocked = await store.consume(key, 1, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);

    // Advance 2s.
    vi.advanceTimersByTime(2_000);
    // Still within window (only 2s elapsed of 4s window).
    const stillBlocked = await store.consume(key, 1, windowMs);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.retryAfterMs).toBeGreaterThan(0);
    expect(stillBlocked.retryAfterMs).toBeLessThanOrEqual(windowMs);

    // Advance another 2s — t=4000 total, window has expired.
    vi.advanceTimersByTime(2_000);
    const allowed = await store.consume(key, 1, windowMs);
    expect(allowed.allowed).toBe(true);
    expect(allowed.retryAfterMs).toBe(0);
  });

  it('parseWindowAndConsume: "6s" window string triggers correct windowMs', async () => {
    const key = 'parse-window-6s';
    const limit = 1;

    const r1 = await parseWindowAndConsume(store, key, limit, '6s');
    expect(r1.allowed).toBe(true);

    const blocked = await parseWindowAndConsume(store, key, limit, '6s');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(6_000);

    // Advance past 6s window in 3 × 2_000ms steps.
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(2_000);
    vi.advanceTimersByTime(2_000);

    const afterRollover = await parseWindowAndConsume(store, key, limit, '6s');
    expect(afterRollover.allowed).toBe(true);
  });
});
