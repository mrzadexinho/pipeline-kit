import { describe, expect, it } from 'vitest';
import { numericClose } from '../src/numeric.js';

describe('numericClose', () => {
  it('passes when diff is within tolerance', () => {
    const scorer = numericClose<unknown>({ tolerance: 0.05 });
    const result = scorer({ input: null, output: 1.01, expected: 1.0 });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails when diff exceeds tolerance', () => {
    const scorer = numericClose<unknown>({ tolerance: 0.1 });
    const result = scorer({ input: null, output: 1.5, expected: 1.0 });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/diff .* > tol/);
  });

  it('fails for non-number output', () => {
    const scorer = numericClose<unknown>({ tolerance: 0.1 });
    const result = scorer({ input: null, output: 'hello' as unknown as number, expected: 1 });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('non-numeric value');
  });

  it('fails for NaN inputs', () => {
    const scorer = numericClose<unknown>({ tolerance: 0.1 });
    const result = scorer({ input: null, output: NaN, expected: 1 });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('NaN in inputs');
  });

  it('passes for exact equality', () => {
    const scorer = numericClose<unknown>({ tolerance: 0 });
    const result = scorer({ input: null, output: 42, expected: 42 });
    expect(result.pass).toBe(true);
  });
});
