/**
 * Tests for @idriszade/cost — createCostCalculator.
 *
 * Covers all 10 acceptance criteria from the M6 brief (Unit 2 §Acceptance criteria).
 * Property tests use fast-check for:
 *   - totalCost >= 0 for non-negative inputs on any known model
 *   - totalCost === inputCost + outputCost + cacheWriteCost + cacheReadCost invariant
 *
 * Fake-timer constraint: no fake timers used here (no async sleeps); timers not needed.
 */

import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCostCalculator } from '../src/calculator.js';
import { LAST_UPDATED, PRICES } from '../src/prices.js';
import type { TokenUsage } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** All known model keys from the bundled snapshot. */
const ALL_KNOWN_KEYS = Object.keys(PRICES) as (keyof typeof PRICES)[];

/** Split a price key "provider:model" into [provider, model]. */
function splitKey(key: string): [string, string] {
  const idx = key.indexOf(':');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

// ─── AC-1: 1M input tokens → inputCost = 3.00 for sonnet-4-7 ─────────────────

describe('AC-1: 1M input tokens for anthropic:claude-sonnet-4-7', () => {
  it('returns inputCost: 3.00', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 1_000_000, outputTokens: 0 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    expect(result.data?.inputCost).toBe(3.0);
  });
});

// ─── AC-2: Anthropic cacheWriteCost for sonnet-4-7 ───────────────────────────

describe('AC-2: Anthropic cacheWriteCost (cacheWrite5m = 3.75/1M)', () => {
  it('returns cacheWriteCost = cacheWriteTokens * 3.75 / 1_000_000', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    expect(result.data?.cacheWriteCost).toBe(3.75);
  });
});

// ─── AC-3: Anthropic cacheReadCost for sonnet-4-7 ────────────────────────────

describe('AC-3: Anthropic cacheReadCost (cacheRead = 0.30/1M)', () => {
  it('returns cacheReadCost = cacheReadTokens * 0.30 / 1_000_000', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    expect(result.data?.cacheReadCost).toBe(0.3);
  });
});

// ─── AC-4: OpenAI cacheWriteCost === 0 ───────────────────────────────────────

describe('AC-4: OpenAI cacheWriteCost = 0 for all OpenAI models', () => {
  const openaiModels = ALL_KNOWN_KEYS.filter((k) => k.startsWith('openai:')).map(splitKey);

  for (const [provider, model] of openaiModels) {
    it(`cacheWriteCost === 0 for ${provider}:${model}`, () => {
      const calc = createCostCalculator();
      const result = calc.compute(
        { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 },
        model,
        provider,
      );
      expect(result.error).toBeNull();
      expect(result.data?.cacheWriteCost).toBe(0);
    });
  }
});

// ─── AC-5: totalCost arithmetic invariant (deterministic cases) ───────────────

describe('AC-5: totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost', () => {
  it('holds for a mixed sonnet-4-7 usage', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      {
        inputTokens: 500_000,
        outputTokens: 200_000,
        cacheWriteTokens: 100_000,
        cacheReadTokens: 300_000,
      },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    const ev = result.data;
    expect(ev?.totalCost).toBe(
      (ev?.inputCost ?? 0) +
        (ev?.outputCost ?? 0) +
        (ev?.cacheWriteCost ?? 0) +
        (ev?.cacheReadCost ?? 0),
    );
  });

  it('holds for gpt-5 with cache reads', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 200_000, outputTokens: 100_000, cacheReadTokens: 50_000 },
      'gpt-5',
      'openai',
    );
    expect(result.error).toBeNull();
    const ev = result.data;
    expect(ev?.totalCost).toBe(
      (ev?.inputCost ?? 0) +
        (ev?.outputCost ?? 0) +
        (ev?.cacheWriteCost ?? 0) +
        (ev?.cacheReadCost ?? 0),
    );
  });
});

// ─── AC-6: customPrices override replaces the full model entry ────────────────

