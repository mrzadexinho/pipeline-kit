import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CostBudget, createUsageAccumulator } from '../src/usage.js';
import { createContext } from '../src/context.js';

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

  it('merge() additively combines an external snapshot into the accumulator', () => {
    const acc = createUsageAccumulator();
    acc.record('tokens', 100);
    const other = new Map<string, number>([['tokens', 50], ['cost', 5]]);
    acc.merge(other);
    expect(acc.get('tokens')).toBe(150);
    expect(acc.get('cost')).toBe(5);
  });
});

describe('UsageAccumulator — property tests', () => {
  const entryArb = fc.array(
    fc.tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.integer({ min: -1000, max: 1000 })),
    { minLength: 0, maxLength: 10 },
  );

  it('commutativity: recording in original vs reversed order yields identical snapshots', () => {
    fc.assert(
      fc.property(entryArb, (entries) => {
        const acc1 = createUsageAccumulator();
        const acc2 = createUsageAccumulator();
        for (const [k, v] of entries) acc1.record(k, v);
        for (const [k, v] of [...entries].reverse()) acc2.record(k, v);
        const s1 = acc1.getAll();
        const s2 = acc2.getAll();
        if (s1.size !== s2.size) return false;
        for (const [k, v] of s1) {
          if (s2.get(k) !== v) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('associativity (merge): merge order does not affect result', () => {
    fc.assert(
      fc.property(entryArb, entryArb, entryArb, (entriesA, entriesB, entriesC) => {
        // A merged with B then C
        const accA1 = createUsageAccumulator();
        const accB1 = createUsageAccumulator();
        const accC1 = createUsageAccumulator();
        for (const [k, v] of entriesA) accA1.record(k, v);
        for (const [k, v] of entriesB) accB1.record(k, v);
        for (const [k, v] of entriesC) accC1.record(k, v);
        accA1.merge(accB1.getAll());
        accA1.merge(accC1.getAll());

        // A merged with C then B
        const accA2 = createUsageAccumulator();
        const accB2 = createUsageAccumulator();
        const accC2 = createUsageAccumulator();
        for (const [k, v] of entriesA) accA2.record(k, v);
        for (const [k, v] of entriesB) accB2.record(k, v);
        for (const [k, v] of entriesC) accC2.record(k, v);
        accA2.merge(accC2.getAll());
        accA2.merge(accB2.getAll());

        const s1 = accA1.getAll();
        const s2 = accA2.getAll();
        if (s1.size !== s2.size) return false;
        for (const [k, v] of s1) {
          if (s2.get(k) !== v) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('UsageAccumulator — run isolation', () => {
  it('two consecutive pipeline runs have independent UsageAccumulators', () => {
    const ctx1 = createContext({ pipelineId: 'pk_pipe_test' });
    const ctx2 = createContext({ pipelineId: 'pk_pipe_test' });
    ctx1.usage.record('tokens', 500);
    expect(ctx2.usage.get('tokens')).toBe(0);
  });
});
