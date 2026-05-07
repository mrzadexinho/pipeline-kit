import type { ErrorEnvelope } from '../envelope.js';
import type { Result } from '../result.js';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunDescriptor {
  id: string;
  object: 'run';
  pipeline_id: string;
  status: RunStatus;
  created_at: string;
  completed_at?: string;
  output?: unknown;
  metadata: Record<string, unknown>;
}

export interface CreateRunInput {
  pipeline_id: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface RunListFilters {
  pipeline_id?: string;
  status?: RunStatus;
  limit?: number;
  cursor?: string;
}

export interface RunListResult {
  items: RunDescriptor[];
  has_more: boolean;
  cursor?: string;
}

export interface RunsResource {
  create(input: CreateRunInput): Promise<Result<RunDescriptor, ErrorEnvelope>>;
  get(id: string): Promise<Result<RunDescriptor, ErrorEnvelope>>;
  list(filters?: RunListFilters): Promise<Result<RunListResult, ErrorEnvelope>>;
  cancel(id: string): Promise<Result<RunDescriptor, ErrorEnvelope>>;
}

const NOT_IMPLEMENTED: ErrorEnvelope = {
  type: 'not_implemented',
  code: 'pk_resources_v0',
  message:
    'pk.runs.* requires a pipeline-kit-cloud backend (v2). For v0, use Pipeline factory directly.',
  doc_url: 'https://github.com/mrzadexinho/pipeline-kit#v0-vs-v2',
};

export function createRunsResource(): RunsResource {
  return {
    async create(_input) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
    async get(_id) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
    async list(_filters) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
    async cancel(_id) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
  };
}
