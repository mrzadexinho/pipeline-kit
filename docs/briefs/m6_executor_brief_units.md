# M6 Executor Brief — Unit Drilldown

> This document is the per-unit detail companion to [`m6_executor_brief.md`](m6_executor_brief.md).
> Read the entry brief first for wave sequencing, risk flags, working rules, and verification gates.
> Per-unit working rules apply per the entry brief ("per working rules in entry brief").

---

## Unit 1 — HMAC `verifyWebhook` export

### Objective

Add a general-purpose raw-payload HMAC verifier symmetric to the existing `sign()` function. Distinct from existing `verify()` (domain-typed for `PipelineKitEvent` inbound events). The new `verifyWebhook()` is for Serve adapter authors verifying arbitrary inbound payloads.

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/webhooks/verify-webhook.ts` | **NEW** — `verifyWebhook` implementation |
| `packages/core/src/webhooks/types.ts` | extend — add `VerifyError`, `VerifyWebhookOptions` |
| `packages/core/src/webhooks/index.ts` | extend — export `verifyWebhook` + `VerifyError` |
| `packages/core/src/index.ts` | extend — re-export `verifyWebhook` + `VerifyError` |
| `packages/core/tests/webhooks/verify-webhook.test.ts` | **NEW** — unit + property tests |

### Type shapes

```ts
// packages/core/src/webhooks/types.ts additions

export interface VerifyWebhookOptions {
  tolerance?: number;   // ms; default 300_000 (300s)
  prefix?: string;      // signature header prefix; default 'v1'
}

export type VerifyErrorCode =
  | 'signature_mismatch'
  | 'timestamp_expired'
  | 'malformed_header';

export interface VerifyError {
  code: VerifyErrorCode;
  message: string;
}
```

```ts
// packages/core/src/webhooks/verify-webhook.ts (signature)

export function verifyWebhook(
  payload: Buffer | string,
  signatureHeader: string,
  secret: string | string[],
  opts?: VerifyWebhookOptions,
): Result<true, VerifyError>;
```

### Implementation rules

- `crypto.timingSafeEqual` for HMAC comparison (Node 20+ canonical; already used in existing `verify.ts`).
- `secret: string | string[]` — normalise to array internally; try each key in sequence, return `ok(true)` on first match. Return `err({ code: 'signature_mismatch' })` only after all keys exhausted.
- Default tolerance: `300_000` ms (300 seconds — Stripe/Svix/Slack convergent industry default).
- Header format: `t=<unix_seconds>,<prefix>=<hex>` (same format produced by `sign()`). Extract `parseHeader` logic from existing `verify.ts` as a shared private helper or inline (<15 LOC).
- `prefix` option defaults to `'v1'` (matches `sign()` default algorithm).
- Signed payload construction: `${timestamp}.${rawPayload}`. For `Buffer` input, convert to UTF-8 string before hashing.
- Return type is `Result<true, VerifyError>` — raw crypto primitive; does NOT parse or return a typed domain event.
- No thrown errors crossing the public API boundary.
- Add TSDoc to both `verify()` and `verifyWebhook()` distinguishing their use cases. Do NOT rename existing `verify()`.

### Acceptance criteria

- [ ] `verifyWebhook(payload, sign(payload, secret), secret)` returns `ok(true)`.
- [ ] Returns `err({ code: 'malformed_header' })` for header not in `t=...,v1=...` format.
- [ ] Returns `err({ code: 'timestamp_expired' })` when drift exceeds tolerance.
- [ ] Returns `err({ code: 'signature_mismatch' })` when no secret in array matches.
- [ ] Multi-key rotation: `verifyWebhook(p, sign(p, s2), [s1, s2])` returns `ok(true)`.
- [ ] Custom `prefix` option works (e.g., `prefix: 'sha256'`).
- [ ] Custom `tolerance` overrides 300s default.
- [ ] Property test (fast-check): `verifyWebhook(payload, sign(payload, s), s)` is always `ok(true)` for any non-empty payload + secret.
- [ ] No thrown errors for any input combination (adversarial: empty strings, non-hex signatures, future/past timestamps).

### Dependencies

None. Wave 1 independent.

### ADR ref

M5 carry-forward #2 (`docs/briefs/m5_report_back.md` §Carry-forwards, item 2).

### Industry reference points

- Stripe webhook tolerance: 300s default; multi-key rotation pattern (old + new key simultaneously valid).
- Svix: same 300s; multi-secret for rotation via `WebhookVerifier([secret1, secret2])`.
- Slack: 300s tolerance; single secret; `v0=<hmac-sha256>` prefix.
- GitHub: 300s tolerance; `sha256=<hmac>` prefix. All four converge on `t=<ts>,<prefix>=<hex>` or equivalent.

---

## Unit 2 — `@idriszade/cost` package

### Objective

Ship the `@idriszade/cost` pack: bundled TypeScript pricing snapshot + `createCostCalculator` factory. Enables dollar-valued budgets in Unit 4 by writing a `cost.usd` key back to `ctx.usage`. Pure computation pack — no external API calls at runtime.

### Files touched

| File | Action |
|------|--------|
| `packages/cost/package.json` | **NEW** |
| `packages/cost/tsconfig.json` | **NEW** (mirror `packages/eval/tsconfig.json` pattern) |
| `packages/cost/src/index.ts` | **NEW** — public API barrel |
| `packages/cost/src/types.ts` | **NEW** — `CostEvent`, `TokenUsage`, `CostError` |
| `packages/cost/src/prices.ts` | **NEW** — bundled pricing snapshot + `LAST_UPDATED` |
| `packages/cost/src/calculator.ts` | **NEW** — `createCostCalculator` factory |
| `packages/cost/src/schema.ts` | **NEW** — Zod schema for `TokenUsage` boundary validation |
| `packages/cost/tests/calculator.test.ts` | **NEW** — unit + property tests |
| `packages/cost/README.md` | **NEW** — stance doc (required content below) |
| `pnpm-workspace.yaml` | verify — confirm glob covers `packages/cost` |

### Type shapes

```ts
// packages/cost/src/types.ts

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;   // defaults to 0 if omitted
  cacheReadTokens?: number;    // defaults to 0 if omitted
}

