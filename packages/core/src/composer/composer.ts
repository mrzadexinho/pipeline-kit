import { createContext, deriveAtomCtx, type PipelineContext } from '../context.js';
import type { ProcessError } from '../errors/process.js';
import type { RunError } from '../errors/run.js';
import type { ServeError } from '../errors/serve.js';
import type { SourceError } from '../errors/source.js';
import type { StoreError } from '../errors/store.js';
import type { RetryPolicy } from '../policy.js';
import { err, ok, type Result } from '../result.js';
import type { Atom } from '../stages/atom.js';
import type { Source, SourceQuery } from '../stages/source.js';
import { cancelledResult, isCancelled } from './cancellation.js';
import { generateIdempotencyKey, scopedIdempotencyKey } from './idempotency.js';
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

type StageCause = { type: string; code: string; message: string; retry_after_ms?: number };
type AtomMeta = { atom_id: string; atoms_attempted: number; atoms_completed: number };

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
    return runFanOut({ ...opts, source: opts.source }, ctx, startTime, globalPolicy);
  }

  return runSequential(opts, ctx, startTime, globalPolicy);
}

async function runFanOut(
  opts: ComposerOpts & { source: NonNullable<ComposerOpts['source']> },
  ctx: PipelineContext,
  startTime: number,
  globalPolicy: RetryPolicy,
): Promise<Result<ComposerResult, RunError>> {
  const { adapter: sourceAdapter, query: sourceQuery } = opts.source;
  const budget = makeBudget(opts.globalRetryBudget, opts.steps.length, globalPolicy.maxAttempts);

  let atomCount = 0;
  let lastOutput: unknown;

  let iter: AsyncIterable<Atom<unknown>>;
  try {
    iter = sourceAdapter.iter(sourceQuery, ctx);
  } catch (e) {
    return err(sourceIterError(e, ctx.runId));
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
        const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget, atom.id);

        if (stageOutcome.error !== null) {
          return err(
            toRunError(step, stageOutcome.error, ctx, {
              atom_id: atom.id,
              atoms_attempted: atomCount + 1,
              atoms_completed: atomCount,
            }),
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
    return err(sourceIterError(e, ctx.runId));
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
  atomId?: string,
): Promise<Result<unknown, StageCause>> {
  const spanAttrs = {
    runId: ctx.runId,
    pipelineId: ctx.pipelineId,
    stageId: step.id,
    ...(atomId !== undefined ? { atomId } : {}),
  };
  return withSpan(step.kind, spanAttrs, () =>
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
        const effectiveCtx =
          atomId !== undefined && step.kind === 'serve'
            ? deriveAtomCtx(
                ctx,
                scopedIdempotencyKey({ runId: ctx.runId, serveAdapterId: step.id, atomId }),
              )
            : ctx;
        return step.run(input, effectiveCtx);
      },
      { policy, signal: ctx.signal, globalBudget: budget },
    ),
  );
}

function sourceIterError(e: unknown, requestId: string): RunError {
  const message = e instanceof Error ? e.message : String(e);
  return {
    type: 'source_failed',
    code: 'source_iter_failed',
    message,
    request_id: requestId,
    cause: { type: 'unknown', code: 'source_iter_failed', message } as SourceError,
  };
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
  cause: StageCause,
  ctx: PipelineContext,
  atomMeta?: AtomMeta,
): RunError {
  const metadata = atomMeta
    ? {
        atom_id: atomMeta.atom_id,
        atoms_attempted: atomMeta.atoms_attempted,
        atoms_completed: atomMeta.atoms_completed,
      }
    : undefined;

  if (cause.type === 'cancelled') {
    return {
      type: 'cancelled',
      code: 'pipeline_cancelled',
      message: cause.message,
      request_id: ctx.runId,
      ...(metadata ? { metadata } : {}),
    };
  }
  const base = {
    code: `${step.kind}_failed`,
    message: cause.message,
    request_id: ctx.runId,
    ...(metadata ? { metadata } : {}),
  };
  switch (step.kind) {
    case 'source':
      return { type: 'source_failed', ...base, cause: cause as SourceError };
    case 'process':
    case 'review':
      return { type: 'process_failed', ...base, cause: cause as ProcessError };
    case 'serve':
      return { type: 'serve_failed', ...base, cause: cause as ServeError };
    case 'store':
      return { type: 'store_failed', ...base, cause: cause as StoreError };
    default:
      return { type: 'unknown', code: 'composer_unknown_stage', message: cause.message };
  }
}
