import type { Scorer } from '@idriszade/eval';

export function numericClose<I>(opts: { tolerance: number }): Scorer<I, number> {
  return ({ output, expected }) => {
    if (typeof output !== 'number' || typeof expected !== 'number') {
      return { pass: false, score: 0, reason: 'non-numeric value' };
    }
    if (Number.isNaN(output) || Number.isNaN(expected)) {
      return { pass: false, score: 0, reason: 'NaN in inputs' };
    }
    const diff = Math.abs(output - expected);
    const pass = diff <= opts.tolerance;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? undefined : `diff ${diff} > tol ${opts.tolerance}`,
    };
  };
}
