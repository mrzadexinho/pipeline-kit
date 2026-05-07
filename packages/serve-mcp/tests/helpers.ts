import type {
  PipelineContext,
  Result,
  RunResult,
  TerminalPipeline,
  TraceContext,
} from '@pipeline-kit/core';

export function makeCtx(idempotencyKey?: string): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: {} as unknown as TraceContext,
    idempotencyKey,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

export interface MockPipelineConfig<O> {
  output?: O;
  error?: { message: string; code?: string };
  runId?: string;
}

export function makeMockPipeline<O>(cfg: MockPipelineConfig<O>): TerminalPipeline<O> {
  return {
    async run(_input?: unknown): Promise<Result<RunResult<O>, never>> {
      if (cfg.error) {
        return { data: null, error: cfg.error } as unknown as Result<RunResult<O>, never>;
      }
      return {
        data: {
          runId: cfg.runId ?? 'pk_run_test_123',
          pipelineId: 'pk_pipe_test',
          output: cfg.output as O,
          atomCount: 1,
          duration: 50,
          metadata: {},
        },
        error: null,
      } as Result<RunResult<O>, never>;
    },
    describe() {
      return { pipelineId: 'pk_pipe_test', steps: [] };
    },
  };
}
