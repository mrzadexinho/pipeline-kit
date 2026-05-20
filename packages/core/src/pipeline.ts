import { type ComposerStep, runComposer } from './composer/composer.js';
import { precomputeStepPiiAnnotations } from './composer/pii-attach.js';
import { createTokenBucket } from './composer/rate-limit.js';
import type { RunError } from './errors/run.js';
import { atom, pipe } from './ids.js';
import type {
  PipelineDefinition,
  PipelineStep,
  RunOptions,
  RunResult,
  SourcePipeline,
  TerminalPipeline,
} from './pipeline-types.js';
import { err, ok, type Result } from './result.js';
import type { Reviewable } from './reviewable.js';
import { reviewableToProcess } from './reviewable-to-process.js';
import type { Atom } from './stages/atom.js';
import type { Process } from './stages/process.js';
import type { Serve } from './stages/serve.js';
import type { Source } from './stages/source.js';
import type { Store } from './stages/store.js';

export const Pipeline = {
  from<O>(source: Source<O>): SourcePipeline<O> {
    return makeSourcePipeline<O>({
      pipelineId: pipe(),
      steps: [{ kind: 'source', source: source as Source<unknown> }],
    });
  },
};

function makeSourcePipeline<O>(definition: PipelineDefinition): SourcePipeline<O> {
  return {
    through<Out>(process: Process<O, Out>): SourcePipeline<Out> {
      return makeSourcePipeline<Out>({
        pipelineId: definition.pipelineId,
        steps: [
          ...definition.steps,
          { kind: 'process', process: process as Process<unknown, unknown> },
        ],
      });
    },
    store(store: Store<O>): SourcePipeline<O> {
      return makeSourcePipeline<O>({
        pipelineId: definition.pipelineId,
        steps: [...definition.steps, { kind: 'store', store: store as Store<unknown> }],
      });
    },
    review(reviewable: Reviewable<O>): SourcePipeline<O> {
      const wrapped = reviewableToProcess(reviewable);
      return makeSourcePipeline<O>({
        pipelineId: definition.pipelineId,
        steps: [
          ...definition.steps,
          { kind: 'process', process: wrapped as Process<unknown, unknown> },
        ],
      });
    },
    to(serve: Serve<O>): TerminalPipeline<O> {
      return makeTerminalPipeline<O>({
        pipelineId: definition.pipelineId,
        steps: [...definition.steps, { kind: 'serve', serve: serve as Serve<unknown> }],
      });
    },
    describe(): PipelineDefinition {
      return definition;
    },
  };
}

function makeTerminalPipeline<O>(definition: PipelineDefinition): TerminalPipeline<O> {
  return {
    async run(input?: unknown, options?: RunOptions): Promise<Result<RunResult<O>, RunError>> {
      const sourceStep = definition.steps[0];
      if (sourceStep === undefined || sourceStep.kind !== 'source') {
        return err({
          type: 'unknown',
          code: 'no_source_step',
          message: 'Pipeline has no source step',
        });
      }

      const downstreamSteps = definition.steps.slice(1).map(toComposerStep);

      const result = await runComposer({
        pipelineId: definition.pipelineId,
        steps: downstreamSteps,
        source: {
          adapter: sourceStep.source,
          query: input as Record<string, unknown> | undefined,
        },
        signal: options?.signal,
        metadata: options?.metadata,
        idempotencyKey: options?.idempotencyKey,
        costBudget: options?.costBudget,
        parentTraceContext: options?.parentTraceContext,
      });

      if (result.error !== null) {
        return err(result.error);
      }
      return ok({
        runId: result.data.runId,
        pipelineId: result.data.pipelineId,
        output: result.data.output as O,
        atomCount: result.data.atomCount,
        duration: result.data.duration,
        metadata: result.data.metadata,
      });
    },
    describe(): PipelineDefinition {
      return definition;
    },
  };
}

function toComposerStep(step: PipelineStep): ComposerStep {
  switch (step.kind) {
    case 'source':
      throw new Error('Source step must not be passed to toComposerStep');
    case 'process':
      return makeProcessComposerStep(step.process);
    case 'store':
      return makeStoreComposerStep(step.store);
    case 'review':
      return makeProcessComposerStep(reviewableToProcess(step.reviewable));
    case 'serve':
      return makeServeComposerStep(step.serve);
  }
}

function makeProcessComposerStep(process: Process<unknown, unknown>): ComposerStep {
  const piiAnnotations = precomputeStepPiiAnnotations(process.outputSchema);
  return {
    id: process.id,
    kind: 'process',
    retryPolicy: process.retryPolicy,
    ...(piiAnnotations !== undefined ? { piiAnnotations } : {}),
    run(input, ctx) {
      return process.run(input, ctx);
    },
  };
}

function makeServeComposerStep(serve: Serve<unknown>): ComposerStep {
  const bucket = serve.rateLimit ? createTokenBucket(serve.rateLimit) : undefined;
  return {
    id: serve.id,
    kind: 'serve',
    retryPolicy: serve.retryPolicy,
    rateLimit: bucket,
    async run(input, ctx) {
      const result = await serve.emit(input, ctx);
      if (result.error !== null) return result;
      return ok(input);
    },
  };
}

function makeStoreComposerStep(store: Store<unknown>): ComposerStep {
  return {
    id: store.id,
    kind: 'store',
    async run(input, ctx) {
      const wrapped: Atom<unknown> = {
        id: atom(),
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: {},
        data: input,
        run_id: ctx.runId,
        stage_id: store.id,
      };
      const result = await store.put(wrapped, ctx);
      if (result.error !== null) return result;
      return ok(input);
    },
  };
}
