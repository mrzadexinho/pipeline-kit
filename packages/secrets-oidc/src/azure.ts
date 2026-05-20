import type { Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from '@idriszade/secrets';

export interface AzureTokenResult {
  token: string;
  expiresOnTimestamp?: number;
}

export interface AzureCredential {
  getToken: (scopes: string | string[]) => Promise<AzureTokenResult | null>;
}

export interface AzureWifOptions {
  /**
   * Optional credential injection for tests.
   * Must implement .getToken(scopes) returning { token: string; expiresOnTimestamp: number } | null.
   */
  credential?: AzureCredential;
  /**
   * Scope to request. Defaults to 'https://management.azure.com/.default'.
   */
  scope?: string;
}

const DEFAULT_SCOPE = 'https://management.azure.com/.default';

/**
 * Creates a SecretsResolver backed by Azure Workload Identity Federation.
 *
 * Returns short-lived tokens via WorkloadIdentityCredential from @azure/identity.
 * Token refresh is handled by the underlying Azure SDK.
 * `invalidate()` is a hint for consumers wrapping with createVersionAwareResolver.
 *
 * ADR: VIII-5 (reference-adapter trio, oidc/azure leg)
 */
export function azureWif(options?: AzureWifOptions): SecretsResolver {
  const readCounts = new Map<string, number>();
  const versionCounters = new Map<string, number>();
  const scope = options?.scope ?? DEFAULT_SCOPE;
  let cachedCredential: AzureCredential | undefined = options?.credential;

  async function getCredential(): Promise<Result<AzureCredential, SecretsError>> {
    if (cachedCredential !== undefined) {
      return ok(cachedCredential);
    }
    try {
      const { WorkloadIdentityCredential } = await import('@azure/identity');
      cachedCredential = new WorkloadIdentityCredential();
      return ok(cachedCredential);
    } catch {
      return err({
        type: 'secrets_error' as const,
        code: 'secret_unavailable' as const,
        message: '@azure/identity not installed; install @idriszade/secrets-oidc peer dep',
      });
    }
  }

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      readCounts.set(name, (readCounts.get(name) ?? 0) + 1);

      const credentialResult = await getCredential();
      if (credentialResult.error !== null) {
        return credentialResult;
      }
      const credential = credentialResult.data;

      try {
        const tokenResult = await credential.getToken(scope);
        if (tokenResult === null) {
          return err({
            type: 'secrets_error' as const,
            code: 'secret_not_found' as const,
            message: `Azure WIF: no token returned for scope '${scope}' (name: '${name}')`,
          });
        }
        return ok(tokenResult.token);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Azure WIF: unknown error fetching token';
        return err({
          type: 'secrets_error' as const,
          code: 'secret_unavailable' as const,
          message,
        });
      }
    },

    invalidate(name: string): void {
      versionCounters.set(name, (versionCounters.get(name) ?? 0) + 1);
    },

    stats(name: string): SecretStats {
      const version = versionCounters.get(name);
      return {
        reads: readCounts.get(name) ?? 0,
        currentVersion: version !== undefined ? String(version) : undefined,
      };
    },
  };
}
