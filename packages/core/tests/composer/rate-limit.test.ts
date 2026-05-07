import { describe, expect, it } from 'vitest';
import { createTokenBucket, DEFAULT_TOKEN_BUCKET } from '../../src/composer/rate-limit.js';

describe('DEFAULT_TOKEN_BUCKET', () => {
  it('matches ADR10 default 10/10/1000', () => {
    expect(DEFAULT_TOKEN_BUCKET).toEqual({
      capacity: 10,
      refillRate: 10,
      intervalMs: 1000,
    });
  });
});

describe('createTokenBucket', () => {
  it('initializes at full capacity', () => {
    const b = createTokenBucket({ capacity: 5, refillRate: 5, intervalMs: 1000 });
    expect(b.available()).toBeGreaterThanOrEqual(5);
  });

  it('tryAcquire decrements tokens and succeeds while under capacity', () => {
    const b = createTokenBucket({ capacity: 3, refillRate: 1, intervalMs: 10_000 });
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
  });

  it('tryAcquire returns false when bucket is empty', () => {
    const b = createTokenBucket({ capacity: 1, refillRate: 1, intervalMs: 10_000 });
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
  });

  it('refills tokens over time per refillRate/intervalMs', async () => {
    const b = createTokenBucket({ capacity: 2, refillRate: 2, intervalMs: 50 });
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(b.tryAcquire()).toBe(true);
  });

  it('acquire waits for tokens to refill', async () => {
    const b = createTokenBucket({ capacity: 1, refillRate: 1, intervalMs: 30 });
    expect(b.tryAcquire()).toBe(true);
    const start = Date.now();
    const acquired = await b.acquire(1);
    const elapsed = Date.now() - start;
    expect(acquired).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('acquire returns false when AbortSignal aborts mid-wait', async () => {
    const b = createTokenBucket({ capacity: 1, refillRate: 1, intervalMs: 5000 });
    expect(b.tryAcquire()).toBe(true);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const acquired = await b.acquire(1, ac.signal);
    expect(acquired).toBe(false);
  });

  it('caps tokens at capacity even after long idle', async () => {
    const b = createTokenBucket({ capacity: 2, refillRate: 100, intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 50));
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
  });
});
