import type { ZodType } from 'zod';
import type { PipelineContext } from '../context.js';
import type { StoreError } from '../errors/store.js';
import type { Result } from '../result.js';
import type { Atom } from './atom.js';

export interface StoreFilters {
  source_id?: string;
  stage_id?: string;
  run_id?: string;
  metadata?: Record<string, unknown>;
  limit?: number;
  cursor?: string;
}

export interface ListResult<T> {
  items: T[];
  has_more: boolean;
  cursor?: string;
}

export interface Store<T> {
  readonly id: string;
  readonly schema: ZodType<T>;
  put(atom: Atom<T>, ctx: PipelineContext): Promise<Result<Atom<T>, StoreError>>;
  get(id: string, ctx: PipelineContext): Promise<Result<Atom<T> | null, StoreError>>;
  list(
    filters: StoreFilters,
    ctx: PipelineContext,
  ): Promise<Result<ListResult<Atom<T>>, StoreError>>;
}