describe('AC-6: customPrices override', () => {
  it('replaces the full model entry for an existing key', () => {
    const calc = createCostCalculator({
      customPrices: {
        'anthropic:claude-sonnet-4-7': {
          input: 99.0,
          output: 199.0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
        },
      },
    });
    const result = calc.compute(
      { inputTokens: 1_000_000, outputTokens: 0 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    expect(result.data?.inputCost).toBe(99.0);
  });

  it('adds a custom model key not in the bundled snapshot', () => {
    const calc = createCostCalculator({
      customPrices: {
        'custom:my-model': {
          input: 1.0,
          output: 2.0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
        },
      },
    });
    const result = calc.compute({ inputTokens: 1_000_000, outputTokens: 0 }, 'my-model', 'custom');
    expect(result.error).toBeNull();
    expect(result.data?.inputCost).toBe(1.0);
  });

  it('does not mutate bundled PRICES when customPrices provided', () => {
    const _before = PRICES['anthropic:claude-sonnet-4-7'].input;
    createCostCalculator({
      customPrices: {
        'anthropic:claude-sonnet-4-7': {
          input: 999.0,
          output: 999.0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
        },
      },
    });
    expect(PRICES['anthropic:claude-sonnet-4-7'].input).toBe(_before);
  });
});

// ─── AC-7: unknown_model error ────────────────────────────────────────────────

describe('AC-7: unknown_model error for unrecognised model key', () => {
  it('returns err({ code: "unknown_model" }) for a made-up model', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 1000, outputTokens: 500 },
      'nonexistent-model-xyz',
      'fakeprovider',
    );
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('unknown_model');
  });
});

// ─── AC-8: invalid_usage error for negative token counts ─────────────────────

describe('AC-8: invalid_usage error for negative token counts', () => {
  it('returns err({ code: "invalid_usage" }) for negative inputTokens', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: -1, outputTokens: 0 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('invalid_usage');
  });

  it('returns err({ code: "invalid_usage" }) for negative cacheWriteTokens', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 0, outputTokens: 0, cacheWriteTokens: -100 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('invalid_usage');
  });

  it('returns err({ code: "invalid_usage" }) for fractional token counts', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 1.5, outputTokens: 0 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('invalid_usage');
  });

  it('returns err({ code: "invalid_usage" }) for empty provider string', () => {
    const calc = createCostCalculator();
    const result = calc.compute({ inputTokens: 0, outputTokens: 0 }, 'claude-sonnet-4-7', '');
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('invalid_usage');
  });

  it('returns err({ code: "invalid_usage" }) for empty model string', () => {
    const calc = createCostCalculator();
    const result = calc.compute({ inputTokens: 0, outputTokens: 0 }, '', 'anthropic');
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('invalid_usage');
  });
});

// ─── AC-9: Property — totalCost >= 0 for non-negative inputs, any known model ─

