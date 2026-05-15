import { describe, expect, it } from 'vitest';
import { type CostBudget, createUsageAccumulator } from '../src/usage.js';

describe('UsageAccumulator', () => {
  it('record accumulates values for the same key', () => {
    const acc = createUsageAccumulator();
    acc.record('a', 5);
    acc.record('a', 3);
    expect(acc.get('a')).toBe(8);
  });

  it('get returns 0 for unknown keys', () => {
    const acc = createUsageAccumulator();
    expect(acc.get('nonexistent')).toBe(0);
  });

  it('getAll returns snapshot that does not reflect subsequent mutations', () => {
    const acc = createUsageAccumulator();
    acc.record('x', 10);
    const snapshot = acc.getAll();
    acc.record('x', 5);
    expect(snapshot.get('x')).toBe(10);
    expect(acc.get('x')).toBe(15);
  });

  it('getAll returned map is not the live internal map (immutable snapshot)', () => {
    const acc = createUsageAccumulator();
    acc.record('y', 1);
    const snapshot = acc.getAll() as Map<string, number>;
    expect(() => snapshot.set('y', 999)).not.toThrow();
    expect(acc.get('y')).toBe(1);
  });

  it('negative delta subtracts from the accumulated value', () => {
    const acc = createUsageAccumulator();
    acc.record('a', 10);
    acc.record('a', -3);
    expect(acc.get('a')).toBe(7);
  });

  it('getAll reflects all recorded keys', () => {
    const acc = createUsageAccumulator();
    acc.record('gen_ai.usage.input_tokens', 100);
    acc.record('gen_ai.usage.output_tokens', 50);
    const all = acc.getAll();
    expect(all.size).toBe(2);
    expect(all.get('gen_ai.usage.input_tokens')).toBe(100);
    expect(all.get('gen_ai.usage.output_tokens')).toBe(50);
  });

  it('CostBudget type is assignable for all action values', () => {
    const abort: CostBudget = { metric: 'gen_ai.usage.input_tokens', limit: 1000, action: 'abort' };
    const review: CostBudget = { metric: 'cost.usd', limit: 5, action: 'review' };
    const warn: CostBudget = { metric: 'compute.duration_ms', limit: 30000, action: 'warn' };
    expect(abort.action).toBe('abort');
    expect(review.action).toBe('review');
    expect(warn.action).toBe('warn');
  });
});
