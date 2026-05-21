import type { BudgetAccumulation } from '../budget.js';
import type { ComposerStep } from './composer.js';

/**
 * Pure reducer: recomputes `BudgetAccumulation` from `run.steps[]`.
 *
 * This MUST be called fresh at each stage boundary — never stored as a mutable
 * field. Inngest replay safety requires that accumulation is derived from the
 * immutable steps journal, not from a context field that may be reset on
 * replay.
 *
 * Steps without a `costEvent` contribute 0 to all dollar/token totals.
 * `totalRequests` equals the number of steps in the array regardless of
 * whether they carry cost events.
 */
export function recomputeAccumulation(steps: readonly ComposerStep[]): BudgetAccumulation {
  let totalDollars = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const step of steps) {
    if (step.costEvent !== undefined) {
      totalDollars += step.costEvent.totalCost;
      totalInputTokens += step.costEvent.inputTokens;
      totalOutputTokens += step.costEvent.outputTokens;
    }
  }
  return {
    totalDollars,
    totalInputTokens,
    totalOutputTokens,
    totalRequests: steps.length,
  };
}
