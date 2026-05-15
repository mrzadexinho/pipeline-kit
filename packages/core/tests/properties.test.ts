import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { createUsageAccumulator } from '../src/usage.js';
import { createDisposableRegistry } from '../src/disposable.js';
import { isRetryable, RETRYABILITY_MAP } from '../src/stage-error.js';

describe('UsageAccumulator properties', () => {
  it('accumulation is additive: sum of deltas equals get()', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 20 }),
        (deltas) => {
          const acc = createUsageAccumulator();
          for (const d of deltas) acc.record('tokens', d);
          const expected = deltas.reduce((a, b) => a + b, 0);
          expect(acc.get('tokens')).toBe(expected);
        },
      ),
    );
  });

  it('getAll returns immutable snapshot', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (n) => {
        const acc = createUsageAccumulator();
        acc.record('x', n);
        const snap = acc.getAll();
        acc.record('x', 1);
        expect(snap.get('x')).toBe(n); // snapshot unchanged
        expect(acc.get('x')).toBe(n + 1); // accumulator updated
      }),
    );
  });

  it('negative deltas are supported', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (delta) => {
        const acc = createUsageAccumulator();
        acc.record('m', delta);
        expect(acc.get('m')).toBe(delta);
      }),
    );
  });
});

describe('DisposableRegistry properties', () => {
  it('LIFO disposal order', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 10 }),
        async (names) => {
          // Deduplicate names for this test
          const unique = [...new Set(names)];
          const registry = createDisposableRegistry();
          const disposed: string[] = [];
          for (const name of unique) {
            registry.register(name, async () => { disposed.push(name); });
          }
          await registry.disposeAll();
          expect(disposed).toEqual([...unique].reverse());
        },
      ),
    );
  });
});

describe('StageErrorCode retryability completeness', () => {
  it('every code in RETRYABILITY_MAP has a defined verdict', () => {
    for (const [code, verdict] of RETRYABILITY_MAP) {
      // isRetryable returns null for 'unknown' verdict — that is valid
      const result = isRetryable(code);
      if (verdict === 'unknown') {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
      }
    }
  });

  it('RETRYABILITY_MAP covers all 19 error codes', () => {
    expect(RETRYABILITY_MAP.size).toBe(19);
  });
});
