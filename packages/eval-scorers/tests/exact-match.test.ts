import { describe, expect, it } from 'vitest';
import { exactMatch } from '../src/exact-match.js';

describe('exactMatch', () => {
  it('passes for identical primitive strings', () => {
    const scorer = exactMatch<number, string>();
    const result = scorer({ input: 1, output: 'a', expected: 'a' });
    expect((result as { pass: boolean }).pass).toBe(true);
    expect((result as { score: number }).score).toBe(1);
  });

  it('passes for deeply equal objects', () => {
    const scorer = exactMatch<unknown, { a: number; b: number[] }>();
    const result = scorer({
      input: null,
      output: { a: 1, b: [2, 3] },
      expected: { a: 1, b: [2, 3] },
    });
    expect((result as { pass: boolean }).pass).toBe(true);
  });

  it('fails when nested array differs', () => {
    const scorer = exactMatch<unknown, { a: number; b: number[] }>();
    const result = scorer({
      input: null,
      output: { a: 1, b: [2, 3] },
      expected: { a: 1, b: [2, 4] },
    });
    expect((result as { pass: boolean }).pass).toBe(false);
    expect((result as { score: number }).score).toBe(0);
    expect((result as { reason?: string }).reason).toBe('output != expected');
  });

  it('NaN equals NaN via Object.is', () => {
    const scorer = exactMatch<unknown, number>();
    const result = scorer({ input: null, output: NaN, expected: NaN });
    expect((result as { pass: boolean }).pass).toBe(true);
  });

  it('Map order-independent equality', () => {
    const scorer = exactMatch<unknown, Map<string, number>>();
    const mapA = new Map([
      ['b', 2],
      ['a', 1],
    ]);
    const mapB = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const result = scorer({ input: null, output: mapA, expected: mapB });
    expect((result as { pass: boolean }).pass).toBe(true);
  });

  it('undefined expected: output must also be undefined to pass', () => {
    const scorer = exactMatch<unknown, string | undefined>();
    const failResult = scorer({ input: null, output: 'something', expected: undefined });
    expect((failResult as { pass: boolean }).pass).toBe(false);

    const passResult = scorer({ input: null, output: undefined, expected: undefined });
    expect((passResult as { pass: boolean }).pass).toBe(true);
  });
});
