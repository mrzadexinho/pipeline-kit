import type { Result } from '@idriszade/core';
import type { SecretsError, ScopedSecretsResolver, SecretsResolver, SecretStats } from './types.js';

export function scope(resolver: SecretsResolver, prefix: string): ScopedSecretsResolver {
  return {
    prefix,

    async resolve(name: string): Promise<Result<string, SecretsError>> {
      return resolver.resolve(`${prefix}-${name}`);
    },

    invalidate(name: string): void {
      resolver.invalidate(`${prefix}-${name}`);
    },

    stats(name: string): SecretStats {
      return resolver.stats(`${prefix}-${name}`);
    },
  };
}
