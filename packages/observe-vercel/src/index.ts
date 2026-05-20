// M4 — re-export RedactingProcessor surface from @idriszade/observe for one-stop import.
// M5/C5 — RedactingProcessorOptions now includes `mode: 'denylist' | 'allowlist'` (ADR VIII-6.g).
//          Parity is automatic: the type re-export carries the new field.
export type { RedactingProcessorOptions } from '@idriszade/observe';
export { KNOWN_SENSITIVE, PII_ANNOTATIONS_ATTR, RedactingProcessor } from '@idriszade/observe';
export type {
  VercelInputTokenDetails,
  VercelOutputTokenDetails,
  VercelUsageV7,
} from './types.js';

import type { UsageAccumulator } from '@idriszade/core';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
} from '@idriszade/observe';
import type { VercelUsageV7 } from './types.js';

/**
 * Record Vercel AI SDK v7 usage into a pipeline-kit UsageAccumulator.
 *
 * Each present field is recorded under its OTel GenAI key. Cache and
 * reasoning sub-fields are recorded under their OWN keys and are NOT
 * summed into the parent totals — non-additivity is preserved by-construction.
 *
 * Missing fields (undefined) are silently skipped; no zero records are emitted.
 */
export function recordVercelUsage(usage: VercelUsageV7, accumulator: UsageAccumulator): void {
  // Top-level totals — already inclusive of all sub-fields.
  if (usage.inputTokens !== undefined) {
    accumulator.record(GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens);
  }
  if (usage.outputTokens !== undefined) {
    accumulator.record(GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens);
  }

  // Input sub-fields — descriptive, not additive to parent.
  const inputDetails = usage.inputTokenDetails;
  if (inputDetails !== undefined) {
    if (inputDetails.cacheReadTokens !== undefined) {
      accumulator.record(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ, inputDetails.cacheReadTokens);
    }
    if (inputDetails.cacheWriteTokens !== undefined) {
      accumulator.record(GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE, inputDetails.cacheWriteTokens);
    }
    // Accept both spellings; noCacheTokens takes precedence when both present.
    const noCache = inputDetails.noCacheTokens ?? inputDetails.nonCachedTokens;
    if (noCache !== undefined) {
      accumulator.record(GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE, noCache);
    }
  }

  // Output sub-fields — descriptive, not additive to parent.
  const outputDetails = usage.outputTokenDetails;
  if (outputDetails !== undefined) {
    if (outputDetails.reasoningTokens !== undefined) {
      accumulator.record(GEN_AI_USAGE_OUTPUT_TOKENS_REASONING, outputDetails.reasoningTokens);
    }
    if (outputDetails.textTokens !== undefined) {
      accumulator.record(GEN_AI_USAGE_OUTPUT_TOKENS_TEXT, outputDetails.textTokens);
    }
  }
}
