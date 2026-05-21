import type { CostBudget } from '../budget.js';
import { evaluateBudgets } from '../budget.js';
import type { PipelineContext } from '../context.js';
import type { RunError } from '../errors/run.js';
import { createRetryBudget, type RetryBudget } from './retry.js';

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
