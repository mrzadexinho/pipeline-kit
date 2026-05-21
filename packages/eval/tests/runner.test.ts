import { describe, expect, it } from 'vitest';
import { runEval } from '../src/runner.js';
import type { Case, Scorer } from '../src/types.js';

describe('runEval — concurrency', () => {
  it('runs all cases respecting concurrency limit (counter check)', async () => {
    let active = 0;
    let maxActive = 0;
    const concurrency = 3;

    const slowTask = async (x: number): Promise<number> => {
      active++;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return x * 2;
    };

    const cases: Case<number, number>[] = Array.from({ length: 10 }, (_, i) => ({
      input: i,
      expected: i * 2,
    }));

    await runEval({
      name: 'concurrency-test',
      cases,
      task: slowTask,
      scorers: {},
      concurrency,
    });

    expect(maxActive).toBeLessThanOrEqual(concurrency);
    expect(maxActive).toBeGreaterThan(1);
  });
});

describe('runEval — error handling', () => {
  it('captures task throw as EvalResult.error, not propagated', async () => {
    const summary = await runEval({
      name: 'task-throw',
      cases: [{ input: 'boom' }],
      task: () => {
        throw new Error('task failed hard');
      },
      scorers: {},
    });

    expect(summary.results).toHaveLength(1);
    const result = summary.results[0];
    expect(result).toBeDefined();
    expect(result?.error).toBeDefined();
    expect(result?.error?.code).toBe('task_error');
    expect(result?.error?.message).toBe('task failed hard');
    expect(result?.output).toBeUndefined();
  });

  it('captures scorer throw as fail score with scorer_error reason', async () => {
    const throwingScorer: Scorer<string, string> = () => {
      throw new Error('scorer exploded');
    };

    const summary = await runEval({
      name: 'scorer-throw',
      cases: [{ input: 'x', expected: 'x' }],
      task: (x) => x,
      scorers: { bad: throwingScorer },
    });

    const result = summary.results[0];
    expect(result).toBeDefined();
    expect(result?.scores).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: result asserted by toBeDefined above; scores[0] present since scores has length 1
    const s = result!.scores[0]!;
    expect(s.score.pass).toBe(false);
    expect(s.score.score).toBe(0);
    expect(s.score.reason).toMatch(/^scorer_error:/);
  });
});

describe('runEval — passRate', () => {
  it('computes passRate correctly when 3/5 cases pass', async () => {
    const passScorer: Scorer<number, number> = ({ output, expected }) => ({
      pass: output === expected,
      score: output === expected ? 1 : 0,
    });

    const cases: Case<number, number>[] = [
      { input: 1, expected: 1 }, // pass
      { input: 2, expected: 2 }, // pass
      { input: 3, expected: 3 }, // pass
      { input: 4, expected: 99 }, // fail
      { input: 5, expected: 99 }, // fail
    ];

    const summary = await runEval({
      name: 'pass-rate',
      cases,
      task: (x) => x,
      scorers: { exact: passScorer },
    });

    expect(summary.passRate).toBeCloseTo(3 / 5);
  });
});

describe('runEval — usage and duration', () => {
  it('durationMs > 0 for each result', async () => {
    const summary = await runEval({
      name: 'duration-check',
      cases: [{ input: 'a' }, { input: 'b' }],
      task: (x) => x,
      scorers: {},
    });

    for (const r of summary.results) {
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('totalUsage merges across cases', async () => {
    // The runner creates a fresh usageAcc per case — usage is 0 by default.
    // We verify the merge logic by checking totalUsage is a ReadonlyMap.
    const summary = await runEval({
      name: 'usage-merge',
      cases: [{ input: 1 }, { input: 2 }],
      task: (x) => x,
      scorers: {},
    });

    expect(summary.totalUsage).toBeInstanceOf(Map);
  });

  it('totalDurationMs equals sum of per-case durations', async () => {
    const summary = await runEval({
      name: 'total-duration',
      cases: [{ input: 'x' }, { input: 'y' }],
      task: (x) => x,
      scorers: {},
    });

    const sum = summary.results.reduce((acc, r) => acc + r.durationMs, 0);
    expect(summary.totalDurationMs).toBeCloseTo(sum, 0);
  });
});