export interface CostEvent {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  inputCost: number;           // USD
  outputCost: number;          // USD
  cacheWriteCost: number;      // USD
  cacheReadCost: number;       // USD
  totalCost: number;           // USD; = inputCost + outputCost + cacheWriteCost + cacheReadCost
  pricedAt: string;            // ISO 8601 at time of compute() call
}

export type CostErrorCode = 'unknown_model' | 'invalid_usage';

export interface CostError {
  code: CostErrorCode;
  message: string;
}
```

```ts
// packages/cost/src/calculator.ts (public API)

export interface CostCalculatorOptions {
  customPrices?: Partial<typeof PRICES>;
}

export interface CostCalculator {
  compute(
    usage: TokenUsage,
    model: string,
    provider: string,
  ): Result<CostEvent, CostError>;
}

export function createCostCalculator(opts?: CostCalculatorOptions): CostCalculator;
```

### Pricing snapshot (`packages/cost/src/prices.ts`)

Key format: `${provider}:${model}`. All prices per 1M tokens USD.

| Key | input | output | cacheWrite5m | cacheWrite1h | cacheRead |
|-----|-------|--------|-------------|-------------|-----------|
| `anthropic:claude-sonnet-4-7` | 3.00 | 15.00 | 3.75 | 6.00 | 0.30 |
| `anthropic:claude-sonnet-4-6` | 3.00 | 15.00 | 3.75 | 6.00 | 0.30 |
| `anthropic:claude-haiku-4-5` | 0.80 | 4.00 | 1.00 | 1.60 | 0.08 |
| `anthropic:claude-opus-4-7` | 15.00 | 75.00 | 18.75 | 30.00 | 1.50 |
| `openai:gpt-5` | 10.00 | 40.00 | 0 | 0 | 5.00 |
| `openai:gpt-5-mini` | 1.10 | 4.40 | 0 | 0 | 0.55 |
| `openai:gpt-4.1` | 2.00 | 8.00 | 0 | 0 | 1.00 |
| `openai:gpt-4o` | 2.50 | 10.00 | 0 | 0 | 1.25 |
| `openai:gpt-4o-mini` | 0.15 | 0.60 | 0 | 0 | 0.075 |
| `meta:llama-3.3-70b` | 0.59 | 0.79 | 0 | 0 | 0 |
| `deepseek:deepseek-v3` | 0.27 | 1.10 | 0 | 0 | 0.07 |
| `alibaba:qwen-3-235b-a22b` | 0.60 | 2.40 | 0 | 0 | 0.15 |

Anthropic multiplier rules (for verification in tests): `cacheWrite5m = 1.25 × input`, `cacheWrite1h = 2 × input`, `cacheRead = 0.1 × input`.

```ts
export const LAST_UPDATED = '2026-05-20';
export const PRICES = { ... } as const;
export type PriceKey = keyof typeof PRICES;
```

### Implementation rules

- Override semantics: `{ ...PRICES, ...customPrices }` shallow merge. Custom entry replaces entire model entry.
- `cacheWriteTokens` in `TokenUsage` maps to `cacheWrite5m` price (5-minute write is the default cache tier). Document in README.
- OpenAI: `cacheWriteCost = 0` (no separate write charge); `cacheReadCost = cacheReadTokens * price.cacheRead / 1_000_000`.
- `totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost` (arithmetic invariant; enforced by property test).
- `pricedAt = new Date().toISOString()` at `compute()` call time.
- `LAST_UPDATED` constant is logged via `console.debug` on first `compute()` call per calculator instance (once, not once per call).
- Zod schema validates `TokenUsage` at `compute()` entry: all counts non-negative integers, `model` + `provider` non-empty strings.
- `unknown_model` error when `${provider}:${model}` key not in merged prices.
- `invalid_usage` error when Zod schema rejects input.
- `Result<T,E>` return — no thrown errors.

### README stance (required content)

README must state: best-effort pricing snapshot; pin package version for billing accuracy; `customPrices` override available; `LAST_UPDATED: 2026-05-20` logged at debug on first compute per instance. Must include Anthropic prompt caching section explaining the 4-field model (`inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens`) and that `cacheWriteTokens` maps to the 5-minute write tier price.

> **Pricing accuracy stance.** This snapshot is best-effort current as of `LAST_UPDATED`. LLM pricing changes ~quarterly; pin a version and supply a `customPrices` override for contract or self-hosted rates. The `LAST_UPDATED` constant is emitted at debug level so staleness is surfaced at runtime. We do not ship a pricing-version field on cost events — consumers responsible for accuracy.

### Acceptance criteria

- [ ] `compute({ inputTokens: 1_000_000, outputTokens: 0, ... }, 'claude-sonnet-4-7', 'anthropic')` returns `inputCost: 3.00`.
- [ ] Anthropic cache: `cacheWriteCost = cacheWriteTokens * 3.75 / 1_000_000` for sonnet-4-7.
- [ ] Anthropic cache: `cacheReadCost = cacheReadTokens * 0.30 / 1_000_000` for sonnet-4-7.
- [ ] OpenAI: `cacheWriteCost = 0` for any OpenAI model.
- [ ] `totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost` (exact arithmetic).
- [ ] Custom price override replaces the full model entry.
- [ ] `unknown_model` error for unrecognised model key.
- [ ] `invalid_usage` error for negative token counts.
- [ ] Property test: `totalCost >= 0` for all non-negative token inputs on any known model.
- [ ] Property test: `totalCost === inputCost + outputCost + cacheWriteCost + cacheReadCost` invariant.
- [ ] `LAST_UPDATED` is logged once per calculator instance on first `compute()`.

### Dependencies

None. Wave 1 independent.

### ADR ref

ADR X-4 (`docs/spec-v1-cross-cutting.md` §X, X-4): "Cost derivation is adapter-tier only; core has no pricing tables."

### Industry reference points

- Anthropic API pricing: 4-field model (input, output, cache-write-5m, cache-read) is the canonical billing shape; `cacheWriteTokens` maps to 5m write tier.
- LiteLLM `completion_cost()`: bundled `model_prices_and_context_window.json` is the precedent for a static snapshot file.
- OpenAI cache pricing: 50% of input price; no separate write charge — explains `cacheWriteCost = 0` for OpenAI models.

---

## Unit 3 — Rate-limit RunGuard shape

### Objective

Extend `RunGuard` from 5-shape to 6-shape by adding an optional `rateLimit` field. `RunGuard` remains a pure declaration — zero enforcement in kit-core. `InProcessRateLimitStore` is the reference implementation. `RateLimitStore` interface declared for future distributed adapters (Redis deferred to M7).

**ADR X-5 amendment note:** `rateLimit` in `RunGuard` is a **declaration**, not enforcement — ADR X-5 ("adapter-tier only") is preserved. ADR amendment adds one paragraph documenting this; no ADR direction reversal.

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/trigger.ts` | extend — add `rateLimit?` field to `RunGuard`; add `RateLimitStore` + `RateLimitResult` types |
| `packages/core/src/rate-limit/in-process-store.ts` | **NEW** — `InProcessRateLimitStore` (LRU + sliding-window log) |
| `packages/core/src/rate-limit/index.ts` | **NEW** — barrel export |
| `packages/core/src/index.ts` | extend — export `RateLimitStore`, `RateLimitResult`, `InProcessRateLimitStore` |
| `packages/core/tests/rate-limit/rate-limit.test.ts` | **NEW** — unit + property tests |
| `packages/core/tests/rate-limit/rate-limit-integration.test.ts` | **NEW** — fake-timer integration tests |

