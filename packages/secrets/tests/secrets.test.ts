import { err, ok } from '@idriszade/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtlResolver, createVersionAwareResolver, scope } from '../src/index.js';
import type { SecretsResolver } from '../src/index.js';

function mockResolver(secrets: Record<string, string>): SecretsResolver & { callCount(name: string): number } {
  const callCounts = new Map<string, number>();
  return {
    async resolve(name) {
      callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
      const value = secrets[name];
      if (value === undefined) {
        return err({ type: 'secrets_error' as const, code: 'secret_not_found' as const, message: `Not found: ${name}` });
      }
      return ok(value);
    },
    invalidate(_name) { /* no-op for mock */ },
    stats(name) { return { reads: callCounts.get(name) ?? 0 }; },
    callCount(name) { return callCounts.get(name) ?? 0; },
  };
}

describe('createVersionAwareResolver', () => {
  it('cache hit: inner called only once on double resolve', async () => {
    const inner = mockResolver({ 'db-password': 'secret123' });
    const resolver = createVersionAwareResolver(inner);

    const r1 = await resolver.resolve('db-password');
    const r2 = await resolver.resolve('db-password');

    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r1.data).toBe('secret123');
    expect(r2.data).toBe('secret123');
    expect(inner.callCount('db-password')).toBe(1);
  });

  it('invalidate: next resolve hits inner again', async () => {
    const inner = mockResolver({ 'api-key': 'key-v1' });
    const resolver = createVersionAwareResolver(inner);

    await resolver.resolve('api-key');
    expect(inner.callCount('api-key')).toBe(1);

    resolver.invalidate('api-key');

    await resolver.resolve('api-key');
    expect(inner.callCount('api-key')).toBe(2);
  });

  it('stats: tracks reads and currentVersion', async () => {
    const inner = mockResolver({ token: 'tok-abc' });
    const resolver = createVersionAwareResolver(inner);

    // Before any resolve: no stats
    const before = resolver.stats('token');
    expect(before.reads).toBe(0);
    expect(before.currentVersion).toBeUndefined();

    await resolver.resolve('token');

    const after = resolver.stats('token');
    expect(after.reads).toBe(1);
    expect(after.currentVersion).toBeDefined();
  });

  it('stats: reads increments on cache hit too', async () => {
    const inner = mockResolver({ token: 'tok-abc' });
    const resolver = createVersionAwareResolver(inner);

    await resolver.resolve('token');
    await resolver.resolve('token');
    await resolver.resolve('token');

    expect(resolver.stats('token').reads).toBe(3);
    expect(inner.callCount('token')).toBe(1);
  });

  it('not-found propagates without caching', async () => {
    const inner = mockResolver({});
    const resolver = createVersionAwareResolver(inner);

    const result = await resolver.resolve('missing');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_not_found');

    // Second call should still hit inner (no caching on error)
    await resolver.resolve('missing');
    expect(inner.callCount('missing')).toBe(2);
  });
});

describe('createTtlResolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TTL expiry: inner called twice after TTL passes', async () => {
    const inner = mockResolver({ 'db-pass': 'pass1' });
    const ttlMs = 60_000;
    const resolver = createTtlResolver(inner, ttlMs);

    await resolver.resolve('db-pass');
    expect(inner.callCount('db-pass')).toBe(1);

    vi.advanceTimersByTime(ttlMs);

    await resolver.resolve('db-pass');
    expect(inner.callCount('db-pass')).toBe(2);
  });

  it('TTL within window: inner called once', async () => {
    const inner = mockResolver({ 'db-pass': 'pass1' });
    const ttlMs = 60_000;
    const resolver = createTtlResolver(createVersionAwareResolver(inner), ttlMs);

    await resolver.resolve('db-pass');
    vi.advanceTimersByTime(ttlMs - 1);
    await resolver.resolve('db-pass');

    expect(inner.callCount('db-pass')).toBe(1);
  });

  it('invalidate: clears TTL timestamp and forwards to inner', async () => {
    const inner = mockResolver({ token: 'tok' });
    const ttlMs = 60_000;
    const resolver = createTtlResolver(inner, ttlMs);

    await resolver.resolve('token');
    resolver.invalidate('token');

    // Re-resolve before TTL would normally expire
    vi.advanceTimersByTime(1_000);
    await resolver.resolve('token');

    expect(inner.callCount('token')).toBe(2);
  });

  it('stats delegates to inner resolver', async () => {
    const inner = mockResolver({ key: 'val' });
    const resolver = createTtlResolver(inner, 60_000);

    await resolver.resolve('key');
    const stats = resolver.stats('key');
    expect(stats.reads).toBe(1);
  });
});

describe('scope', () => {
  it('prefix: resolve forwards with hyphenated prefix', async () => {
    const calls: string[] = [];
    const inner: SecretsResolver = {
      async resolve(name) {
        calls.push(name);
        return ok('value');
      },
      invalidate(_name) {},
      stats(_name) { return { reads: 0 }; },
    };

    const scoped = scope(inner, 'db');
    await scoped.resolve('password');

    expect(calls).toEqual(['db-password']);
    expect(scoped.prefix).toBe('db');
  });

  it('invalidate: forwards with prefix', () => {
    const invalidated: string[] = [];
    const inner: SecretsResolver = {
      async resolve(_name) { return ok('v'); },
      invalidate(name) { invalidated.push(name); },
      stats(_name) { return { reads: 0 }; },
    };

    const scoped = scope(inner, 'svc');
    scoped.invalidate('token');

    expect(invalidated).toEqual(['svc-token']);
  });

  it('stats: forwards with prefix', () => {
    const inner: SecretsResolver = {
      async resolve(_name) { return ok('v'); },
      invalidate(_name) {},
      stats(name) { return { reads: name === 'ns-key' ? 5 : 0 }; },
    };

    const scoped = scope(inner, 'ns');
    const stats = scoped.stats('key');

    expect(stats.reads).toBe(5);
  });
});

describe('composition: createTtlResolver(createVersionAwareResolver(inner))', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('layered: cache hit within TTL window, re-fetch after expiry', async () => {
    const inner = mockResolver({ secret: 'v1' });
    const ttlMs = 30_000;
    const resolver = createTtlResolver(createVersionAwareResolver(inner), ttlMs);

    // First resolve — cache miss, inner called
    const r1 = await resolver.resolve('secret');
    expect(r1.data).toBe('v1');
    expect(inner.callCount('secret')).toBe(1);

    // Within TTL — cache hit, inner NOT called again
    vi.advanceTimersByTime(ttlMs - 1);
    const r2 = await resolver.resolve('secret');
    expect(r2.data).toBe('v1');
    expect(inner.callCount('secret')).toBe(1);

    // Advance a full TTL from the last resolve — TTL expires, version-aware cache cleared, inner called again
    vi.advanceTimersByTime(ttlMs);
    const r3 = await resolver.resolve('secret');
    expect(r3.data).toBe('v1');
    expect(inner.callCount('secret')).toBe(2);
  });
});
