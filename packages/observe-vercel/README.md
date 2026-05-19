# @idriszade/observe-vercel

Vercel AI SDK v7 usage shim for pipeline-kit. Maps the nested `inputTokenDetails.*` / `outputTokenDetails.*` fields from a v7 `LanguageModelUsage` object into a `UsageAccumulator` using the OTel GenAI v1.37 key constants from `@idriszade/observe`. Non-additivity is preserved by construction — cache and reasoning sub-fields are recorded under their own keys and never summed into the parent totals.

## Installation

```bash
pnpm add @idriszade/observe-vercel
```

## Quick start

```ts
import { UsageAccumulator } from '@idriszade/core';
import { recordVercelUsage } from '@idriszade/observe-vercel';

// Typical v7 usage object from generateText / streamText.
const usage = {
  inputTokens: 500,
  outputTokens: 120,
  inputTokenDetails: {
    cacheReadTokens: 350,
    cacheWriteTokens: 0,
  },
  outputTokenDetails: {
    reasoningTokens: 40,
    textTokens: 80,
  },
};

const acc = new UsageAccumulator();
recordVercelUsage(usage, acc);

acc.get('gen_ai.usage.input_tokens');              // 500
acc.get('gen_ai.usage.input_tokens.cache_read');   // 350
acc.get('gen_ai.usage.output_tokens');             // 120
acc.get('gen_ai.usage.output_tokens.reasoning');   // 40
```

Fields that are `undefined` are silently skipped — no zero records are emitted.

## Non-additivity

Cache and reasoning sub-fields are **descriptive** — they describe how the parent total was composed. Do not add them to the parent yourself.

See `@idriszade/observe` — [Cache tokens are non-additive](../observe/README.md#cache-tokens-are-non-additive) for the full explanation, reference, and code example.

## v7 vs v6 migration

Vercel AI SDK v7 changed how sub-token counts are surfaced:

- Top-level `cachedInputTokens` field **removed**.
- Top-level `reasoningTokens` field **removed**.
- Sub-counts now live exclusively under `inputTokenDetails.cacheReadTokens`, `inputTokenDetails.cacheWriteTokens`, `outputTokenDetails.reasoningTokens`, `outputTokenDetails.textTokens`.
- `inputTokens` / `outputTokens` at the top level remain the **inclusive totals** — unchanged from v6.

`recordVercelUsage` accepts the v7 shape. If you are on v6 and passing a legacy object with top-level `cachedInputTokens`, those fields are not read; migrate to v7 `inputTokenDetails` first.

## API

### `recordVercelUsage(usage, accumulator)`

```ts
import type { VercelUsageV7 } from '@idriszade/observe-vercel';

function recordVercelUsage(usage: VercelUsageV7, accumulator: UsageAccumulator): void;
```

`VercelUsageV7` mirrors the Vercel AI SDK v7 `LanguageModelUsage` shape with all fields optional to tolerate partial payloads from streaming responses.

## License — MIT