### Type shapes

```ts
// packages/core/src/trigger.ts additions

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;   // 0 when allowed
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult>;
}

// RunGuard interface gains:
rateLimit?: {
  kind: 'rateLimit';
  key: (ctx: { runId: string; metadata?: Record<string, unknown> }) => string;
  limit: number;
  window: string;              // '10s' | '1m' | '24h'
  discardExcess: boolean;      // true = discard (Inngest rateLimit); false = delay (throttle)
  store?: RateLimitStore;      // default: InProcessRateLimitStore
};
```

**Note on `ctx` type in `key` function:** Use a minimal inline type `{ runId: string; metadata?: Record<string, unknown> }` rather than importing `PipelineContext` — avoids circular import risk between `trigger.ts` and `context.ts`. If `PipelineContext` is already imported in `trigger.ts`, use it directly.

### In-process store implementation

- Algorithm: sliding-window log (array of timestamps per key; prune expired entries on each `consume()` call).
- LRU eviction: max 1024 keys; use `Map<string, number[]>` with insertion-order eviction (delete oldest key when map size exceeds 1024).
- Window string parsing: support `s`, `m`, `h` suffixes. `'10s'` = 10_000ms, `'1m'` = 60_000ms, `'24h'` = 86_400_000ms. Parse at `consume()` call time.
- `remaining` = `limit - count(timestamps in window)`.
- `retryAfterMs` = `oldestTimestampInWindow + windowMs - Date.now()` when `allowed: false`, else 0.
- NOT safe for distributed use — single-process only. TSDoc: `@remarks Single-process only. For distributed rate limiting, use @idriszade/rate-limit-redis (M7).`

