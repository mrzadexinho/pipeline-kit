import type { ZodType } from 'zod';
import type { PipelineContext } from '../context.js';
import type { SourceError } from '../errors/source.js';
import type { RetryPolicy, TokenBucketConfig } from '../policy.js';
import type { Result } from '../result.js';
import type { Atom } from './atom.js';

export type SourceQuery = Record<string, unknown> | undefined;

export interface Source<O> {
  readonly id: string;
  readonly schema: ZodType<O>;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly rateLimit?: TokenBucketConfig;
  iter(query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>>;
  fetch(query: SourceQuery, ctx: PipelineContext): Promise<Result<Atom<O>[], SourceError>>;
}
