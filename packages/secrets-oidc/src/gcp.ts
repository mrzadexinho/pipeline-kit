import type { Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from '@idriszade/secrets';

export interface GcpWifOptions {
  /**
   * Workload Identity Federation audience.
   * E.g., `//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/my-pool/providers/my-provider`
   */
  audience?: string;
  /**
   * Optional auth client injection for tests.
   * Must implement `.getAccessToken()` returning `{ token: string | null | undefined }`.
   */
  authClient?: { getAccessToken: () => Promise<{ token?: string | null }> };
}

/**
 * Creates a SecretsResolver backed by GCP Workload Identity Federation.
 *
 * Returns short-lived access tokens managed by google-auth-library.
 * Token refresh is handled by the underlying GoogleAuth client.
 * `invalidate()` is a hint for consumers wrapping with createVersionAwareResolver.
 *
 * ADR: VIII-5 (reference-adapter trio, oidc/gcp leg)
 */
export function gcpWif(options?: GcpWifOptions): SecretsResolver {
  const readCounts = new Map<string, number>();
  const versionCounters = new Map<string, number>();
  let cachedClient: { getAccessToken: () => Promise<{ token?: string | null }> } | undefined =
    options?.authClient;

  async function getClient(): Promise<
    Result<{ getAccessToken: () => Promise<{ token?: string | null }> }, SecretsError>
  > {
    if (cachedClient !== undefined) {
      return ok(cachedClient);
    }
    try {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      cachedClient = await auth.getClient();
      return ok(cachedClient);
    } catch {
      return err({
        type: 'secrets_error' as const,
        code: 'secret_unavailable' as const,
        message: 'google-auth-library not installed; install @idriszade/secrets-oidc peer dep',
      });
    }
  }

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      readCounts.set(name, (readCounts.get(name) ?? 0) + 1);

      const clientResult = await getClient();
      if (clientResult.error !== null) {
        return clientResult;
      }
      const client = clientResult.data;

      try {
        const tokenResult = await client.getAccessToken();
        const token = tokenResult.token;
        if (token == null) {
          return err({
            type: 'secrets_error' as const,
            code: 'secret_not_found' as const,
            message: `GCP WIF: no access token returned for '${name}'`,
          });
        }
        return ok(token);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'GCP WIF: unknown error fetching access token';
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