### CRITICAL: Fake-timer integration test constraint (M5 GHA flake lesson)

Window roll-over tests MUST: pin time with `vi.useFakeTimers({ now: Date.now() })`; advance ≤ 2_000ms per `vi.advanceTimersByTime()` call; test a `'6s'` window (3 × 2_000ms advances); never call `vi.runAllTimers()` or advance > 2_000ms in one step.

### Acceptance criteria

- [ ] `RunGuard` type compiles with and without `rateLimit` field.
- [ ] `InProcessRateLimitStore.consume()` returns `{ allowed: true, remaining: N-1, retryAfterMs: 0 }` for first request in window.
- [ ] After `limit` requests in window: `{ allowed: false, remaining: 0, retryAfterMs > 0 }`.
- [ ] Window roll-over: after window expires, counter resets; next request is allowed (fake-timer test ≤ 2_000ms advances).
- [ ] LRU: store handles 1025 distinct keys without error (oldest key evicted).
- [ ] `retryAfterMs <= windowMs` always.
- [ ] Property test: `count(allowed results) <= limit` for N concurrent consumers in same window.
- [ ] `'10s'` parses to 10_000ms; `'1m'` to 60_000ms; `'24h'` to 86_400_000ms.
- [ ] Invalid window format (e.g., `'5d'`) throws an error synchronously.

