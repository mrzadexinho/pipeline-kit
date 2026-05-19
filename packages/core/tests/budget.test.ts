import { describe, expect, it } from 'vitest';
import { evaluateBudgets } from '../src/budget.js';
import { createUsageAccumulator } from '../src/usage.js';

describe('evaluateBudgets', () => {
  it('returns ok for empty budgets array', () => {
    const usage = createUsageAccumulator();
    expect(evaluateBudgets(usage, [])).toEqual({ action: 'ok' });
  });

  it('returns ok for undefined budgets', () => {
    const usage = createUsageAccumulator();
    expect(evaluateBudgets(usage, undefined)).toEqual({ action: 'ok' });
  });

  it('returns ok when no budget is breached', () => {
    const usage = createUsageAccumulator();
    usage.record('tokens', 400);
    const result = evaluateBudgets(usage, [{ metric: 'tokens', limit: 500, action: 'abort' }]);
    expect(result).toEqual({ action: 'ok' });
  });

  it('returns abort breach when current >= limit and action is abort', () => {
    const usage = createUsageAccumulator();
    usage.record('tokens', 600);
    const budget = { metric: 'tokens', limit: 500, action: 'abort' as const };
    const result = evaluateBudgets(usage, [budget]);
    expect(result).toEqual({ action: 'abort', budget, current: 600 });
  });

  it('returns warn breach when current >= limit and action is warn', () => {
    const usage = createUsageAccumulator();
    usage.record('tokens', 500);
    const budget = { metric: 'tokens', limit: 500, action: 'warn' as const };
    const result = evaluateBudgets(usage, [budget]);
    expect(result).toEqual({ action: 'warn', budget, current: 500 });
  });

  it('returns review breach when current >= limit and action is review', () => {
    const usage = createUsageAccumulator();
    usage.record('cost', 10);
    const budget = { metric: 'cost', limit: 5, action: 'review' as const };
    const result = evaluateBudgets(usage, [budget]);
    expect(result).toEqual({ action: 'review', budget, current: 10 });
  });

  it('returns the FIRST triggered breach when multiple budgets are configured', () => {
    const usage = createUsageAccumulator();
    usage.record('tokens', 600);
    usage.record('cost', 20);
    const first = { metric: 'tokens', limit: 500, action: 'abort' as const };
    const second = { metric: 'cost', limit: 10, action: 'warn' as const };
    const result = evaluateBudgets(usage, [first, second]);
    expect(result).toEqual({ action: 'abort', budget: first, current: 600 });
  });
});
