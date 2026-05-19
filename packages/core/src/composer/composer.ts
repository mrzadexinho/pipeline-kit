import { type CostBudget, evaluateBudgets } from '../budget.js';
import { createContext, deriveAtomCtx, type PipelineContext } from '../context.js';
import type { DisposableRegistry } from '../disposable.js';
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
  registry?: DisposableRegistry;
  costBudget?: CostBudget[];
  buffer?: { window: { type: 'count' | 'time' | 'all'; n?: number } };
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
  if (opts.buffer !== undefined) {
    const bufType = opts.buffer.window.type;
    if (bufType === 'count' || bufType === 'time') {
      return err({
        type: 'unknown',
        code: 'buffer_not_implemented',
        message: `Buffer window type '${bufType}' is deferred to M2`,
      });
    }
  }

  const { adapter: sourceAdapter, query: sourceQuery } = opts.source;
  const budget = makeBudget(opts.globalRetryBudget, opts.steps.length, globalPolicy.maxAttempts);

  let atomCount = 0;
  let lastOutput: unknown;

  let iter: AsyncIterable<Atom<unknown>>;
  try {
    iter = sourceAdapter.iter(sourceQuery, ctx);
  } catch (e) {
    await opts.registry?.disposeAll();
    return err(sourceIterError(e, ctx.runId));
  }

  let result: Result<ComposerResult, RunError> | undefined;

  try {
    if (opts.buffer?.window.type === 'all') {
      // Collect all atoms before running steps
      const collected: unknown[] = [];
      try {
        for await (const atom of iter) {
          collected.push(atom.data);
        }
      } catch (e) {
        result = err(sourceIterError(e, ctx.runId));
        return result;
      }

      if (collected.length === 0) {
        result = err({
          type: 'source_failed',
          code: 'source_no_atoms',
          message: 'Source produced no atoms',
          request_id: ctx.runId,
          cause: {
            type: 'unavailable',
            code: 'source_no_atoms',
            message: 'Source produced no atoms',
          },
        });
        return result;
      }

      if (isCancelled(ctx.signal)) {
        result = cancelledResult();
        return result;
      }

      let currentInput: unknown = collected;
      for (const step of opts.steps) {
        if (isCancelled(ctx.signal)) {
          result = cancelledResult();
          return result;
        }

        const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
        const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget);

        if (stageOutcome.error !== null) {
          result = err(toRunError(step, stageOutcome.error, ctx));
          return result;
        }
        if (isCancelled(ctx.signal)) {
          result = cancelledResult();
          return result;
        }
        currentInput = stageOutcome.data;

        const budgetErr = applyBudgets(opts.costBudget, ctx, ctx.runId);
        if (budgetErr !== null) {
          result = err(budgetErr);
          return result;
        }
      }

      result = ok({
        runId: ctx.runId,
        pipelineId: ctx.pipelineId,
        output: currentInput,
        atomCount: collected.length,
        duration: Date.now() - startTime,
        metadata: { ...ctx.metadata },
        ctx,
      });
      return result;
    }

    for await (const atom of iter) {
      if (isCancelled(ctx.signal)) {
        result = cancelledResult();
        return result;
      }

      let currentInput: unknown = atom.data;
      for (const step of opts.steps) {
        if (isCancelled(ctx.signal)) {
          result = cancelledResult();
          return result;
        }

        const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
        const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget, atom.id);

        if (stageOutcome.error !== null) {
          result = err(
            toRunError(step, stageOutcome.error, ctx, {
              atom_id: atom.id,
              atoms_attempted: atomCount + 1,
              atoms_completed: atomCount,
            }),
          );
          return result;
        }
        if (isCancelled(ctx.signal)) {
          result = cancelledResult();
          return result;
        }
        currentInput = stageOutcome.data;

        const budgetErr = applyBudgets(opts.costBudget, ctx, ctx.runId);
        if (budgetErr !== null) {
          result = err(budgetErr);
          return result;
        }
      }

      lastOutput = currentInput;
      atomCount++;
    }
  } catch (e) {
    result = err(sourceIterError(e, ctx.runId));
    return result;
  } finally {
    await opts.registry?.disposeAll();
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
  let result: Result<ComposerResult, RunError> | undefined;

  try {
    for (const step of opts.steps) {
      if (isCancelled(ctx.signal)) {
        result = cancelledResult();
        return result;
      }

      const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
      const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget);

      if (stageOutcome.error !== null) {
        result = err(toRunError(step, stageOutcome.error, ctx));
        return result;
      }
      if (isCancelled(ctx.signal)) {
        result = cancelledResult();
        return result;
      }
      currentInput = stageOutcome.data;
      stagesCompleted++;

      const budgetErr = applyBudgets(opts.costBudget, ctx, ctx.runId);
      if (budgetErr !== null) {
        result = err(budgetErr);
        return result;
      }
    }

    result = ok({
      runId: ctx.runId,
      pipelineId: ctx.pipelineId,
      output: currentInput,
      atomCount: stagesCompleted,
      duration: Date.now() - startTime,
      metadata: { ...ctx.metadata },
      ctx,
    });
    return result;
  } finally {
    await opts.registry?.disposeAll();
  }
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

function applyBudgets(
  budgets: CostBudget[] | undefined,
  ctx: PipelineContext,
  requestId: string,
): RunError | null {
  const verdict = evaluateBudgets(ctx.usage, budgets);
  if (verdict.action === 'ok') return null;
  const { budget: b, current } = verdict;
  if (verdict.action === 'warn') {
    console.warn(`[pipeline-kit] budget warning: ${b.metric} usage ${current} >= limit ${b.limit}`);
    return null;
  }
  if (verdict.action === 'abort') {
    return {
      type: 'unknown',
      code: 'runtime_budget_exceeded',
      message: `Budget exceeded for ${b.metric}: ${current} >= ${b.limit}`,
      request_id: requestId,
      metadata: { usage: Object.fromEntries(ctx.usage.getAll()) },
    };
  }
  // 'review'
  const reviewMsg = `Budget review required for ${b.metric}: ${current} >= ${b.limit}`;
  return {
    type: 'review_failed',
    code: 'runtime_budget_exceeded_review_required',
    message: reviewMsg,
    request_id: requestId,
    cause: {
      type: 'unknown',
      code: 'budget_review_required',
      message: reviewMsg,
    } as { type: 'unknown'; code: string; message: string },
  };
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
