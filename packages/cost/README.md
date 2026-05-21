# @idriszade/cost

Pipeline-kit cost pack — bundled pricing snapshot + `createCostCalculator` factory.

Pure computation pack: no external API calls at runtime. Enables dollar-valued budgets by returning a `CostEvent` with a 4-axis cost breakdown (input / output / cacheWrite / cacheRead).

## Usage

```ts
import { createCostCalculator } from '@idriszade/cost';

const calc = createCostCalculator();

const result = calc.compute(
  { inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 50_000 },
  'claude-sonnet-4-7',
  'anthropic',
);

if (result.error) {
  console.error(result.error.code, result.error.message);
} else {
  console.log(result.data.totalCost); // USD
}
```

## Anthropic prompt caching

Anthropic bills prompt caching with a 4-field model: `inputTokens`, `outputTokens`, `cacheWriteTokens`, and `cacheReadTokens`. Each maps to a distinct per-token price tier:

| Field | Price tier |
|---|---|
| `inputTokens` | Standard input price |
| `outputTokens` | Standard output price |
| `cacheWriteTokens` | Cache write — 5-minute TTL (default write tier) |
| `cacheReadTokens` | Cache read — significantly cheaper than input |

`cacheWriteTokens` in `TokenUsage` maps to the **5-minute write tier** price (`cacheWrite5m`). There is no separate `TokenUsage` field for the 1-hour write tier; use `customPrices` if you need 1-hour write billing.

Anthropic multiplier relationships (verified in tests):

- `cacheWrite5m = 1.25 × input`
- `cacheWrite1h = 2.00 × input`
- `cacheRead    = 0.10 × input`

## OpenAI cache billing

OpenAI charges a 50% discount on cached input reads but does **not** charge separately for cache writes. Accordingly, `cacheWriteCost` is always `0` for OpenAI models. `cacheReadCost` is computed from `cacheReadTokens × price.cacheRead / 1_000_000`.

## Pricing accuracy stance

> **Pricing accuracy stance.** This snapshot is best-effort current as of `LAST_UPDATED`. LLM pricing changes ~quarterly; pin a version and supply a `customPrices` override for contract or self-hosted rates. The `LAST_UPDATED` constant is emitted at debug level so staleness is surfaced at runtime. We do not ship a pricing-version field on cost events — consumers responsible for accuracy.

### Custom prices

Supply a `customPrices` map to override individual model entries. Each custom entry fully replaces the bundled entry for that key:

```ts
const calc = createCostCalculator({
  customPrices: {
    'anthropic:claude-sonnet-4-7': {
      input: 2.50,   // negotiated rate
      output: 12.00,
      cacheWrite5m: 3.00,
      cacheWrite1h: 5.00,
      cacheRead: 0.25,
    },
  },
});
```

## Bundled models (`LAST_UPDATED: 2026-05-20`)

| Key | input | output | cacheRead |
|---|---|---|---|
| `anthropic:claude-sonnet-4-7` | 3.00 | 15.00 | 0.30 |
| `anthropic:claude-sonnet-4-6` | 3.00 | 15.00 | 0.30 |
| `anthropic:claude-haiku-4-5` | 0.80 | 4.00 | 0.08 |
| `anthropic:claude-opus-4-7` | 15.00 | 75.00 | 1.50 |
| `openai:gpt-5` | 10.00 | 40.00 | 5.00 |
| `openai:gpt-5-mini` | 1.10 | 4.40 | 0.55 |
| `openai:gpt-4.1` | 2.00 | 8.00 | 1.00 |
| `openai:gpt-4o` | 2.50 | 10.00 | 1.25 |
| `openai:gpt-4o-mini` | 0.15 | 0.60 | 0.075 |
| `meta:llama-3.3-70b` | 0.59 | 0.79 | 0 |
| `deepseek:deepseek-v3` | 0.27 | 1.10 | 0.07 |
| `alibaba:qwen-3-235b-a22b` | 0.60 | 2.40 | 0.15 |

All prices per 1M tokens, USD.

## API

### `createCostCalculator(opts?): CostCalculator`

Factory function. Returns a `CostCalculator` instance with a closed-over pricing table.

### `CostCalculator.compute(usage, model, provider): Result<CostEvent, CostError>`

Param order: `usage`, `model`, `provider`.

Returns `Result<CostEvent, CostError>` — never throws. Error codes:

- `'unknown_model'` — no price entry for `${provider}:${model}` in merged prices.
- `'invalid_usage'` — Zod validation failure (negative counts, fractional tokens, empty strings).

## ADR

ADR X-4: cost derivation is adapter-tier only; core has no pricing tables.
