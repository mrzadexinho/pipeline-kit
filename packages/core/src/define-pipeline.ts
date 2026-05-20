import type { TraceContext } from './context.js';
import type { RunError } from './errors/run.js';
import type { PipelineStep, RunResult, TerminalPipeline } from './pipeline-types.js';
import type { RetryPolicy } from './policy.js';
import type { Result } from './result.js';
import type { TriggerConfig } from './trigger.js';
import type { CostBudget } from './usage.js';

export interface ConcurrencyPolicy {
  limit: number;
  overflow?: 'queue' | 'reject';
}

export interface DefinePipelineOpts {
  id: `pk_pipe_${string}`;
  trigger?: TriggerConfig;
  retry?: Partial<RetryPolicy>;
  concurrency?: ConcurrencyPolicy;
  tags?: Record<string, string>;
  version?: string;
}

export interface StepDescriptor {
  name?: string;
  adapterType?: string;
  kind: string;
}

export interface PipelineDefinitionEnriched {
  id: string;
  trigger?: TriggerConfig;
  retry?: Partial<RetryPolicy>;
  concurrency?: ConcurrencyPolicy;
  tags?: Record<string, string>;
  version?: string;
  steps: StepDescriptor[];
}

export interface DefinedPipelineRunOptions {
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  parentTraceContext?: TraceContext;
  costBudget?: CostBudget[];
  deps?: Record<string, unknown>;
}

export interface DefinedPipeline<O> {
  run(
    input?: unknown,
    options?: DefinedPipelineRunOptions,
  ): Promise<Result<RunResult<O>, RunError>>;
  describe(): PipelineDefinitionEnriched;
}

export function definePipeline<O>(
  opts: DefinePipelineOpts,
  pipeline: TerminalPipeline<O>,
): DefinedPipeline<O> {
  return {
    async run(input, options) {
      return pipeline.run(input, {
        metadata: options?.metadata,
        signal: options?.signal,
        idempotencyKey: options?.idempotencyKey,
        parentTraceContext: options?.parentTraceContext,
      });
    },

    describe(): PipelineDefinitionEnriched {
      const def = pipeline.describe();
      return {
        id: opts.id,
        trigger: opts.trigger,
        retry: opts.retry,
        concurrency: opts.concurrency,
        tags: opts.tags,
        version: opts.version,
        steps: def.steps.map(stepToDescriptor),
      };
    },
  };
}

function stepToDescriptor(step: PipelineStep): StepDescriptor {
  switch (step.kind) {
    case 'source':
      return { kind: 'source', name: step.source.id, adapterType: undefined };
    case 'process':
      return { kind: 'process', name: step.process.id, adapterType: undefined };
    case 'store':
      return { kind: 'store', name: step.store.id, adapterType: undefined };
    case 'review':
      return { kind: 'review', name: step.reviewable.id, adapterType: undefined };
    case 'serve':
      return { kind: 'serve', name: step.serve.id, adapterType: undefined };
  }
}
