/**
 * Vercel AI SDK v7 usage shape — mapped FROM by recordVercelUsage.
 *
 * Top-level `cachedInputTokens` and `reasoningTokens` were removed in v7.
 * Cache and reasoning tokens now live as nested sub-fields under
 * `inputTokenDetails` / `outputTokenDetails`. The parent totals
 * (`inputTokens`, `outputTokens`) are already-inclusive — sub-fields
 * are descriptive, NOT additive.
 */

export interface VercelInputTokenDetails {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Primary spelling in Vercel AI SDK v7. */
  noCacheTokens?: number;
  /** Alternate spelling observed in some v7 builds — accepted for compatibility. */
  nonCachedTokens?: number;
}

export interface VercelOutputTokenDetails {
  reasoningTokens?: number;
  textTokens?: number;
}

export interface VercelUsageV7 {
  /** Total input tokens (inclusive — cache sub-fields are NOT additive). */
  inputTokens?: number;
  /** Total output tokens (inclusive — reasoning sub-field is NOT additive). */
  outputTokens?: number;
  /** Typically inputTokens + outputTokens. */
  totalTokens?: number;
  inputTokenDetails?: VercelInputTokenDetails;
  outputTokenDetails?: VercelOutputTokenDetails;
}
