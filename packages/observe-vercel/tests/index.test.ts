import { createUsageAccumulator } from '@idriszade/core';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
} from '@idriszade/observe';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordVercelUsage } from '../src/index.js';

describe('recordVercelUsage — top-level totals', () => {
  it('records inputTokens and outputTokens under the correct OTel keys', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ inputTokens: 200, outputTokens: 50, totalTokens: 250 }, acc);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).toBe(200);
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS)).toBe(50);
  });

  it('missing fields produce no spurious zero records', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ inputTokens: 100 }, acc);
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS)).toBe(0);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ)).toBe(0);
    expect(acc.getAll().has(GEN_AI_USAGE_OUTPUT_TOKENS)).toBe(false);
    expect(acc.getAll().has(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ)).toBe(false);
  });
});

describe('recordVercelUsage — cache sub-fields are non-additive', () => {
  it('records cacheRead / cacheWrite / noCache under their own keys without mutating the input total', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage(
      {
        inputTokens: 100,
        inputTokenDetails: {
          cacheReadTokens: 80,
          cacheWriteTokens: 10,
          noCacheTokens: 10,
        },
      },
      acc,
    );
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).toBe(100);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ)).toBe(80);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE)).toBe(10);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE)).toBe(10);
    // Must NOT be 100 + 80 = 180
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).not.toBe(180);
  });

  it('inputTokens=100 AND cacheReadTokens=80 → input total stays 100, cache_read=80, sum is NOT 180', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ inputTokens: 100, inputTokenDetails: { cacheReadTokens: 80 } }, acc);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).toBe(100);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ)).toBe(80);
    // Explicit anti-regression: NOT 180
    expect(
      acc.get(GEN_AI_USAGE_INPUT_TOKENS) + acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ),
    ).not.toBe(acc.get(GEN_AI_USAGE_INPUT_TOKENS));
    // The parent total is correct and unchanged
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).toBe(100);
  });
});

describe('recordVercelUsage — alt spelling nonCachedTokens', () => {
  it('accepts nonCachedTokens as fallback when noCacheTokens is absent', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ inputTokenDetails: { nonCachedTokens: 42 } }, acc);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE)).toBe(42);
  });

  it('noCacheTokens takes precedence over nonCachedTokens when both present', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ inputTokenDetails: { noCacheTokens: 7, nonCachedTokens: 999 } }, acc);
    expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE)).toBe(7);
  });
});

describe('recordVercelUsage — output sub-fields', () => {
  it('records reasoningTokens and textTokens under their own keys', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage(
      {
        outputTokens: 120,
        outputTokenDetails: { reasoningTokens: 30, textTokens: 90 },
      },
      acc,
    );
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS)).toBe(120);
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS_REASONING)).toBe(30);
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS_TEXT)).toBe(90);
  });

  it('records only reasoningTokens when textTokens is absent', () => {
    const acc = createUsageAccumulator();
    recordVercelUsage({ outputTokenDetails: { reasoningTokens: 15 } }, acc);
    expect(acc.get(GEN_AI_USAGE_OUTPUT_TOKENS_REASONING)).toBe(15);
    expect(acc.getAll().has(GEN_AI_USAGE_OUTPUT_TOKENS_TEXT)).toBe(false);
  });
});

describe('recordVercelUsage — property test: non-additivity invariant', () => {
  it('for arbitrary inputTotal and cacheRead: input total is exact, cache_read is exact, no summing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (inputTotal, cacheRead) => {
          const acc = createUsageAccumulator();
          recordVercelUsage(
            {
              inputTokens: inputTotal,
              inputTokenDetails: { cacheReadTokens: cacheRead },
            },
            acc,
          );
          expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS)).toBe(inputTotal);
          expect(acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ)).toBe(cacheRead);
        },
      ),
      { numRuns: 50 },
    );
  });
});
