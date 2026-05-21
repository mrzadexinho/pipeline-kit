import { trace } from '@opentelemetry/api';
import { type BudgetCeiling, evaluateBudgetCeiling } from '../budget.js';
import type { RunError } from '../errors/run.js';
import { recomputeAccumulation } from './budget-accumulate.js';
import type { ComposerStep } from './composer.js';

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
