/**
 * C2: External-rotation detection tests for createVersionAwareResolver.
 *
 * Verifies ADR VIII-2: per-resolve inner.stats(name).currentVersion probe.
 * When the inner adapter's currentVersion advances between resolves, the
 * version-aware resolver must evict the stale cache entry and re-resolve
 * without an explicit invalidate() call.
 */
import { ok } from '@idriszade/core';
import { describe, expect, it, vi } from 'vitest';
import type { SecretStats, SecretsResolver } from '../src/index.js';
import { createVersionAwareResolver } from '../src/index.js';

/**
 * Build a fake inner resolver whose secret value and currentVersion can be
 * rotated externally by calling `rotate(name, newValue, newVersion)`.
 * Exposes callCount for assertion.
 */
function makeMutableInner(): SecretsResolver & {
  rotate(name: string, value: string, version: string): void;
  callCount(name: string): number;
} {
  const secrets = new Map<string, { value: string; version: string }>();
  const callCounts = new Map<string, number>();

  return {
    async resolve(name: string) {
      callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
      const entry = secrets.get(name);
      if (entry === undefined) {
        return {
          data: null,
          error: {
            type: 'secrets_error' as const,
            code: 'secret_not_found' as const,
            message: `Not found: ${name}`,
          },
        };
      }
      return ok(entry.value);
    },
    invalidate(_name: string) {
      /* no-op */
    },
    stats(name: string): SecretStats {
      const entry = secrets.get(name);
      return {
        reads: callCounts.get(name) ?? 0,
        currentVersion: entry?.version,
      };
    },
    rotate(name: string, value: string, version: string) {
      secrets.set(name, { value, version });
    },
    callCount(name: string): number {
      return callCounts.get(name) ?? 0;
    },
  };
}

describe('createVersionAwareResolver — external rotation detection (ADR VIII-2)', () => {
  it('detects external rotation: second resolve returns new value without explicit invalidate()', async () => {
    const inner = makeMutableInner();
    inner.rotate('db-pass', 'pass-v1', 'v1');
    const resolver = createVersionAwareResolver(inner);

    const r1 = await resolver.resolve('db-pass');
    expect(r1.data).toBe('pass-v1');
    expect(inner.callCount('db-pass')).toBe(1);

    // External rotation — inner now has a new version.
    inner.rotate('db-pass', 'pass-v2', 'v2');

    // No explicit invalidate() — rotation must be auto-detected via stats probe.
    const r2 = await resolver.resolve('db-pass');
    expect(r2.data).toBe('pass-v2');
    // Inner must have been called again to re-resolve the rotated secret.
    expect(inner.callCount('db-pass')).toBe(2);
  });

  it('same version: returns cached value without re-calling inner', async () => {
    const inner = makeMutableInner();
    inner.rotate('api-key', 'key-abc', 'ver-1');
    const resolver = createVersionAwareResolver(inner);

    await resolver.resolve('api-key');
    expect(inner.callCount('api-key')).toBe(1);

    // No rotation — version stays the same.
    const r2 = await resolver.resolve('api-key');
    expect(r2.data).toBe('key-abc');
    expect(inner.callCount('api-key')).toBe(1); // cache hit
  });

  it('multiple rotations: each version change triggers a re-resolve', async () => {
    const inner = makeMutableInner();
    inner.rotate('token', 'tok-1', 'v1');
    const resolver = createVersionAwareResolver(inner);

    await resolver.resolve('token');
    expect(inner.callCount('token')).toBe(1);

    inner.rotate('token', 'tok-2', 'v2');
    const r2 = await resolver.resolve('token');
    expect(r2.data).toBe('tok-2');
    expect(inner.callCount('token')).toBe(2);

    inner.rotate('token', 'tok-3', 'v3');
    const r3 = await resolver.resolve('token');
    expect(r3.data).toBe('tok-3');
    expect(inner.callCount('token')).toBe(3);
  });

  it('no-version inner: emits console.warn once per name, serves from cache', async () => {
    // Use an inner that returns undefined currentVersion (no versioning support).
    const noVersionInner: SecretsResolver = {
      async resolve(_name) {
        return ok('static-value');
      },
      invalidate(_name) {},
      stats(_name) {
        return { reads: 0 }; // currentVersion intentionally absent
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = createVersionAwareResolver(noVersionInner);

    // First resolve — populates cache (no warn yet, no cache to check).
    const r1 = await resolver.resolve('secret');
    expect(r1.data).toBe('static-value');
    expect(warnSpy).not.toHaveBeenCalled();

    // Second resolve — cache hit, no version to probe → warn emitted.
    const r2 = await resolver.resolve('secret');
    expect(r2.data).toBe('static-value');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('secret');

    // Third resolve — warn NOT emitted again (once per name per instance).
    const r3 = await resolver.resolve('secret');
    expect(r3.data).toBe('static-value');
    expect(warnSpy).toHaveBeenCalledOnce(); // still just once

    warnSpy.mockRestore();
  });

  it('stats reflects post-rotation version after auto-eviction', async () => {
    const inner = makeMutableInner();
    inner.rotate('key', 'val-1', 'rev-1');
    const resolver = createVersionAwareResolver(inner);

    await resolver.resolve('key');
    expect(resolver.stats('key').currentVersion).toBe('rev-1');

    inner.rotate('key', 'val-2', 'rev-2');
    await resolver.resolve('key'); // triggers auto-eviction + re-resolve
    expect(resolver.stats('key').currentVersion).toBe('rev-2');
  });
});
