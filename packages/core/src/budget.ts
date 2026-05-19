export type { CostBudget } from './usage.js';
import type { UsageAccumulator, CostBudget } from './usage.js';

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
