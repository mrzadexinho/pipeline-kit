/**
 * createCostCalculator — factory for the @idriszade/cost CostCalculator.
 *
 * Returns a CostCalculator whose compute() method:
 *   1. Validates TokenUsage + model + provider via Zod (invalid_usage on failure).
 *   2. Resolves merged price entry (PRICES + customPrices); unknown_model if absent.
 *   3. Computes the 4-axis cost breakdown (input / output / cacheWrite / cacheRead).
 *   4. Emits LAST_UPDATED via console.debug on the first compute() call per instance.
 *   5. Returns Result<CostEvent, CostError> — never throws.
 *
 * Implementation rules:
 *   - cacheWriteTokens maps to cacheWrite5m price (5-min tier is default).
 *   - OpenAI: cacheWriteCost = 0 (no separate write charge on OpenAI models).
 *   - totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost (invariant).
 *   - customPrices shallow-merges over PRICES: { ...PRICES, ...customPrices }.
 *
 * ADR X-4.
 */

import { LAST_UPDATED, PRICES } from './prices.js';
import { ModelSchema, ProviderSchema, TokenUsageSchema } from './schema.js';
import type { CostError, CostEvent, TokenUsage } from './types.js';

// ─── Result helpers (inline to avoid coupling to @idriszade/core) ─────────────

type Result<T, E> = { data: T; error: null } | { data: null; error: E };
const ok = <T>(data: T): Result<T, never> => ({ data, error: null });
const err = <E>(error: E): Result<never, E> => ({ data: null, error });

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-model price entry shape. All values are per 1M tokens, USD. */
interface PriceEntry {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** Options accepted by createCostCalculator. */
export interface CostCalculatorOptions {
  /**
   * Custom price entries that shallow-merge over the bundled PRICES snapshot.
   * Each key fully replaces the model entry it matches (all 5 sub-fields required).
   * Use for contract pricing, self-hosted models, or pricing snapshots newer than LAST_UPDATED.
   */
  customPrices?: Partial<Record<string, PriceEntry>>;
}

/** Calculator instance returned by createCostCalculator. */
export interface CostCalculator {
  /**
   * Compute the cost breakdown for a single LLM call.
   *
   * @param usage  - Token counts (Zod-validated at entry; invalid_usage on failure).
   * @param model  - Model identifier (e.g. "claude-sonnet-4-7").
   * @param provider - Provider identifier (e.g. "anthropic").
   *
   * Param order: usage, model, provider.
   */
  compute(usage: TokenUsage, model: string, provider: string): Result<CostEvent, CostError>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a CostCalculator with an optional customPrices override.
 *
 * LAST_UPDATED is emitted via console.debug on the first compute() call per instance.
 * This surfaces pricing staleness at runtime without spamming per-call.
 */
export function createCostCalculator(opts?: CostCalculatorOptions): CostCalculator {
  const mergedPrices: Record<string, PriceEntry | undefined> = {
    ...(PRICES as unknown as Record<string, PriceEntry>),
    ...(opts?.customPrices ?? {}),
  };

  let loggedOnce = false;

  return {
    compute(usage: TokenUsage, model: string, provider: string): Result<CostEvent, CostError> {
      // Emit LAST_UPDATED once per instance on first compute call.
      if (!loggedOnce) {
        console.debug(`[@idriszade/cost] pricing snapshot LAST_UPDATED=${LAST_UPDATED}`);
        loggedOnce = true;
      }

      // Validate model and provider strings.
      const modelParse = ModelSchema.safeParse(model);
      const providerParse = ProviderSchema.safeParse(provider);
      if (!modelParse.success || !providerParse.success) {
        return err<CostError>({
          code: 'invalid_usage',
          message: 'model and provider must be non-empty strings',
        });
      }

      // Validate TokenUsage at Zod boundary.
      const usageParse = TokenUsageSchema.safeParse(usage);
      if (!usageParse.success) {
        return err<CostError>({
          code: 'invalid_usage',
          message: `invalid token usage: ${usageParse.error.issues.map((i) => i.message).join('; ')}`,
        });
      }

      const validated = usageParse.data;

      // Resolve price entry.
      const priceKey = `${provider}:${model}`;
      const price = mergedPrices[priceKey];
      if (price === undefined) {
        return err<CostError>({
          code: 'unknown_model',
          message: `no price entry for "${priceKey}"; supply via customPrices if needed`,
        });
      }

      // Normalise optional fields.
      const cacheWriteTokens = validated.cacheWriteTokens ?? 0;
      const cacheReadTokens = validated.cacheReadTokens ?? 0;

      // Compute costs. cacheWriteTokens maps to cacheWrite5m (5-min tier is default).
      const inputCost = (validated.inputTokens * price.input) / 1_000_000;
      const outputCost = (validated.outputTokens * price.output) / 1_000_000;
      // OpenAI has no write charge; their price.cacheWrite5m is 0, so this is naturally 0.
      const cacheWriteCost = (cacheWriteTokens * price.cacheWrite5m) / 1_000_000;
      const cacheReadCost = (cacheReadTokens * price.cacheRead) / 1_000_000;
      const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

      const event: CostEvent = {
        provider,
        model,
        inputTokens: validated.inputTokens,
        outputTokens: validated.outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        inputCost,
        outputCost,
        cacheWriteCost,
        cacheReadCost,
        totalCost,
        pricedAt: new Date().toISOString(),
      };

      return ok(event);
    },
  };
}
