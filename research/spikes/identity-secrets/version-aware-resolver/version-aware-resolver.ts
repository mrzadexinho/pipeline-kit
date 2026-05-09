// Cat VIII spike #4 leg-1 — version-aware-resolver wrapper.
// Spike-only throwaway. Wraps a SecretsResolver and consults
// stats(name).current_version on each resolve(name) to decide whether the
// cached value is still fresh. Cache-drop is version-stamp-driven only —
// invalidate(name) is forwarded to the underlying real resolver but the
// wrapper does NOT proactively drop its cache on invalidate. The next
// resolve(name) call observes the bumped version via stats and re-fetches.
// This is intentional — brain wants to observe whether version-stamp-only
// is sufficient.
//
// No new error codes; the wrapper passes underlying SecretsError through
// unchanged. Sync stats(name) is forwarded unchanged so harness read counts
// keep landing on the underlying real resolver.

import {
  ok,
  type Result,
  type SecretStats,
  type SecretsError,
  type SecretsResolver,
} from './mock-secrets-resolver.ts';

interface CacheEntry {
  value: string;
  version: number;
}

export function createVersionAwareResolver(real: SecretsResolver): SecretsResolver {
  const cache = new Map<string, CacheEntry>();

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      // Probe the underlying resolver's current version. If the secret is
      // missing or the name is malformed, stats() surfaces that error and
      // we forward it without caching.
      const statsResult: Result<SecretStats, SecretsError> = real.stats(name);
      if (statsResult.error !== null) {
        return { data: null, error: statsResult.error };
      }
      const currentVersion = statsResult.data.current_version;

      const cached = cache.get(name);
      if (cached !== undefined && cached.version === currentVersion) {
        return ok(cached.value);
      }

      // Cache miss OR version mismatch → re-fetch from underlying real.
      const fresh = await real.resolve(name);
      if (fresh.error !== null) {
        // Do NOT cache errors. Forward unchanged.
        return fresh;
      }
      cache.set(name, { value: fresh.data, version: currentVersion });
      return fresh;
    },
    invalidate(name: string): Result<void, SecretsError> {
      // Pass-through. Wrapper's own cache is NOT proactively dropped — the
      // next resolve(name) sees the bumped version via stats() and re-fetches.
      return real.invalidate(name);
    },
    stats(name: string): Result<SecretStats, SecretsError> {
      return real.stats(name);
    },
  };
}
