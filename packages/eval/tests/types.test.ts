import { describe, expect, it } from 'vitest';
import type { Case, Score, Scorer } from '../src/types.js';

describe('Case<I,O> type contracts', () => {
  it('assigns Case with primitive input and expected', () => {
    const c: Case<string, number> = { input: 'hello', expected: 42 };
    expect(c.input).toBe('hello');
    expect(c.expected).toBe(42);
  });

  it('assigns Case with object input', () => {
    const c: Case<{ q: string }, { answer: string }> = {
      input: { q: 'What?' },
      expected: { answer: 'Yes' },
    };
    expect(c.input.q).toBe('What?');
  });

  it('expected is optional', () => {
    const c: Case<string> = { input: 'hello' };
    expect(c.expected).toBeUndefined();
  });

  it('metadata is accepted on Case', () => {
    const c: Case<number> = { input: 1, metadata: { tag: 'unit' } };
    expect(c.metadata?.['tag']).toBe('unit');
  });
});

describe('Score type', () => {
  it('requires pass and score', () => {
    const s: Score = { pass: true, score: 1 };
    expect(s.pass).toBe(true);
    expect(s.score).toBe(1);
  });

  it('reason is optional', () => {
    const s: Score = { pass: false, score: 0 };
    expect(s.reason).toBeUndefined();
  });
});

describe('Scorer<I,O> type', () => {
  it('matches sync scorer signature', () => {
    const scorer: Scorer<string, string> = ({ output, expected }) => ({
      pass: output === expected,
      score: output === expected ? 1 : 0,
    });
    const result = scorer({ input: 'x', output: 'x', expected: 'x' });
    expect((result as Score).pass).toBe(true);
  });

  it('matches async scorer signature', async () => {
    const scorer: Scorer<string, string> = async ({ output, expected }) => ({
      pass: output === expected,
      score: output === expected ? 1 : 0,
    });
    const result = await scorer({ input: 'x', output: 'y', expected: 'x' });
    expect(result.pass).toBe(false);
  });
});
