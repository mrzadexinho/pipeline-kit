import type { Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from '@idriszade/secrets';

export interface AwsCredentials {
  sessionToken?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface AwsIrsaOptions {
  /**
   * Optional credentials provider injection for tests.
   * Must be the result type of @aws-sdk/credential-provider-node fromNodeProviderChain().
   */
  credentialsProvider?: () => Promise<AwsCredentials>;
}

/**
 * Creates a SecretsResolver backed by AWS IRSA (IAM Roles for Service Accounts).
 *
 * Returns the short-lived session token from the AWS node provider chain.
 * The name argument is descriptive; the adapter returns the one IRSA session token
 * regardless of name. Token refresh is handled by the underlying AWS SDK.
 * `invalidate()` is a hint for consumers wrapping with createVersionAwareResolver.
 *
 * ADR: VIII-5 (reference-adapter trio, oidc/aws leg)
 */
export function awsIrsa(options?: AwsIrsaOptions): SecretsResolver {
  const readCounts = new Map<string, number>();
  const versionCounters = new Map<string, number>();
  let cachedProvider: (() => Promise<AwsCredentials>) | undefined = options?.credentialsProvider;

  async function getProvider(): Promise<Result<() => Promise<AwsCredentials>, SecretsError>> {
    if (cachedProvider !== undefined) {
      return ok(cachedProvider);
    }
    try {
      const mod = await import('@aws-sdk/credential-provider-node');
      // v3 exports defaultProvider; some bundled re-exports also expose fromNodeProviderChain
      const factory =
        'fromNodeProviderChain' in mod
          ? (mod as { fromNodeProviderChain: () => () => Promise<AwsCredentials> })
              .fromNodeProviderChain
          : mod.defaultProvider;
      const provider = factory() as () => Promise<AwsCredentials>;
      cachedProvider = provider;
      return ok(provider);
    } catch {
      return err({
        type: 'secrets_error' as const,
        code: 'secret_unavailable' as const,
        message:
          '@aws-sdk/credential-provider-node not installed; install @idriszade/secrets-oidc peer dep',
      });
    }
  }

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      readCounts.set(name, (readCounts.get(name) ?? 0) + 1);

      const providerResult = await getProvider();
      if (providerResult.error !== null) {
        return providerResult;
      }
      const provider = providerResult.data;

      try {
        const credentials = await provider();
        const token = credentials.sessionToken;
        if (token == null) {
          return err({
            type: 'secrets_error' as const,
            code: 'secret_not_found' as const,
            message: `AWS IRSA: no session token in credentials for '${name}'`,
          });
        }
        return ok(token);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'AWS IRSA: unknown error fetching credentials';
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
