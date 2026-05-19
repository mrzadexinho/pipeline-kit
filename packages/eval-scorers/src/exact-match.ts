import type { Scorer } from '@idriszade/eval';

export function exactMatch<I, O>(): Scorer<I, O> {
  return ({ output, expected }) => {
    const pass = deepEqual(output, expected);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? undefined : 'output != expected',
    };
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    const aEntries = [...a.entries()].sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1));
    const bEntries = [...b.entries()].sort((x, y) => (String(x[0]) < String(y[0]) ? -1 : 1));
    return aEntries.every(([k, v], i) => {
      const bPair = bEntries[i];
      return bPair !== undefined && deepEqual(k, bPair[0]) && deepEqual(v, bPair[1]);
    });
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }

  return false;
}
