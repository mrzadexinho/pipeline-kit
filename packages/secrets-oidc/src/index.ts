/**
 * @idriszade/secrets-oidc
 *
 * OIDC workload-identity SecretsResolver adapters for cloud-native short-lived tokens.
 * Implements the 2024-26 modern direction per Cat VIII synthesis (ADR VIII-5).
 *
 * Install only the peer dep for the submodule you use:
 *   gcp  → google-auth-library
 *   aws  → @aws-sdk/credential-provider-node
 *   azure → @azure/identity
 */

export type { AwsCredentials, AwsIrsaOptions } from './aws.js';
export { awsIrsa } from './aws.js';
export type { AzureCredential, AzureTokenResult, AzureWifOptions } from './azure.js';
export { azureWif } from './azure.js';
export type { GcpWifOptions } from './gcp.js';
export { gcpWif } from './gcp.js';
