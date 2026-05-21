/**
 * Bundled pricing snapshot for @idriszade/cost.
 *
 * Key format: `${provider}:${model}`. All prices are per 1M tokens, USD.
 *
 * Anthropic 4-field model: inputTokens / outputTokens / cacheWrite5m / cacheRead.
 * cacheWrite1h is included for reference but compute() maps cacheWriteTokens → cacheWrite5m
 * (the 5-minute write tier is the default; no separate 1h-write billing field in TokenUsage).
 *
 * OpenAI cache model: 50% read discount off input; no separate write charge.
 *
 * LAST_UPDATED is emitted at debug level on first compute() call per calculator instance.
 * Pin a package version and supply customPrices for contract or self-hosted rates.
 */

/** Snapshot date for the bundled pricing table. */
export const LAST_UPDATED = '2026-05-20';

/**
 * Bundled pricing snapshot. Per 1M tokens, USD.
 *
 * Anthropic multiplier assertions (verified in tests):
 *   cacheWrite5m = 1.25 × input
 *   cacheWrite1h = 2.00 × input
 *   cacheRead    = 0.10 × input
 */
export const PRICES = {
  'anthropic:claude-sonnet-4-7': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  'anthropic:claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  'anthropic:claude-haiku-4-5': {
    input: 0.8,
    output: 4.0,
    cacheWrite5m: 1.0,
    cacheWrite1h: 1.6,
    cacheRead: 0.08,
  },
  'anthropic:claude-opus-4-7': {
    input: 15.0,
    output: 75.0,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30.0,
    cacheRead: 1.5,
  },
  'openai:gpt-5': {
    input: 10.0,
    output: 40.0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 5.0,
  },
  'openai:gpt-5-mini': {
    input: 1.1,
    output: 4.4,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0.55,
  },
  'openai:gpt-4.1': {
    input: 2.0,
    output: 8.0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 1.0,
  },
  'openai:gpt-4o': {
    input: 2.5,
    output: 10.0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 1.25,
  },
  'openai:gpt-4o-mini': {
    input: 0.15,
    output: 0.6,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0.075,
  },
  'meta:llama-3.3-70b': {
    input: 0.59,
    output: 0.79,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
  },
  'deepseek:deepseek-v3': {
    input: 0.27,
    output: 1.1,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0.07,
  },
  'alibaba:qwen-3-235b-a22b': {
    input: 0.6,
    output: 2.4,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0.15,
  },
} as const;

/** Union of all known price keys in the bundled snapshot. */
export type PriceKey = keyof typeof PRICES;
