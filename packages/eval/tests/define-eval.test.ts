import { describe, expect, it } from 'vitest';
import { defineEval } from '../src/define-eval.js';
import type { Scorer } from '../src/types.js';

const alwaysPass: Scorer<string, string> = ({ output, expected }) => ({
  pass: output === expected,
  score: output === expected ? 1 : 0,
});

describe('defineEval validation', () => {
  it('throws on empty cases', () => {
    expect(() =>
      defineEval({
        name: 'empty',
        cases: [],
        task: (x: string) => x,
        scorers: { eq: alwaysPass },
      }),
    ).toThrow('cases must be non-empty');
  });

  it('throws if no scorers AND no judge', () => {
    expect(() =>
      defineEval({
        name: 'no-scorers',
        cases: [{ input: 'a', expected: 'a' }],
        task: (x: string) => x,
        scorers: {},
      }),
    ).toThrow('at least one scorer or a judge must be configured');
  });

  it('does not throw if judge provided with no scorers', () => {
    expect(() =>
      defineEval({
        name: 'judge-only',
        cases: [{ input: 'a' }],
        task: (x: string) => x,
        scorers: {},
        judge: { model: 'gpt-4o' },
      }),
    ).not.toThrow();
  });

  it('returns DefinedEval with correct name', () => {
    const ev = defineEval({
      name: 'my-eval',
      cases: [{ input: 'x', expected: 'x' }],
      task: (x: string) => x,
      scorers: { eq: alwaysPass },
    });
    expect(ev.name).toBe('my-eval');
  });

  it('preserves judge field on DefinedEval', () => {
    const ev = defineEval({
      name: 'judge-test',
      cases: [{ input: 'a' }],
      task: (x: string) => x,
      scorers: { eq: alwaysPass },
      judge: { model: 'claude-3', rubric: 'Be strict.' },
    });
    expect(ev.judge?.model).toBe('claude-3');
    expect(ev.judge?.rubric).toBe('Be strict.');
  });
});

describe('DefinedEval.run()', () => {
  it('returns EvalSummary with all cases scored', async () => {
    const ev = defineEval({
      name: 'run-test',
      cases: [
        { input: 'hello', expected: 'hello' },
        { input: 'world', expected: 'world' },
      ],
      task: (x: string) => x,
      scorers: { eq: alwaysPass },
    });
    const summary = await ev.run();
    expect(summary.name).toBe('run-test');
    expect(summary.results).toHaveLength(2);
    expect(summary.passRate).toBe(1);
  });
});
