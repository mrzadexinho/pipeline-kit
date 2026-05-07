import type { ZodType } from 'zod';
import type { PipelineContext } from '../context.js';
import type { ServeError } from '../errors/serve.js';
import type { RetryPolicy, TokenBucketConfig } from '../policy.js';
import type { Result } from '../result.js';

export type IdempotencySupport = 'required' | 'optional' | 'unsupported';

export interface EmitResult {
  id: string;
  emitted_at: string;
  metadata: Record<string, unknown>;
}

export interface Serve<I> {
  readonly id: string;
  readonly schema: ZodType<I>;
  readonly idempotencySupport: IdempotencySupport;
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly rateLimit?: TokenBucketConfig;
  emit(input: I, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>>;
}
