import { ok, type Result } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from './types.js';

interface CacheEntry {
  value: string;
  version: string;
}

export function createVersionAwareResolver(inner: SecretsResolver): SecretsResolver {
  const cache = new Map<string, CacheEntry>();
  const readCounts = new Map<string, number>();

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      readCounts.set(name, (readCounts.get(name) ?? 0) + 1);
      const cached = cache.get(name);
      if (cached !== undefined) {
        return ok(cached.value);
      }
      const result = await inner.resolve(name);
      if (result.error !== null) return result;
      const version = String(readCounts.get(name) ?? 1);
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
