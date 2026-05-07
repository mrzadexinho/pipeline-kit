import { createContext, type PipelineContext } from '../context.js';
import type { RunError } from '../errors/run.js';
import type { RetryPolicy } from '../policy.js';
import { err, ok, type Result } from '../result.js';
import type { Atom } from '../stages/atom.js';
import type { Source, SourceQuery } from '../stages/source.js';
import { cancelledResult, isCancelled } from './cancellation.js';
import { generateIdempotencyKey } from './idempotency.js';
import { type StageName, withSpan } from './otel.js';
import type { TokenBucket } from './rate-limit.js';
import {
  createRetryBudget,
  DEFAULT_RETRY_POLICY,
  mergeRetryPolicy,
  type RetryBudget,
  withRetry,
} from './retry.js';

export interface ComposerStep {
  id: string;
  kind: StageName;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucket;
  run: (
    input: unknown,
    ctx: PipelineContext,
  ) => Promise<
    Result<unknown, { type: string; code: string; message: string; retry_after_ms?: number }>
  >;
}

export interface ComposerOpts {
  pipelineId: string;
  steps: ReadonlyArray<ComposerStep>;
  initialInput?: unknown;
  globalRetryPolicy?: Partial<RetryPolicy>;
  globalRetryBudget?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  source?: {
    adapter: Source<unknown>;
    query: SourceQuery;
  };
}

export interface ComposerResult {
  runId: string;
  pipelineId: string;
  output: unknown;
  atomCount: number;
  duration: number;
  metadata: Record<string, unknown>;
  ctx: PipelineContext;
}

export async function runComposer(opts: ComposerOpts): Promise<Result<ComposerResult, RunError>> {
  const ctx = createContext({
    pipelineId: opts.pipelineId,
    metadata: opts.metadata,
    signal: opts.signal,
    idempotencyKey: opts.idempotencyKey ?? generateIdempotencyKey(),
  });

  const startTime = Date.now();
  const globalPolicy = mergeRetryPolicy(DEFAULT_RETRY_POLICY, opts.globalRetryPolicy);

  if (opts.source !== undefined) {
    return runFanOut(opts, ctx, startTime, globalPolicy);
  }

  return runSequential(opts, ctx, startTime, globalPolicy);
}

async function runFanOut(
  opts: ComposerOpts,
  ctx: PipelineContext,
  startTime: number,
  globalPolicy: RetryPolicy,
): Promise<Result<ComposerResult, RunError>> {
  // opts.source is guaranteed present when runFanOut is called (checked in runComposer)
  const { adapter: sourceAdapter, query: sourceQuery } = opts.source as NonNullable<
    typeof opts.source
  >;
  const budget = makeBudget(opts.globalRetryBudget, opts.steps.length, globalPolicy.maxAttempts);

  let atomCount = 0;
  let lastOutput: unknown;

  let iter: AsyncIterable<Atom<unknown>>;
  try {
    iter = sourceAdapter.iter(sourceQuery, ctx);
  } catch (e) {
    return err({
      type: 'source_failed',
      code: 'source_iter_failed',
      message: e instanceof Error ? e.message : String(e),
      request_id: ctx.runId,
      cause: { type: 'unknown', code: 'source_iter_failed', message: String(e) },
    });
  }

  try {
    for await (const atom of iter) {
      if (isCancelled(ctx.signal)) {
        return cancelledResult();
      }

      let currentInput: unknown = atom.data;
      for (const step of opts.steps) {
        if (isCancelled(ctx.signal)) {
          return cancelledResult();
        }

        const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
        const stageOutcome = await runStageWithAtom(
          step,
          currentInput,
          ctx,
          stagePolicy,
          budget,
          atom.id,
        );

        if (stageOutcome.error !== null) {
          return err(
            toRunErrorWithAtomMeta(
              step,
              stageOutcome.error,
              ctx,
              atom.id,
              atomCount + 1,
              atomCount,
            ),
          );
        }
        if (isCancelled(ctx.signal)) {
          return cancelledResult();
        }
        currentInput = stageOutcome.data;
      }

      lastOutput = currentInput;
      atomCount++;
    }
  } catch (e) {
    return err({
      type: 'source_failed',
      code: 'source_iter_failed',
      message: e instanceof Error ? e.message : String(e),
      request_id: ctx.runId,
      cause: { type: 'unknown', code: 'source_iter_failed', message: String(e) },
    });
  }

  if (atomCount === 0) {
    return err({
      type: 'source_failed',
      code: 'source_no_atoms',
      message: 'Source produced no atoms',
      request_id: ctx.runId,
      cause: { type: 'unavailable', code: 'source_no_atoms', message: 'Source produced no atoms' },
    });
  }

  return ok({
    runId: ctx.runId,
    pipelineId: ctx.pipelineId,
    output: lastOutput,
    atomCount,
    duration: Date.now() - startTime,
    metadata: { ...ctx.metadata },
    ctx,
  });
}