### Dependencies

None. Wave 1 independent.

### ADR ref

ADR X-5 amendment + IV-4 cross-reference (RunGuard 5-shape extended to 6-shape; declaration-only discipline preserved).

### Industry reference points

- Inngest `rateLimit`: declaration-only in function config; enforcement in Inngest Cloud — exact precedent for this pattern.
- Upstash `@upstash/ratelimit`: sliding-window log is the reference algorithm; `limit()` returns `{ success, limit, remaining, reset }` — `RateLimitResult` mirrors this shape.
- Redis ZADD sliding-window: standard distributed implementation that `RateLimitStore` interface must remain compatible with.

---

## Unit 4 — Cumulative budget tracking

### Objective

Add `BudgetCeiling` to `ComposerOpts`. The Composer checks ceilings between stage transitions by recomputing `BudgetAccumulation` from `run.steps[]` (NOT a mutable context field — Inngest replay safety). Uses `CostEvent` fields from Unit 2 as the per-step cost record. Emits `budget.warn` span event via OTel when `warnAtFraction` is reached. Returns `runtime_budget_exceeded` StageError (non-retriable) when ceiling is breached.

### StageErrorCode: reuse `runtime_budget_exceeded`

`runtime_budget_exceeded` **already exists** in `packages/core/src/stage-error.ts` (line 20 of the union) and is already mapped in `RETRYABILITY_MAP` as `'never'`. Do NOT add a new `budget_exceeded` code. Unit 4 must reference `'runtime_budget_exceeded'` everywhere — in the `BudgetCeiling` verdict, in `StageError.code`, in tests, and in documentation. No `stage-error.ts` modification needed for the code itself (only verify the `RETRYABILITY_MAP` entry is correct, which it is).

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/budget.ts` | extend — add `BudgetCeiling`, `BudgetAccumulation`, `BudgetCeilingVerdict`, `evaluateBudgetCeiling` |
| `packages/core/src/stage-error.ts` | **no change needed** — `runtime_budget_exceeded` already exists + retryable: false |
| `packages/core/src/composer/index.ts` | extend — `ComposerOpts.budgetCeiling?`; ceiling check between stages |
| `packages/core/src/composer/budget-accumulate.ts` | **NEW** — `recomputeAccumulation` pure function |
| `packages/core/src/index.ts` | extend — export `BudgetCeiling`, `BudgetAccumulation`, `BudgetCeilingVerdict`, `evaluateBudgetCeiling` |
| `packages/core/tests/budget/budget-ceiling.test.ts` | **NEW** — unit + property tests |

### Type shapes

```ts
// packages/core/src/budget.ts additions

export interface BudgetCeiling {
  maxDollars?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxRequests?: number;
  warnAtFraction?: number;   // default 0.80
}

export interface BudgetAccumulation {
  totalDollars: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
}

export type BudgetCeilingVerdict =
  | { status: 'ok' }
  | { status: 'warn'; fraction: number; axis: keyof Omit<BudgetCeiling, 'warnAtFraction'> }
  | { status: 'exceeded'; axis: keyof Omit<BudgetCeiling, 'warnAtFraction'>; current: number; limit: number };

export function evaluateBudgetCeiling(
  acc: BudgetAccumulation,
  ceiling: BudgetCeiling,
): BudgetCeilingVerdict;
```

```ts
// In packages/core/src/composer/index.ts (ComposerStep addition)
// Inline structural type — avoids making @idriszade/cost a hard dep of @idriszade/core
costEvent?: {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};
```

### Replay safety (BINDING)

`BudgetAccumulation` MUST be recomputed from `run.steps[]` at each stage boundary, NOT stored as a mutable field. The recompute function is a pure reducer:

```ts
// packages/core/src/composer/budget-accumulate.ts

import type { ComposerStep } from './index.js';

