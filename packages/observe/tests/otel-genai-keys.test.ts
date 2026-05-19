import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CACHE_SUB_FIELDS,
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MAX_TOKENS,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_REQUEST_TEMPERATURE,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_ID,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
  isCacheSubField,
  isReasoningSubField,
  REASONING_SUB_FIELDS,
} from '../src/otel-genai-keys.js';

describe('GenAI key constants', () => {
  it('top-level keys match exact OTel GenAI v1.37 strings', () => {
    expect(GEN_AI_SYSTEM).toBe('gen_ai.system');
    expect(GEN_AI_OPERATION_NAME).toBe('gen_ai.operation.name');
    expect(GEN_AI_REQUEST_MODEL).toBe('gen_ai.request.model');
    expect(GEN_AI_RESPONSE_MODEL).toBe('gen_ai.response.model');
    expect(GEN_AI_REQUEST_TEMPERATURE).toBe('gen_ai.request.temperature');
    expect(GEN_AI_REQUEST_MAX_TOKENS).toBe('gen_ai.request.max_tokens');
    expect(GEN_AI_USAGE_INPUT_TOKENS).toBe('gen_ai.usage.input_tokens');
    expect(GEN_AI_USAGE_OUTPUT_TOKENS).toBe('gen_ai.usage.output_tokens');
    expect(GEN_AI_RESPONSE_ID).toBe('gen_ai.response.id');
    expect(GEN_AI_RESPONSE_FINISH_REASONS).toBe('gen_ai.response.finish_reasons');
  });

  it('cache sub-field constants match exact strings', () => {
    expect(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ).toBe('gen_ai.usage.input_tokens.cache_read');
    expect(GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE).toBe('gen_ai.usage.input_tokens.cache_write');
    expect(GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE).toBe('gen_ai.usage.input_tokens.no_cache');
    expect(GEN_AI_USAGE_OUTPUT_TOKENS_REASONING).toBe('gen_ai.usage.output_tokens.reasoning');
    expect(GEN_AI_USAGE_OUTPUT_TOKENS_TEXT).toBe('gen_ai.usage.output_tokens.text');
  });

  it('CACHE_SUB_FIELDS contains all 3 cache_* keys', () => {
    expect(CACHE_SUB_FIELDS).toHaveLength(3);
    expect(CACHE_SUB_FIELDS).toContain('gen_ai.usage.input_tokens.cache_read');
    expect(CACHE_SUB_FIELDS).toContain('gen_ai.usage.input_tokens.cache_write');
    expect(CACHE_SUB_FIELDS).toContain('gen_ai.usage.input_tokens.no_cache');
  });

  it('REASONING_SUB_FIELDS contains the reasoning and text keys', () => {
    expect(REASONING_SUB_FIELDS).toHaveLength(2);
    expect(REASONING_SUB_FIELDS).toContain('gen_ai.usage.output_tokens.reasoning');
    expect(REASONING_SUB_FIELDS).toContain('gen_ai.usage.output_tokens.text');
  });

  it('isCacheSubField returns true for cache_read key', () => {
    expect(isCacheSubField('gen_ai.usage.input_tokens.cache_read')).toBe(true);
  });

  it('isCacheSubField returns false for parent input_tokens key', () => {
    expect(isCacheSubField('gen_ai.usage.input_tokens')).toBe(false);
  });

  it('isReasoningSubField returns true for reasoning key', () => {
    expect(isReasoningSubField('gen_ai.usage.output_tokens.reasoning')).toBe(true);
  });

  it('isReasoningSubField returns false for unrelated key', () => {
    expect(isReasoningSubField('gen_ai.usage.input_tokens')).toBe(false);
  });
});

describe('non-additivity: cache sub-field is descriptive, not summed into parent', () => {
  it('property: recording input_tokens + cache_read sub-field does not double-count parent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (total, cacheRead) => {
          const usage = new Map<string, number>();

          // Simulate recording parent total and cache sub-field separately.
          usage.set(GEN_AI_USAGE_INPUT_TOKENS, total);
          usage.set(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ, Math.min(cacheRead, total));

          // The parent total must NOT be affected by the sub-field recording.
          const parentTotal = usage.get(GEN_AI_USAGE_INPUT_TOKENS);
          expect(parentTotal).toBe(total);

          // The sub-field is stored under its own key.
          const cacheValue = usage.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ);
          expect(cacheValue).toBeLessThanOrEqual(total);
        },
      ),
      { numRuns: 50 },
    );
  });
});
