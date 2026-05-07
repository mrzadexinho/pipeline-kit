import {
  err,
  ok,
  type PipelineContext,
  type Process,
  type ProcessError,
  proc,
  type Result,
  type RetryPolicy,
} from '@pipeline-kit/core';
import type { ZodType } from 'zod';

export interface ValidateProcessConfig<I> {
  id?: string;
  schema: ZodType<I>;
  mode?: 'coerce' | 'strict';
  onCoerce?: (path: string, original: unknown, fallback: unknown) => void;
  retryPolicy?: Partial<RetryPolicy>;
}

export function createValidateProcess<I>(config: ValidateProcessConfig<I>): Process<I, I> {
  const { schema, mode = 'coerce', onCoerce, retryPolicy, id = proc() } = config;

  const process: Process<I, I> = {
    id,
    inputSchema: schema,
    outputSchema: schema,
    retryPolicy,
    async run(input: I, _ctx: PipelineContext): Promise<Result<I, ProcessError>> {
      const result = schema.safeParse(input);

      if (result.success) {
        // Call onCoerce callback if data was transformed
        if (mode === 'coerce' && onCoerce && result.data !== input) {
          onCoerce('', input, result.data);
        }
        return ok(result.data);
      }

      // Schema parse failed
      const code = mode === 'strict' ? 'schema_parse_failed' : 'schema_coerce_failed';
      const error: ProcessError = {
        type: 'validation',
        code,
        message: result.error.message,
        metadata: {
          issues: result.error.issues,
        },
      };

      return err(error);
    },
  };

  return process;
}