export function recomputeAccumulation(steps: readonly ComposerStep[]): BudgetAccumulation {
  let totalDollars = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const step of steps) {
    if (step.costEvent !== undefined) {
      totalDollars += step.costEvent.totalCost;
      totalInputTokens += step.costEvent.inputTokens;
      totalOutputTokens += step.costEvent.outputTokens;
    }
  }
  return {
    totalDollars,
    totalInputTokens,
    totalOutputTokens,
    totalRequests: steps.length,
  };
}
```

### Observe integration (budget.warn)

When `evaluateBudgetCeiling` returns `{ status: 'warn' }`, the Composer adds a span event:

```ts
span.addEvent('budget.warn', {
  'budget.fraction': verdict.fraction,
  'budget.axis': verdict.axis,
});
```

Passive — observe picks it up as a span event. No direct dependency from core on `@idriszade/observe`.

### Retry compound spend note (document in ADR amendment + README + TSDoc)

Retries compound spend: a 3-atom pipeline failing at atom 2 re-runs atoms 0 and 1; their costs appear again in `run.steps[]`. At 20% per-step failure rate, cumulative spend is ~2.2–2.5x baseline.

### Acceptance criteria

- [ ] `evaluateBudgetCeiling({ totalDollars: 0.08, ... }, { maxDollars: 0.10, warnAtFraction: 0.8 })` returns `{ status: 'warn' }` (0.08/0.10 = 80%).
- [ ] `evaluateBudgetCeiling({ totalDollars: 0.11, ... }, { maxDollars: 0.10 })` returns `{ status: 'exceeded' }`.
- [ ] `warn` check triggers before `exceeded` check in evaluation order.
- [ ] Composer with `budgetCeiling: { maxDollars: 0.01 }` returns `Result.err` with `code: 'runtime_budget_exceeded'` when ceiling breached.
- [ ] `runtime_budget_exceeded` is already in `StageErrorCode` + `RETRYABILITY_MAP` as `'never'` — verify only, no modification needed.
- [ ] `recomputeAccumulation` is a pure function — same input always produces same output.
- [ ] Replay determinism property test: same `steps[]` produces same `BudgetAccumulation`.
- [ ] Ceiling enforcement property test: for any accumulation where any axis >= its limit, verdict is `exceeded`.
- [ ] warn-then-halt ordering property test: `exceeded => warn` (whenever exceeded, warn fraction was also reached).
- [ ] `costEvent?.totalCost` on `ComposerStep` is optional — existing steps without cost events contribute 0 to dollar total.

### Dependencies

Wave 2. Depends on Unit 2 for `CostEvent` type shape (inline structural type in `ComposerStep` matches Unit 2's `CostEvent` fields — coordinate before Wave 2 begins).

### ADR ref

cf-X-4 (`docs/spec-v1.md` carry-forwards: "cross-attempt cumulative budget tracking requires persistent storage in the Inngest-adapter layer"). Also cf-X-3 (include `budgetAccumulation` snapshot in error payload for diagnostics).

### Industry reference points

- Inngest step function replay: each step re-runs from `run.steps[]` journal — this is why `BudgetAccumulation` must be a pure reducer over `steps[]`.
- OpenAI `budget_tokens` in extended thinking: ceiling-then-error semantics; `budget_exceeded` is the canonical error name in that API.

---

## Unit 5 — Chores

### Task 5a — Fix `b25be67` placeholder SHA in `docs/spec-v1.md`

Run `git log --oneline | grep b25be67` first. If `b25be67` is the real M5 audit closure commit SHA (it is), the row is already correct — no patch needed. If the row was meant to hold the publish closure SHA `fd1c675` instead, patch it.

### Task 5b — Biome warnings sweep

Run `pnpm biome check . --max-diagnostics=500`. Resolve ~84 warnings (mostly `noNonNullAssertion` in test code): replace `x!` with `x ?? defaultValue` or add `// biome-ignore lint/style/noNonNullAssertion: <reason>`. Commit separately as `chore(lint): resolve biome warnings` — do NOT bundle with feature commits.

**BINDING:** `pnpm lint` = biome lint only; CI = `biome check` (lint + format + assist). Always use `pnpm biome check . --max-diagnostics=500` before any commit.

### Acceptance criteria

- [ ] `docs/spec-v1.md` M5 row contains a real, resolvable git SHA.
- [ ] `pnpm biome check . --max-diagnostics=500` exits with code 0 after the chore commit.
- [ ] Chore commit is separate from all feature commits (clean git history).

---

*Drilldown companion to `m6_executor_brief.md`. Working rules, wave sequencing, risk flags, and verification gates are in the entry brief.*
