# @idriszade/secrets-oidc

T3 OIDC workload-identity `SecretsResolver` adapters for cloud-native short-lived tokens.

Implements the 2024-26 modern direction: workload-identity / short-lived tokens replace
long-lived static secrets at the cloud boundary. Each adapter returns tokens whose lifecycle
is managed by the underlying cloud SDK. `invalidate()` is a hint for consumers wrapping with
`createVersionAwareResolver`.

ADR: VIII-5 (reference-adapter trio, oidc leg); Cat VIII modern-direction framing.

## Peer-dep installation matrix

Install only the submodules you use. The package itself has no required runtime deps beyond
`@idriszade/core`.

| Submodule | Peer dep | Install |
|-----------|----------|---------|
| `@idriszade/secrets-oidc/gcp` | `google-auth-library` | `pnpm add google-auth-library` |
| `@idriszade/secrets-oidc/aws` | `@aws-sdk/credential-provider-node` | `pnpm add @aws-sdk/credential-provider-node` |
| `@idriszade/secrets-oidc/azure` | `@azure/identity` | `pnpm add @azure/identity` |

## Quick start

### GCP Workload Identity Federation

```ts
import { gcpWif } from '@idriszade/secrets-oidc/gcp';

const resolver = gcpWif({
  // audience is optional — GoogleAuth reads GOOGLE_APPLICATION_CREDENTIALS or
  // the ambient service account on GKE/Cloud Run automatically
  audience: '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/my-pool/providers/my-provider',
});

const result = await resolver.resolve('access_token');
if (result.error) {
  console.error(result.error.message);
} else {
  console.log('token:', result.data);
}
```

### AWS IRSA (IAM Roles for Service Accounts)

```ts
import { awsIrsa } from '@idriszade/secrets-oidc/aws';

const resolver = awsIrsa();
// Uses @aws-sdk/credential-provider-node fromNodeProviderChain() automatically.
// On EKS with IRSA configured, the pod's projected token is exchanged via STS.

const result = await resolver.resolve('session_token');
if (result.error) {
  console.error(result.error.message);
} else {
  console.log('session token:', result.data);
}
```

### Azure Workload Identity Federation

```ts
import { azureWif } from '@idriszade/secrets-oidc/azure';

const resolver = azureWif({
  scope: 'https://storage.azure.com/.default', // optional, defaults to management.azure.com
});
// Uses @azure/identity WorkloadIdentityCredential automatically.
// Reads AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_FEDERATED_TOKEN_FILE from env.

const result = await resolver.resolve('access_token');
if (result.error) {
  console.error(result.error.message);
} else {
  console.log('token:', result.data);
}
```

## Notes

- These adapters return short-lived tokens managed by the underlying cloud SDK. Token refresh
  is handled by the SDK; `invalidate()` is a hint to consumers wrapping with
  `createVersionAwareResolver` from `@idriszade/secrets`.
- The `name` argument to `resolve(name)` is descriptive only — each adapter returns the one
  workload-identity-derived token regardless of name.
- Missing peer dep → `resolve()` returns `err` with `code: 'secret_unavailable'` and an
  install hint message. No runtime crash.
- All adapters accept an optional injection point (`authClient` / `credentialsProvider` /
  `credential`) for testing without real cloud credentials.
