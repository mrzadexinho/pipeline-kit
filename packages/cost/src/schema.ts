/**
 * Zod boundary schema for TokenUsage validation at compute() entry.
 *
 * All token counts must be non-negative integers.
 * model and provider must be non-empty strings.
 *
 * Kept in a separate file so it can be imported without pulling
 * in the full calculator factory (useful for testing schema alone).
 */

import { z } from 'zod';

/** Non-negative integer validator reused across all token-count fields. */
const nonNegativeInt = z.number().int().nonnegative();

/** Validated shape for TokenUsage at the compute() boundary. */
export const TokenUsageSchema = z.object({
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  cacheWriteTokens: nonNegativeInt.optional(),
  cacheReadTokens: nonNegativeInt.optional(),
});

/** Validated model string (non-empty). */
export const ModelSchema = z.string().min(1);

/** Validated provider string (non-empty). */
export const ProviderSchema = z.string().min(1);
