import type { BudgetCeiling, CostBudget } from '../budget.js';
import {
  createContext,
  deriveAtomCtx,
  type PipelineContext,
  type TraceContext,
} from '../context.js';
import type { DisposableRegistry } from '../disposable.js';
import type { RunError } from '../errors/run.js';
import type { PiiAnnotation } from '../pii.js';
import type { RetryPolicy } from '../policy.js';
import { err, ok, type Result } from '../result.js';
import type { Atom } from '../stages/atom.js';
import type { Source, SourceQuery } from '../stages/source.js';
import {
  applyBudgetCeiling,
  applyBudgets,
  makeBudget,
  type StageCause,
  sourceIterError,
  toRunError,
} from './apply-budget-ceiling.js';
import { cancelledResult, isCancelled } from './cancellation.js';
import { generateIdempotencyKey, scopedIdempotencyKey } from './idempotency.js';
import { PII_ANNOTATIONS_ATTR, type StageName, withSpan } from './otel.js';
import type { TokenBucket } from './rate-limit.js';
import { DEFAULT_RETRY_POLICY, mergeRetryPolicy, type RetryBudget, withRetry } from './retry.js';

export interface ComposerStep {
  id: string;
  kind: StageName;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucket;
  /** PII annotations precomputed from outputSchema at build time. */
  piiAnnotations?: PiiAnnotation[];
  /**
   * Cost event recorded after this step completed. Populated by adapters that
   * can report token/dollar usage (e.g. LLM adapters). Steps without cost data
   * simply omit this field; they contribute 0 to cumulative totals.
   *
   * Inline structural type — avoids making `@idriszade/core` depend on
   * `@idriszade/cost`. The shape mirrors `CostEvent` from that package.
   */
  costEvent?: {
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
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
  /**
   * Declares 4-axis ceilings on cumulative spend. Evaluated between every
   * stage transition by recomputing `BudgetAccumulation` from `run.steps[]`
   * (pure reducer — Inngest replay-safe; no mutable context field).
   *
   * On `warn`: emits a `budget.warn` OTel span event (passive; does not halt).
   * On `exceeded`: halts immediately with `runtime_budget_exceeded` (non-retriable).
   *
   * **Retry compound-spend note:** retries compound spend. A 3-step pipeline
   * failing at step 2 re-runs steps 0 and 1; their `costEvent` data
   * reappears in `run.steps[]`. At 20% per-step failure rate, cumulative
   * spend is ~2.2–2.5× the single-pass baseline. Size `maxDollars`
   * accordingly.
   */
  budgetCeiling?: BudgetCeiling;
  buffer?: { window: { type: 'count' | 'time' | 'all'; n?: number } };
  parentTraceContext?: TraceContext;
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
    trace: opts.parentTraceContext,
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
      for (const [si, step] of opts.steps.entries()) {
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

        const ceilingErr = applyBudgetCeiling(
          opts.budgetCeiling,
          opts.steps.slice(0, si + 1),
          ctx.runId,
        );
        if (ceilingErr !== null) {
          result = err(ceilingErr);
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
      for (const [si, step] of opts.steps.entries()) {
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

        const ceilingErr = applyBudgetCeiling(
          opts.budgetCeiling,
          opts.steps.slice(0, si + 1),
          ctx.runId,
        );
        if (ceilingErr !== null) {
          result = err(ceilingErr);
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
    for (const [si, step] of opts.steps.entries()) {
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

      const ceilingErr = applyBudgetCeiling(
        opts.budgetCeiling,
        opts.steps.slice(0, si + 1),
        ctx.runId,
      );
      if (ceilingErr !== null) {
        result = err(ceilingErr);
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
    ...(step.piiAnnotations !== undefined
      ? { [PII_ANNOTATIONS_ATTR]: JSON.stringify(step.piiAnnotations) }
      : {}),
  };
  return withSpan(step.kind, spanAttrs, ctx.trace, () =>
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
