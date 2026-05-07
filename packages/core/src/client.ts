import { DEFAULT_RETRY_POLICY } from './composer/retry.js';
import type { MemoryAdapter } from './context.js';
import type { RetryPolicy } from './policy.js';
import { type AtomsResource, createAtomsResource } from './resources/atoms.js';
import { createPipelinesResource, type PipelinesResource } from './resources/pipelines.js';
import { createRunsResource, type RunsResource } from './resources/runs.js';
import { createWebhooksResource, type WebhooksResource } from './resources/webhooks.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ClientConfig {
  apiKey?: string;
  url?: string;
  memory?: MemoryAdapter;
  timeout?: number;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface ResolvedClientConfig {
  apiKey?: string;
  url?: string;
  memory?: MemoryAdapter;
  timeout: number;
  retryPolicy: RetryPolicy;
}

export interface PipelineKitClient {
  pipelines: PipelinesResource;
  runs: RunsResource;
  atoms: AtomsResource;
  webhooks: WebhooksResource;
}

export function resolveClientConfig(config?: ClientConfig): ResolvedClientConfig {
  return {
    apiKey: config?.apiKey ?? process.env.PIPELINE_KIT_API_KEY,
    url: config?.url ?? process.env.PIPELINE_KIT_URL,
    memory: config?.memory,
    timeout: config?.timeout ?? DEFAULT_TIMEOUT_MS,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...config?.retryPolicy },
  };
}

export function createPipelineKit(config?: ClientConfig): PipelineKitClient {
  void resolveClientConfig(config);
  return {
    pipelines: createPipelinesResource(),
    runs: createRunsResource(),
    atoms: createAtomsResource(),
    webhooks: createWebhooksResource(),
  };
}
