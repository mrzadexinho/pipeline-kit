import { trace } from '@opentelemetry/api';
import {
  type BudgetCeiling,
  type CostBudget,
  evaluateBudgetCeiling,
  evaluateBudgets,
} from '../budget.js';
import type { PipelineContext } from '../context.js';
import type { ProcessError } from '../errors/process.js';
import type { RunError } from '../errors/run.js';
import type { ServeError } from '../errors/serve.js';
import type { SourceError } from '../errors/source.js';
import type { StoreError } from '../errors/store.js';
import { recomputeAccumulation } from './budget-accumulate.js';
import type { ComposerStep } from './composer.js';
import { createRetryBudget, type RetryBudget } from './retry.js';

// ---------------------------------------------------------------------------
// Internal shared types (private to the composer module)
// ---------------------------------------------------------------------------

export type StageCause = { type: string; code: string; message: string; retry_after_ms?: number };
export type AtomMeta = {
  atom_id: string;
  atoms_attempted: number;
  atoms_completed: number;
};

// ---------------------------------------------------------------------------
// Budget ceiling (Unit 4 — 4-axis cumulative spend guard)
// ---------------------------------------------------------------------------

/**
 * Evaluates a `BudgetCeiling` against the cumulative spend recorded in the
 * provided step slice. Returns a `RunError` if the ceiling is exceeded, `null`
 * otherwise (including on warn — warn only emits an OTel span event).
 *
 * This is a pure function: it derives `BudgetAccumulation` freshly via
 * `recomputeAccumulation`, ensuring Inngest replay safety.
 */
export function applyBudgetCeiling(
  ceiling: BudgetCeiling | undefined,
  steps: readonly ComposerStep[],
  requestId: string,
): RunError | null {
  if (ceiling === undefined) return null;
  const acc = recomputeAccumulation(steps);
  const verdict = evaluateBudgetCeiling(acc, ceiling);
  if (verdict.status === 'ok') return null;
  if (verdict.status === 'warn') {
    // Emit on active span if one exists (best-effort: ceiling check runs
    // between stage spans, so getActiveSpan() may return undefined).
    const span = trace.getActiveSpan();
    span?.addEvent('budget.warn', {
      'budget.fraction': verdict.fraction,
      'budget.axis': verdict.axis,
    });
    return null;
  }
  // exceeded
  return {
    type: 'unknown',
    code: 'runtime_budget_exceeded',
    message: `Budget ceiling exceeded on axis '${verdict.axis}': ${verdict.current} >= ${verdict.limit}`,
    request_id: requestId,
    metadata: {
      budget_axis: verdict.axis,
      budget_current: verdict.current,
      budget_limit: verdict.limit,
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy CostBudget guard (pre-Unit-4 per-metric budget)
// ---------------------------------------------------------------------------

export function applyBudgets(
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

// ---------------------------------------------------------------------------
// Retry budget factory
// ---------------------------------------------------------------------------

export function makeBudget(
  explicit: number | undefined,
  stepCount: number,
  perStageMaxAttempts: number,
): RetryBudget {
  const cap = explicit ?? Math.max(stepCount * perStageMaxAttempts, perStageMaxAttempts);
  return createRetryBudget(cap);
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function sourceIterError(e: unknown, requestId: string): RunError {
  const message = e instanceof Error ? e.message : String(e);
  return {
    type: 'source_failed',
    code: 'source_iter_failed',
    message,
    request_id: requestId,
    cause: { type: 'unknown', code: 'source_iter_failed', message } as SourceError,
  };
}

export function toRunError(
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
