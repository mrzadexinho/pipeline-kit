export type { CostBudget } from './usage.js';

import type { CostBudget, UsageAccumulator } from './usage.js';

export type BudgetVerdict =
  | { action: 'ok' }
  | { action: 'abort' | 'review' | 'warn'; budget: CostBudget; current: number };

export function evaluateBudgets(
  usage: UsageAccumulator,
  budgets: CostBudget[] | undefined,
): BudgetVerdict {
  if (budgets === undefined || budgets.length === 0) return { action: 'ok' };
  for (const b of budgets) {
    const current = usage.get(b.metric);
    if (current >= b.limit) {
      return { action: b.action, budget: b, current };
    }
  }
  return { action: 'ok' };
}

// ---------------------------------------------------------------------------
// BudgetCeiling — cumulative spend tracking across all Composer stage transitions
// ---------------------------------------------------------------------------

/**
 * Declares 4-axis ceilings on cumulative spend across a Composer run.
 *
 * All axes are optional; only configured axes are evaluated.
 *
 * **Retry compound-spend note:** Retries compound cumulative spend. A
 * 3-atom pipeline failing at atom 2 re-runs atoms 0 and 1, and their costs
 * reappear in `run.steps[]`. At a 20% per-step failure rate, cumulative spend
 * is approximately 2.2–2.5× the single-pass baseline. Size `maxDollars`
 * accordingly.
 */
export interface BudgetCeiling {
  /** Maximum total cost in USD across all steps in the run. */
  maxDollars?: number;
  /** Maximum total input tokens consumed across all steps. */
  maxInputTokens?: number;
  /** Maximum total output tokens produced across all steps. */
  maxOutputTokens?: number;
  /** Maximum number of stage steps executed (including retried steps). */
  maxRequests?: number;
  /**
   * Emit a `budget.warn` OTel span event when any axis reaches this fraction
   * of its limit. Defaults to `0.80`.
   */
  warnAtFraction?: number;
}

/** Snapshot of cumulative spend accumulated from `run.steps[]`. */
export interface BudgetAccumulation {
  totalDollars: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
}

export type BudgetCeilingVerdict =
  | { status: 'ok' }
  | { status: 'warn'; fraction: number; axis: keyof Omit<BudgetCeiling, 'warnAtFraction'> }
  | {
      status: 'exceeded';
      axis: keyof Omit<BudgetCeiling, 'warnAtFraction'>;
      current: number;
      limit: number;
    };

type CeilingAxis = keyof Omit<BudgetCeiling, 'warnAtFraction'>;

const AXIS_ORDER: CeilingAxis[] = [
  'maxDollars',
  'maxInputTokens',
  'maxOutputTokens',
  'maxRequests',
];

function accumulationValue(acc: BudgetAccumulation, axis: CeilingAxis): number {
  switch (axis) {
    case 'maxDollars':
      return acc.totalDollars;
    case 'maxInputTokens':
      return acc.totalInputTokens;
    case 'maxOutputTokens':
      return acc.totalOutputTokens;
    case 'maxRequests':
      return acc.totalRequests;
  }
}

/**
 * Evaluates a `BudgetCeiling` against a `BudgetAccumulation`.
 *
 * Evaluation order (BINDING):
 * 1. Check all axes for `exceeded` (current >= limit). Returns the first
 *    exceeded axis.
 * 2. If no axis is exceeded, check all axes for `warn` (fraction >=
 *    warnAtFraction). Returns the highest-fraction axis.
 * 3. Otherwise returns `{ status: 'ok' }`.
 *
 * The `exceeded => warn` invariant holds: whenever any axis is exceeded, its
 * fraction is also >= warnAtFraction (since limit > 0 implies
 * current/limit >= 1 >= 0.80).
 */
export function evaluateBudgetCeiling(
  acc: BudgetAccumulation,
  ceiling: BudgetCeiling,
): BudgetCeilingVerdict {
  const warnAt = ceiling.warnAtFraction ?? 0.8;

  // Pass 1: exceeded checks across all axes in declaration order.
  for (const axis of AXIS_ORDER) {
    const limit = ceiling[axis];
    if (limit === undefined) continue;
    const current = accumulationValue(acc, axis);
    if (current >= limit) {
      return { status: 'exceeded', axis, current, limit };
    }
  }

  // Pass 2: warn check — find highest-fraction axis that meets the threshold.
  let bestFraction = -1;
  let bestAxis: CeilingAxis | undefined;
  for (const axis of AXIS_ORDER) {
    const limit = ceiling[axis];
    if (limit === undefined || limit === 0) continue;
    const current = accumulationValue(acc, axis);
    const fraction = current / limit;
    if (fraction >= warnAt && fraction > bestFraction) {
      bestFraction = fraction;
      bestAxis = axis;
    }
  }
  if (bestAxis !== undefined) {
    return { status: 'warn', fraction: bestFraction, axis: bestAxis };
  }

  return { status: 'ok' };
}
