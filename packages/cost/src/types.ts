/**
 * Core types for @idriszade/cost.
 *
 * TokenUsage: the 4-field Anthropic-cache-accurate input shape.
 * CostEvent: the computed output written back by createCostCalculator.
 * CostError / CostErrorCode: discriminated error for Result<CostEvent, CostError>.
 *
 * ADR X-4: cost derivation is adapter-tier only; core has no pricing tables.
 */

/** Billable token counts for a single LLM call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to cache (5-minute tier). Defaults to 0 if omitted. */
  cacheWriteTokens?: number;
  /** Tokens read from cache. Defaults to 0 if omitted. */
  cacheReadTokens?: number;
}

/** Fully computed cost breakdown for a single LLM call. */
export interface CostEvent {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** USD cost for input tokens. */
  inputCost: number;
  /** USD cost for output tokens. */
  outputCost: number;
  /** USD cost for cache-write tokens. 0 for providers without a write charge. */
  cacheWriteCost: number;
  /** USD cost for cache-read tokens. */
  cacheReadCost: number;
  /** totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost */
  totalCost: number;
  /** ISO 8601 timestamp at time of compute() call. */
  pricedAt: string;
}

/** Error codes returned by CostCalculator.compute(). */
export type CostErrorCode = 'unknown_model' | 'invalid_usage';

/** Structured error returned inside Result.error from compute(). */
export interface CostError {
  code: CostErrorCode;
  message: string;
}
