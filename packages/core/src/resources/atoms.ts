import type { ErrorEnvelope } from '../envelope.js';
import type { Result } from '../result.js';
import type { Atom } from '../stages/atom.js';

export interface AtomListFilters {
  run_id?: string;
  source_id?: string;
  stage_id?: string;
  limit?: number;
  cursor?: string;
}

export interface AtomListResult {
  items: Atom<unknown>[];
  has_more: boolean;
  cursor?: string;
}

export interface AtomsResource {
  get(id: string): Promise<Result<Atom<unknown>, ErrorEnvelope>>;
  list(filters?: AtomListFilters): Promise<Result<AtomListResult, ErrorEnvelope>>;
}

const NOT_IMPLEMENTED: ErrorEnvelope = {
  type: 'not_implemented',
  code: 'pk_resources_v0',
  message:
    'pk.atoms.* requires a pipeline-kit-cloud backend (v2). For v0, use Pipeline factory directly.',
  doc_url: 'https://github.com/mrzadexinho/pipeline-kit#v0-vs-v2',
};

export function createAtomsResource(): AtomsResource {
  return {
    async get(_id) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
    async list(_filters) {
      return { data: null, error: NOT_IMPLEMENTED };
    },
  };
}
