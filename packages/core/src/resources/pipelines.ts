import type { ErrorEnvelope } from '../envelope.js';
import type { Result } from '../result.js';

export interface PipelineDescriptor {
  id: string;
  object: 'pipeline';
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface CreatePipelineInput {
  definition: unknown;
  metadata?: Record<string, unknown>;
}

export interface PipelineListFilters {
  limit?: number;
  cursor?: string;
}

export interface PipelineListResult {
  items: PipelineDescriptor[];
  has_more: boolean;
  cursor?: string;
}

export interface PipelinesResource {
  create(input: CreatePipelineInput): Promise<Result<PipelineDescriptor, ErrorEnvelope>>;
  get(id: string): Promise<Result<PipelineDescriptor, ErrorEnvelope>>;
  list(filters?: PipelineListFilters): Promise<Result<PipelineListResult, ErrorEnvelope>>;
}

const NOT_IMPLEMENTED: ErrorEnvelope = {
  type: 'not_implemented',
  code: 'pk_resources_v0',
  message:
    'pk.pipelines.* requires a pipeline-kit-cloud backend (v2). For v0, use Pipeline factory directly.',
  doc_url: 'https://github.com/mrzadexinho/pipeline-kit#v0-vs-v2',
};

export function createPipelinesResource(): PipelinesResource {
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
  };
}