describe('AC-9 (property): totalCost >= 0 for non-negative token inputs on any known model', () => {
  it('holds across all known models', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_KNOWN_KEYS),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        fc.nat({ max: 1_000_000 }),
        (key, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens) => {
          const [provider, model] = splitKey(key);
          const calc = createCostCalculator();
          const result = calc.compute(
            { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens },
            model,
            provider,
          );
          // All inputs are from known keys with non-negative ints, so error must be null.
          expect(result.error).toBeNull();
          expect(result.data?.totalCost).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── AC-10: Property — totalCost invariant holds across all models ─────────────

describe('AC-10 (property): totalCost === sum of 4-axis costs invariant', () => {
  it('holds across all known models', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_KNOWN_KEYS),
        fc.nat({ max: 2_000_000 }),
        fc.nat({ max: 2_000_000 }),
        fc.nat({ max: 2_000_000 }),
        fc.nat({ max: 2_000_000 }),
        (key, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens) => {
          const [provider, model] = splitKey(key);
          const calc = createCostCalculator();
          const result = calc.compute(
            { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens },
            model,
            provider,
          );
          expect(result.error).toBeNull();
          const ev = result.data;
          // Allow floating-point epsilon tolerance.
          const sum =
            (ev?.inputCost ?? 0) +
            (ev?.outputCost ?? 0) +
            (ev?.cacheWriteCost ?? 0) +
            (ev?.cacheReadCost ?? 0);
          expect(Math.abs((ev?.totalCost ?? 0) - sum)).toBeLessThan(1e-10);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── AC-11: LAST_UPDATED logged once per instance ────────────────────────────

describe('AC-11: LAST_UPDATED logged via console.debug once per instance', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs once on first compute() and not again on subsequent calls', () => {
    const calc = createCostCalculator();
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500 };

    calc.compute(usage, 'claude-sonnet-4-7', 'anthropic');
    calc.compute(usage, 'claude-sonnet-4-7', 'anthropic');
    calc.compute(usage, 'claude-sonnet-4-7', 'anthropic');

    const debugCalls = (console.debug as ReturnType<typeof vi.fn>).mock.calls;
    const lastUpdatedLogs = debugCalls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes(LAST_UPDATED),
    );
    expect(lastUpdatedLogs).toHaveLength(1);
  });

  it('logs once per separate instance (two instances = two log calls)', () => {
    const calcA = createCostCalculator();
    const calcB = createCostCalculator();
    const usage: TokenUsage = { inputTokens: 100, outputTokens: 50 };

    calcA.compute(usage, 'claude-sonnet-4-7', 'anthropic');
    calcB.compute(usage, 'claude-sonnet-4-7', 'anthropic');

    const debugCalls = (console.debug as ReturnType<typeof vi.fn>).mock.calls;
    const lastUpdatedLogs = debugCalls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes(LAST_UPDATED),
    );
    expect(lastUpdatedLogs).toHaveLength(2);
  });
});

// ─── Anthropic multiplier assertions ─────────────────────────────────────────

describe('Anthropic cache multiplier assertions', () => {
  const anthropicModels = ALL_KNOWN_KEYS.filter((k) => k.startsWith('anthropic:')).map(splitKey);

  for (const [provider, model] of anthropicModels) {
    const key = `${provider}:${model}` as keyof typeof PRICES;
    const price = PRICES[key];

    it(`${key}: cacheWrite5m === 1.25 × input`, () => {
      expect(price.cacheWrite5m).toBeCloseTo(1.25 * price.input, 10);
    });

    it(`${key}: cacheWrite1h === 2.00 × input`, () => {
      expect(price.cacheWrite1h).toBeCloseTo(2.0 * price.input, 10);
    });

    it(`${key}: cacheRead === 0.10 × input`, () => {
      expect(price.cacheRead).toBeCloseTo(0.1 * price.input, 10);
    });
  }
});

// ─── Optional token fields default to 0 ──────────────────────────────────────

describe('optional token fields default to 0', () => {
  it('omitting cacheWriteTokens and cacheReadTokens results in 0 for those costs', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 0, outputTokens: 0 },
      'claude-sonnet-4-7',
      'anthropic',
    );
    expect(result.error).toBeNull();
    expect(result.data?.cacheWriteTokens).toBe(0);
    expect(result.data?.cacheReadTokens).toBe(0);
    expect(result.data?.cacheWriteCost).toBe(0);
    expect(result.data?.cacheReadCost).toBe(0);
  });
});

// ─── pricedAt is an ISO 8601 string ──────────────────────────────────────────

describe('pricedAt', () => {
  it('is a valid ISO 8601 timestamp', () => {
    const calc = createCostCalculator();
    const result = calc.compute(
      { inputTokens: 1000, outputTokens: 500 },
      'claude-haiku-4-5',
      'anthropic',
    );
    expect(result.error).toBeNull();
    const ts = result.data?.pricedAt ?? '';
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});
