import type { Result } from '@idriszade/core';
import type { SecretsError, SecretsResolver, SecretStats } from './types.js';

export function createTtlResolver(inner: SecretsResolver, ttlMs: number): SecretsResolver {
  const lastResolved = new Map<string, number>();

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      const last = lastResolved.get(name);
      if (last !== undefined && Date.now() - last >= ttlMs) {
        inner.invalidate(name);
        lastResolved.delete(name);
      }
      const result = await inner.resolve(name);
      if (result.error === null) {
        lastResolved.set(name, Date.now());
      }
      return result;
    },

    invalidate(name: string): void {
      lastResolved.delete(name);
      inner.invalidate(name);
    },

    stats(name: string): SecretStats {
      return inner.stats(name);
    },
  };
}
