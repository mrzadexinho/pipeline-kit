// OTel GenAI v1.37 semantic convention keys.
// Stable, additive top-level keys.

/**
 * Content keys for GenAI prompt/completion events.
 * These carry raw LLM prompt/completion text and are treated as secret by default
 * in the known-sensitive table (see KNOWN_SENSITIVE in known-sensitive.ts).
 */
export const GEN_AI_PROMPT = 'gen_ai.prompt' as const;
export const GEN_AI_COMPLETION = 'gen_ai.completion' as const;

export const GEN_AI_SYSTEM = 'gen_ai.system' as const;
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name' as const;
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model' as const;
export const GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model' as const;
export const GEN_AI_REQUEST_TEMPERATURE = 'gen_ai.request.temperature' as const;
export const GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens' as const;
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens' as const;
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens' as const;
export const GEN_AI_RESPONSE_ID = 'gen_ai.response.id' as const;
export const GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons' as const;

/**
 * Sub-field of `gen_ai.usage.input_tokens`. NON-ADDITIVE — the parent total
 * already includes cached tokens. Recording both `gen_ai.usage.input_tokens`
 * and a cache sub-field is the correct pattern; cache sub-fields are
 * descriptive, not additive.
 *
 * Reference: Langfuse issue #12306 — cache tokens are sub-fields, not
 * separate counters. Vercel AI SDK v7 removed top-level
 * `cachedInputTokens` / `reasoningTokens` for the same reason.
 */
export const GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ = 'gen_ai.usage.input_tokens.cache_read' as const;

/**
 * Sub-field of `gen_ai.usage.input_tokens`. NON-ADDITIVE — the parent total
 * already includes cached tokens. Recording both `gen_ai.usage.input_tokens`
 * and a cache sub-field is the correct pattern; cache sub-fields are
 * descriptive, not additive.
 *
 * Reference: Langfuse issue #12306 — cache tokens are sub-fields, not
 * separate counters. Vercel AI SDK v7 removed top-level
 * `cachedInputTokens` / `reasoningTokens` for the same reason.
 */
export const GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE =
  'gen_ai.usage.input_tokens.cache_write' as const;

/**
 * Sub-field of `gen_ai.usage.input_tokens`. NON-ADDITIVE — the parent total
 * already includes cached tokens. Recording both `gen_ai.usage.input_tokens`
 * and a cache sub-field is the correct pattern; cache sub-fields are
 * descriptive, not additive.
 *
 * Reference: Langfuse issue #12306 — cache tokens are sub-fields, not
 * separate counters. Vercel AI SDK v7 removed top-level
 * `cachedInputTokens` / `reasoningTokens` for the same reason.
 */
export const GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE = 'gen_ai.usage.input_tokens.no_cache' as const;

/**
 * Sub-field of `gen_ai.usage.output_tokens`. NON-ADDITIVE — the parent total
 * already includes reasoning tokens. Recording both `gen_ai.usage.output_tokens`
 * and a reasoning sub-field is the correct pattern; reasoning sub-fields are
 * descriptive, not additive.
 *
 * Reference: Langfuse issue #12306 — cache tokens are sub-fields, not
 * separate counters. Vercel AI SDK v7 removed top-level
 * `cachedInputTokens` / `reasoningTokens` for the same reason.
 */
export const GEN_AI_USAGE_OUTPUT_TOKENS_REASONING = 'gen_ai.usage.output_tokens.reasoning' as const;

/**
 * Sub-field of `gen_ai.usage.output_tokens`. NON-ADDITIVE — the parent total
 * already includes text tokens. Recording both `gen_ai.usage.output_tokens`
 * and a text sub-field is the correct pattern; text sub-fields are
 * descriptive, not additive.
 *
 * Reference: Langfuse issue #12306 — cache tokens are sub-fields, not
 * separate counters. Vercel AI SDK v7 removed top-level
 * `cachedInputTokens` / `reasoningTokens` for the same reason.
 */
export const GEN_AI_USAGE_OUTPUT_TOKENS_TEXT = 'gen_ai.usage.output_tokens.text' as const;

// Union of all top-level attribute keys for safe use at ctx.usage.record() call sites.
export type GenAIAttributeKey =
  | typeof GEN_AI_PROMPT
  | typeof GEN_AI_COMPLETION
  | typeof GEN_AI_SYSTEM
  | typeof GEN_AI_OPERATION_NAME
  | typeof GEN_AI_REQUEST_MODEL
  | typeof GEN_AI_RESPONSE_MODEL
  | typeof GEN_AI_REQUEST_TEMPERATURE
  | typeof GEN_AI_REQUEST_MAX_TOKENS
  | typeof GEN_AI_USAGE_INPUT_TOKENS
  | typeof GEN_AI_USAGE_OUTPUT_TOKENS
  | typeof GEN_AI_RESPONSE_ID
  | typeof GEN_AI_RESPONSE_FINISH_REASONS
  | typeof GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ
  | typeof GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE
  | typeof GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE
  | typeof GEN_AI_USAGE_OUTPUT_TOKENS_REASONING
  | typeof GEN_AI_USAGE_OUTPUT_TOKENS_TEXT;

// Programmatic non-additivity guards.
export const CACHE_SUB_FIELDS: readonly string[] = [
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
] as const;

export const REASONING_SUB_FIELDS: readonly string[] = [
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
] as const;

export function isCacheSubField(key: string): boolean {
  return (CACHE_SUB_FIELDS as readonly string[]).includes(key);
}

export function isReasoningSubField(key: string): boolean {
  return (REASONING_SUB_FIELDS as readonly string[]).includes(key);
}
