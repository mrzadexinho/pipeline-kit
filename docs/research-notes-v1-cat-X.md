# pipeline-kit — v1 Cat X Research Notes: Cost, Usage & Rate Budgets

> Phase 1 v1 synthesis. Author: Brain — 2026-05-15.
> Inputs: 1 spike FINDINGS file (`research/spikes/cat-x-cost-usage/`).
> Friction anchor: F-COST (catalog top-15 #8; 3/9 projects).
> Status: synthesis complete; 5 ADR candidates locked direction; 4 carry-forwards dispositioned.
> **THIS IS THE FINAL CATEGORY — 10/10. Phase 1 research complete.**

---

## Sources reviewed

### Spike evidence (1 spike)

Commit `a05aea2`. 3 cells, 15 observations, all PASS.
- Cell A: `UsageAccumulator` placement (`ctx.usage` vs `deps.meter`) + accumulation shape.
- Cell B: `CostBudget` declaration + action gradient + `pipeline.run()` options.
- Cell C: OTel GenAI span mapping + fan-out attribution + Langfuse integration surface.

Headline: `ctx.usage: UsageAccumulator` (generic `Map<string, number>`) on PipelineContext.
`CostBudget` declaration follows RunGuard pattern. 19th StageErrorCode confirmed.

### External sources (industry grounding)

- **OTel GenAI Semantic Conventions** (CNCF, experimental): `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.request.model`, `gen_ai.system`. Span attributes,
  not billing primitives. Adopted by Datadog, Grafana, Google Cloud.
- **Langfuse** (open-source LLM observability): granular usage types (input/output/cached/
  audio/image tokens); automatic cost calc for known models; self-hostable. Kit delegates
  cost derivation exactly as Langfuse does — via model pricing tables external to the
  accumulator.
- **Vercel AI SDK**: `generateText`/`streamText` return `usage: { promptTokens,
  completionTokens, totalTokens }` alongside the result — same cross-cutting placement
  logic that confirms `ctx.usage` over `deps.meter`.
- **Stripe Billing Meters**: event counter + aggregation rules. Thresholds trigger
  alert-at-80% → cap-at-100%. `CostBudget` action gradient (warn/review/abort) maps
  directly onto this pattern.

---

## Reframe note

The outline framed Cat X as "ctx.usage vs MeterAdapter?" The spike resolved this quickly:
`ctx.usage` follows the same cross-cutting placement logic as `ctx.signal` and `ctx.trace` —
Composer must be able to read the accumulated total without coupling to a dep key name.
The REAL insight is broader: **kit-core is metric-agnostic**. It accumulates
`Map<string, number>` and the meaning of keys is entirely adapter-defined via OTel GenAI
conventions. Local AI (GPU seconds), cloud AI (tokens), or custom metrics (API calls)
all flow through the same accumulator unchanged.

---

## Spike — cost-metering-and-budget

### What was built

Cell A probed `UsageAccumulator` placement and verified per-atom accumulation with
Composer aggregation (atom1=500 + atom2=300 → runUsage=800). Cell B probed `CostBudget`
declaration shape, the action gradient, and composition with `Reviewable<I>` (budget-driven
HRP trigger). Cell C probed OTel GenAI span attribute mapping and fan-out attribution
(c1=500 + c2=300 + c3=700 → parent=1500).

### What it revealed

1. **ctx.usage placement confirmed** — `deps.meter` (Option B) fails because Composer
   cannot read total spend without coupling to a dep key name. `ctx.usage` on PipelineContext
   is structurally equivalent to `ctx.signal`. (Cell A, O1)
2. **Generic key map, no kit taxonomy** — OTel GenAI keys (`gen_ai.usage.input_tokens`)
   come from adapters; kit-core stores raw `Map<string, number>` only. Local AI
   (`compute.duration_ms`) works identically. (Cell A, O2; Cell C, O5)
3. **RunGuard pattern lifts cleanly to budgets** — `CostBudget { metric, limit, action }`
   mirrors `RunGuard` shape (IV-5). `action: 'review'` routes to `Reviewable<I>` with
   budget payload — no new primitive required. (Cell B, O1, O3)
4. **19th StageErrorCode confirmed** — `runtime_budget_exceeded` is Runtime category,
   `retryable: false`. Spending more tokens cannot resolve a budget overrun (mirrors Stripe
   cap-at-100% logic). (Cell B, O2)
5. **Cost derivation is adapter-tier** — tokens → USD requires model pricing tables;
   that is `@idriszade/cost` pack scope. OTel has no cost attributes; Langfuse handles
   the same delegation via built-in model tables. (Cell A, O4)
6. **Rate limiting is categorically distinct** — req/s limits ≠ total spend budgets.
   Inngest `rateLimit` on functions; kit delegates via RunGuard (IV-5). No kit-core rate
   limiter warranted. (Cell B, O5)

---

## Modern-direction framing

The 2024-26 direction in LLM cost observability has three layers:

**Naming standard** — OTel GenAI Semantic Conventions are the emerging canonical key
namespace. Datadog and Grafana already emit and consume these span attributes. Kit adopts
them as the recommended key set without hard-coding them into kit-core.

**Observability layer** — Langfuse (and Helicone) provide generation-level usage tracking
with automatic cost derivation, dashboard rollups by user/session/model, and self-hosted
deployments. Kit's `ctx.usage` accumulator maps to Langfuse generation input/output tokens
with a trivial adapter shim; the `@idriszade/observe` pack owns this bridge.

**Budget enforcement** — Stripe Billing Meters establish the industry pattern: report usage
→ aggregate → threshold alert → cap. Kit's `CostBudget` action gradient
(`warn` at threshold / `review` for HRP gate / `abort` for hard cap) mirrors this
three-level response pattern.

Kit's contribution to this stack: a **generic accumulator** (no metric opinions),
a **declaration guard** (CostBudget on `pipeline.run()`), and **OTel mapping** (1:1 key
passthrough via `@idriszade/observe`). Cost derivation and observability dashboards remain
adapter-tier. This is the same "declare in core, enforce in adapter" discipline established
across IV-5 (RunGuard), I-2 (kitStep), and VI-3 (StageErrorCode).

---

## ADR candidates

### ADR-v1-X-1 — UsageAccumulator on PipelineContext; generic Map<string,number>; OTel GenAI key namespace

**Status:** v1 candidate (synthesis 2026-05-15). Awaiting brain v1 spec lock.

`ctx.usage: UsageAccumulator` lives on `PipelineContext` alongside `signal` and `trace`.
`UsageAccumulator` is a thin `Map<string, number>` with `record(key, delta)` (additive),
`get(key)`, and `getAll()` (immutable snapshot). ~12 LOC. OTel GenAI Semantic Conventions
(`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) are the RECOMMENDED key
namespace; kit-core enforces no key taxonomy.

Grounded in: Vercel AI SDK usage-alongside-result pattern; OTel GenAI Semantic Conventions
(CNCF experimental, Datadog/Grafana adopted).

**Alternatives considered:** `ctx.deps.meter` (service-shaped, Composer coupling),
`ctx.metrics: Record<string, number>` (same shape, less discoverable name).

**Consequences:** Composer can aggregate child usage without dep-key coupling. Local AI
(`compute.duration_ms`) and cloud AI (`gen_ai.usage.input_tokens`) use identical API.

---

### ADR-v1-X-2 — runtime_budget_exceeded added to StageErrorCode taxonomy (18→19)

**Status:** v1 candidate (synthesis 2026-05-15). Awaiting brain v1 spec lock.

`runtime_budget_exceeded` is added as the 19th StageErrorCode. Category: Runtime.
`retryable: false` — spending more tokens cannot resolve a budget overrun. Extends
Cat VI ADR-VI-3 (18-code StageErrorCode taxonomy).

Grounded in: Stripe billing cap-at-100% (terminate, do not retry).

**Alternatives considered:** Reusing `process_failed` with a sub-code (loses explicit
budget semantics in dashboards and filtering).

**Consequences:** Callers can branch on this code without string-matching `message`.
Budget overruns are unambiguously non-retriable at the type level.

---

### ADR-v1-X-3 — CostBudget declaration; action gradient (abort/review/warn); pipeline.run() options

**Status:** v1 candidate (synthesis 2026-05-15). Awaiting brain v1 spec lock.

`interface CostBudget { metric: string; limit: number; action: 'abort'|'review'|'warn' }`.
Passed as `pipeline.run(input, { costBudget: CostBudget[] })`. Composer checks all budgets
between every stage transition. `action: 'review'` composes with `Reviewable<I>` (no new
primitive). Follows RunGuard declaration-only pattern (Cat IV ADR-IV-5).

Grounded in: Stripe billing threshold pattern (alert-at-80% / cap-at-100%); RunGuard (IV-5).

**Alternatives considered:** Budget as pipeline-level config (not per-run flexible);
single-budget only (misses multi-meter use cases, e.g., token cap + compute cap).

**Consequences:** Budgets are per-run, composable, and zero-core-logic — Composer checks
a pure numeric comparison. HRP review for budget decisions reuses existing Reviewable<I>.

---

### ADR-v1-X-4 — Cost derivation is adapter-tier (@idriszade/cost pack); kit-core accumulates raw metrics only

**Status:** v1 candidate (synthesis 2026-05-15). Awaiting brain v1 spec lock.

Kit-core accumulates raw `Map<string, number>` only. Tokens → USD conversion (model
pricing tables, e.g., Anthropic Sonnet $3/MTok input) is the responsibility of the
`@idriszade/cost` pack. `CostBudget` can operate on raw token counts OR on USD values
if `@idriszade/cost` writes a `cost.usd` key back to `ctx.usage`.

Grounded in: Langfuse built-in model pricing tables (adapter-tier cost derivation);
OTel GenAI Semantic Conventions (token counts only — no cost attributes).

**Alternatives considered:** Kit-core ships a pricing table (couples to external pricing
APIs; breaks local-AI use case; requires constant maintenance).

**Consequences:** Kit-core has zero external API dependency for cost. Pricing tables are
versioned and replaceable in the pack layer without touching kit-core.

---

### ADR-v1-X-5 — Rate limiting is adapter-tier only; no kit-core rate limiter

**Status:** v1 candidate (synthesis 2026-05-15). Awaiting brain v1 spec lock.

Rate limiting (req/s, concurrency) is categorically distinct from budget tracking (total
spend). Kit delegates rate limiting via RunGuard declaration (Cat IV ADR-IV-5); adapters
implement (e.g., Inngest `rateLimit` on step functions). No kit-core rate-limiter primitive.

Grounded in: Inngest `rateLimit` on functions; RunGuard declaration-only pattern (IV-5).

**Alternatives considered:** Kit-core token-bucket rate limiter (adds stateful complexity;
duplicates Inngest/Temporal scheduler capability; inconsistent with declaration-only discipline).

**Consequences:** Rate-limiting policy is adapter-configurable. Kit-core stays stateless.
Inngest-adapter and future adapters each enforce rate limits in their own runtime.

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)

None — all 4 carry-forwards are implementation-tier, not ADR-level decisions.

### Lifted to future milestones

- **cf-X-1** → v1 spec: `@idriszade/cost` pack shape — `(model, inputTok, outputTok) => USD`
  pricing table API. Out of kit-core scope; pack spec due at Phase 2.
- **cf-X-2** → docs: `gen_ai.usage.cached_tokens` (Langfuse cached_tokens) maps trivially
  to `UsageAccumulator`; document key compatibility in `@idriszade/observe` adapter docs.
  No code change to kit-core.
- **cf-X-3** → M1: attach `ctx.usage` snapshot to `runtime_budget_exceeded` StageError
  payload for diagnostics. Requires StageError payload enrichment spec.
- **cf-X-4** → M1 (Inngest-adapter scope): `ctx.usage` resets per attempt; cross-attempt
  cumulative budget tracking requires persistent storage in the Inngest-adapter layer.

---

## Phase 1 completion note

With Cat X synthesised, all 10 categories are complete:

| # | Cat | ADRs | Status |
|---|-----|------|--------|
| 1 | IX Cross-Runtime | 5 (IX-1..IX-5) | Complete |
| 2 | VIII Identity/Secrets | 6 (VIII-1..VIII-6) | Complete |
| 3 | V Memory/Feedback | 6 (V-1..V-6) | Complete |
| 4 | I Durable Execution | 7 (I-1..I-7) | Complete |
| 5 | IV Trigger/Schedule | 7 (IV-1..IV-7) | Complete |
| 6 | VI Stage Model | 7 (VI-1..VI-7) | Complete |
| 7 | III DAG Composition | 2 (III-1..III-2) | Complete |
| 8 | II Agent Protocols | 5 (II-1..II-5) | Complete |
| 9 | VII Config/DX | 5 (VII-1..VII-5) | Complete |
| 10 | X Cost/Usage | 5 (X-1..X-5) | Complete |

**Total: 55 v1 ADR candidates across 10 categories.** Phase 2 (spec) is NEXT.

---

*End of v1 Cat X research notes. 55 ADR candidates across 10 categories; generic
accumulator + declaration guard + OTel mapping pattern; cost derivation adapter-tier.*
*PHASE 1 COMPLETE — all 10 categories synthesised.*

*Author: Brain — 2026-05-15. Inputs: spike `a05aea2`. Branch: `master`. Master tip at synthesis: `82d2e82`.*
