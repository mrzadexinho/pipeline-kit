# @idriszade/cost — Pricing Refresh Cadence

> Process reference for maintainers and consumers of the bundled pricing snapshot.
> Cross-reference: [`packages/cost/README.md`](../README.md) — accuracy stance + `customPrices` API.

---

## Cadence

The bundled `PRICES` table is a **best-effort snapshot**; it is not auto-updated at runtime.
LLM providers change pricing roughly quarterly. The maintainer is responsible for:

1. Monitoring provider pricing pages (Anthropic, OpenAI, Meta, DeepSeek, Alibaba) every quarter.
2. Opening a PR that updates `PRICES` in `src/prices.ts` when any entry diverges from the
   published rate by more than a trivial rounding difference.
3. Shipping the update as a **patch** bump if no entry is removed; a **minor** bump if a new
   model key is added; a **major** bump only if the key format or exported API changes.

Trigger: any provider publishes a new pricing page, deprecates a model, or a new flagship model
ships that belongs in the default table.

Industry precedent: LiteLLM's `model_prices_and_context_window.json` is committed as a versioned
pricing snapshot with explicit CHANGELOG entries for each update — this kit follows the same
discipline.

---

## CHANGELOG Discipline

Every change to the `PRICES` table in `src/prices.ts` **must** include a CHANGELOG entry in the
**same commit**. Do not ship a pricing diff without a `CHANGELOG.md` update.

Minimum required entry fields:
- Date (ISO 8601)
- Which model keys changed (added / updated / removed)
- Direction of change (increase / decrease / new)
- Source URL confirming the new rate

Example entry (in `packages/cost/CHANGELOG.md`):

```md
# [patch] 2026-08-12

### Changed
- `anthropic:claude-sonnet-4-7` input: 3.00 → 2.50 USD/1M tokens
  Source: https://www.anthropic.com/pricing (2026-08-12)
- `openai:gpt-5` output: 40.00 → 35.00 USD/1M tokens
  Source: https://openai.com/pricing (2026-08-12)
```

Rationale: consumers who pin a version and read the CHANGELOG can audit exactly which rates
changed between their pinned version and the latest. Without CHANGELOG discipline this audit
trail is lost.

---

## `LAST_UPDATED` Discipline

`LAST_UPDATED` in `src/prices.ts` is the canonical staleness signal for this package.

Rules:
- **Must be bumped in the same commit** as any `PRICES` table change. Never commit a `PRICES`
  change without also updating `LAST_UPDATED` to the ISO 8601 date of the commit.
- **Must never drift** ahead of or behind the actual snapshot date. If you update prices on
  2026-08-12, `LAST_UPDATED` must be `'2026-08-12'`, not a future date or a copy-paste of the
  previous value.
- The constant is emitted at debug level on the first `compute()` call per calculator instance,
  so staleness is surfaced at runtime without extra overhead. Consumers can observe it via their
  logger at `DEBUG` level.

Verification: CI does not enforce `LAST_UPDATED` consistency automatically. The maintainer must
treat the two edits (`PRICES` + `LAST_UPDATED`) as an atomic unit in every pricing PR.

---

## Consumer Responsibility

**Pin `@idriszade/cost` to a specific version** when using it for any billing-critical computation.

Why pinning matters:
- LLM pricing changes are unannounced. A patch bump to this package may silently change the
  dollar value returned by `compute()` for a given token count.
- Floating `^version` means a `pnpm update` could pull in a pricing change mid-billing-period,
  causing your application to bill consumers at a different rate than was in effect when they
  started a session.
- The `LAST_UPDATED` constant documents when your pinned snapshot was captured. If the difference
  between `LAST_UPDATED` and today exceeds one quarter, consider upgrading and reviewing the diff.

Recommended pattern for billing-critical systems:

```json
{
  "dependencies": {
    "@idriszade/cost": "0.1.4"
  }
}
```

Use an exact version (no `^` or `~`). Upgrade intentionally after reviewing the CHANGELOG.

If your contract rates differ from the bundled snapshot (negotiated enterprise rates, self-hosted
inference at custom cost), use `customPrices` — see §`customPrices` override workflow below and
the full API reference in [`README.md`](../README.md).

---

## `customPrices` Override Workflow

`customPrices` fully replaces the bundled entry for any model key it specifies. Use it to
supply contract rates, self-hosted inference costs, or 1-hour cache-write billing when your
workload depends on that tier.

**Basic per-model override:**

```ts
import { createCostCalculator } from '@idriszade/cost';

const calc = createCostCalculator({
  customPrices: {
    // Negotiated enterprise rate for claude-sonnet-4-7
    'anthropic:claude-sonnet-4-7': {
      input: 2.50,        // USD per 1M input tokens
      output: 12.00,      // USD per 1M output tokens
      cacheWrite5m: 3.00, // USD per 1M 5-min cache-write tokens
      cacheWrite1h: 5.00, // USD per 1M 1-hour cache-write tokens
      cacheRead: 0.25,    // USD per 1M cache-read tokens
    },
  },
});

const result = calc.compute(
  { inputTokens: 500_000, outputTokens: 100_000 },
  'claude-sonnet-4-7',
  'anthropic',
);
```

**Self-hosted / open-source model at known compute cost:**

```ts
const calc = createCostCalculator({
  customPrices: {
    'meta:llama-3.3-70b': {
      input: 0.10,        // internal GPU cost per 1M tokens
      output: 0.40,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    },
  },
});
```

**Notes:**
- `customPrices` entries take precedence over the bundled `PRICES` table at calculator
  construction time. No runtime lookups; the merged table is built once in `createCostCalculator`.
- Unspecified models fall back to the bundled snapshot automatically.
- For 1-hour cache-write billing: there is no separate `cacheWriteTokens1h` field in
  `TokenUsage`; supply the rate in `cacheWrite1h` and remap usage manually or file an issue
  requesting a `TokenUsage` extension.
- Full API reference, accuracy stance, and the bundled model table:
  [`packages/cost/README.md`](../README.md).