async function runSequential(
  opts: ComposerOpts,
  ctx: PipelineContext,
  startTime: number,
  globalPolicy: RetryPolicy,
): Promise<Result<ComposerResult, RunError>> {
  const budget = makeBudget(opts.globalRetryBudget, opts.steps.length, globalPolicy.maxAttempts);

  let currentInput: unknown = opts.initialInput;
  let stagesCompleted = 0;

  for (const step of opts.steps) {
    if (isCancelled(ctx.signal)) {
      return cancelledResult();
    }

    const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
    const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget);

    if (stageOutcome.error !== null) {
      return err(toRunError(step, stageOutcome.error, ctx));
    }
    if (isCancelled(ctx.signal)) {
      return cancelledResult();
    }
    currentInput = stageOutcome.data;
    stagesCompleted++;
  }

  return ok({
    runId: ctx.runId,
    pipelineId: ctx.pipelineId,
    output: currentInput,
    atomCount: stagesCompleted,
    duration: Date.now() - startTime,
    metadata: { ...ctx.metadata },
    ctx,
  });
}

async function runStage(
  step: ComposerStep,
  input: unknown,
  ctx: PipelineContext,
  policy: RetryPolicy,
  budget: RetryBudget,
): Promise<
  Result<unknown, { type: string; code: string; message: string; retry_after_ms?: number }>
> {
  return withSpan(
    step.kind,
    { runId: ctx.runId, pipelineId: ctx.pipelineId, stageId: step.id },
    () =>
      withRetry(
        async (_attempt) => {
          if (isCancelled(ctx.signal)) {
            return err({ type: 'cancelled', code: 'cancelled', message: 'aborted' });
          }
          if (step.rateLimit) {
            const acquired = await step.rateLimit.acquire(1, ctx.signal);
            if (!acquired) {
              return err({ type: 'cancelled', code: 'rate_limit_aborted', message: 'aborted' });
            }
          }
          return step.run(input, ctx);
        },
        { policy, signal: ctx.signal, globalBudget: budget },
      ),
  );
}

async function runStageWithAtom(
  step: ComposerStep,
  input: unknown,
  ctx: PipelineContext,
  policy: RetryPolicy,
  budget: RetryBudget,
  atomId: string,
): Promise<
  Result<unknown, { type: string; code: string; message: string; retry_after_ms?: number }>
> {
  return withSpan(
    step.kind,
    { runId: ctx.runId, pipelineId: ctx.pipelineId, stageId: step.id, atomId },
    () =>
      withRetry(
        async (_attempt) => {
          if (isCancelled(ctx.signal)) {
            return err({ type: 'cancelled', code: 'cancelled', message: 'aborted' });
          }
          if (step.rateLimit) {
            const acquired = await step.rateLimit.acquire(1, ctx.signal);
            if (!acquired) {
              return err({ type: 'cancelled', code: 'rate_limit_aborted', message: 'aborted' });
            }
          }
          return step.run(input, ctx);
        },
        { policy, signal: ctx.signal, globalBudget: budget },
      ),
  );
}

function makeBudget(
  explicit: number | undefined,
  stepCount: number,
  perStageMaxAttempts: number,
): RetryBudget {
  const cap = explicit ?? Math.max(stepCount * perStageMaxAttempts, perStageMaxAttempts);
  return createRetryBudget(cap);
}

function toRunError(
  step: ComposerStep,
  cause: { type: string; code: string; message: string },
  ctx: PipelineContext,
): RunError {
  if (cause.type === 'cancelled') {
    return {
      type: 'cancelled',
      code: 'pipeline_cancelled',
      message: cause.message,
      request_id: ctx.runId,
    };
  }
  const baseFields = {
    code: `${step.kind}_failed`,
    message: cause.message,
    request_id: ctx.runId,
  };
  switch (step.kind) {
    case 'source':
      return { type: 'source_failed', ...baseFields, cause: cause as never };
    case 'process':
    case 'review':
      return { type: 'process_failed', ...baseFields, cause: cause as never };
    case 'serve':
      return { type: 'serve_failed', ...baseFields, cause: cause as never };
    case 'store':
      return { type: 'store_failed', ...baseFields, cause: cause as never };
    default:
      return { type: 'unknown', code: 'composer_unknown_stage', message: cause.message };
  }
}

function toRunErrorWithAtomMeta(
  step: ComposerStep,
  cause: { type: string; code: string; message: string },
  ctx: PipelineContext,
  atomId: string,
  atomsAttempted: number,
  atomsCompleted: number,
): RunError {
  if (cause.type === 'cancelled') {
    return {
      type: 'cancelled',
      code: 'pipeline_cancelled',
      message: cause.message,
      request_id: ctx.runId,
      metadata: {
        atom_id: atomId,
        atoms_attempted: atomsAttempted,
        atoms_completed: atomsCompleted,
      },
    };
  }
  const baseFields = {
    code: `${step.kind}_failed`,
    message: cause.message,
    request_id: ctx.runId,
    metadata: { atom_id: atomId, atoms_attempted: atomsAttempted, atoms_completed: atomsCompleted },
  };
  switch (step.kind) {
    case 'source':
      return { type: 'source_failed', ...baseFields, cause: cause as never };
    case 'process':
    case 'review':
      return { type: 'process_failed', ...baseFields, cause: cause as never };
    case 'serve':
      return { type: 'serve_failed', ...baseFields, cause: cause as never };
    case 'store':
      return { type: 'store_failed', ...baseFields, cause: cause as never };
    default:
      return {
        type: 'unknown',
        code: 'composer_unknown_stage',
        message: cause.message,
        metadata: {
          atom_id: atomId,
          atoms_attempted: atomsAttempted,
          atoms_completed: atomsCompleted,
        },
      };
  }
}
