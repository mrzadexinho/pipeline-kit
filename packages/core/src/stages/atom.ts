import type { ResourceEnvelope } from '../envelope.js';

export interface Atom<T> extends ResourceEnvelope {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
  source_id?: string;
  stage_id?: string;
  run_id?: string;
}
