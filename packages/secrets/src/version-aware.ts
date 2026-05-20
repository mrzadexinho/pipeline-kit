import { ok, type Result } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from './types.js';

interface CacheEntry {
  value: string;
  /**
   * Version token for this cache entry.
   * - When inner exposes `stats(name).currentVersion`: mirrors the inner's version,
   *   enabling external-rotation detection on each resolve.
   * - When inner does NOT expose a version: uses an internal counter string
   *   (same as the original behaviour) so `stats().currentVersion` is always defined
   *   after a successful resolve.
   */
  version: string;
}

/**
 * Derive a version token from the inner adapter or fall back to a counter.
 * `resolveCount` is the current readCounts value for the name.
 */
function deriveVersion(innerVersion: string | undefined, resolveCount: number): string {
  return innerVersion ?? String(resolveCount);
}

export function createVersionAwareResolver(inner: SecretsResolver): SecretsResolver {
  const cache = new Map<string, CacheEntry>();
  const readCounts = new Map<string, number>();
  const warnedNames = new Set<string>();

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      const count = (readCounts.get(name) ?? 0) + 1;
      readCounts.set(name, count);
      const cached = cache.get(name);

      if (cached !== undefined) {
        // ADR VIII-2: per-resolve external-rotation probe.
        // Fetch the inner adapter's current version each time we would serve from cache.
        const innerVersion = inner.stats(name).currentVersion;

        if (innerVersion === undefined) {
          // Inner adapter doesn't expose versioning — fall back to cache-until-invalidate.
          // Emit a one-time warning per name so operators know the limitation.
          if (!warnedNames.has(name)) {
            warnedNames.add(name);
            console.warn(
              `[pipeline-kit/secrets] version-aware-resolver: inner adapter does not expose ` +
                `currentVersion for "${name}". External rotation will NOT be detected automatically; ` +
                `call resolver.invalidate("${name}") to force a refresh.`,
            );
          }
          return ok(cached.value);
        }

        // Version mismatch detected — external rotation occurred.
        // Evict the stale cache entry and re-resolve from inner.
        if (cached.version !== innerVersion) {
          cache.delete(name);
          const result = await inner.resolve(name);
          if (result.error !== null) return result;
          cache.set(name, { value: result.data, version: innerVersion });
          return result;
        }

        return ok(cached.value);
      }

      const result = await inner.resolve(name);
      if (result.error !== null) return result;
      const version = deriveVersion(inner.stats(name).currentVersion, count);
      cache.set(name, { value: result.data, version });
      return result;
    },

    invalidate(name: string): void {
      cache.delete(name);
      inner.invalidate(name);
    },

    stats(name: string): SecretStats {
      return {
        reads: readCounts.get(name) ?? 0,
        currentVersion: cache.get(name)?.version,
      };
    },
  };
}
