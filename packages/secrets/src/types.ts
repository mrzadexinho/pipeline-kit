import type { Result } from '@idriszade/core';

export interface SecretsError {
  type: 'secrets_error';
  code: 'secret_not_found' | 'secret_unavailable' | 'secret_access_denied';
  message: string;
}

export interface SecretStats {
  reads: number;
  currentVersion?: string;
}

export interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
  invalidate(name: string): void;
  stats(name: string): SecretStats;
}

export interface ScopedSecretsResolver extends SecretsResolver {
  readonly prefix: string;
}
