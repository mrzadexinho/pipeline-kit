import type { ZodType } from 'zod';
import type { PipelineContext } from '../context.js';
import type { ProcessError } from '../errors/process.js';
import type { RetryPolicy } from '../policy.js';
import type { Result } from '../result.js';

export interface Process<I, O> {
  readonly id: string;
  readonly inputSchema?: ZodType<I>;
  readonly outputSchema?: ZodType<O>;
  readonly retryPolicy?: Partial<RetryPolicy>;
  run(input: I, ctx: PipelineContext): Promise<Result<O, ProcessError>>;
}
