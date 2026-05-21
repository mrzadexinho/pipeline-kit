# Brief — M6 Spend-Aware Runtime Guards (entry)

> **Summary (decisions front-loaded):**
> - Unit 1: `verifyWebhook()` raw-payload HMAC verifier; multi-key rotation; `Result<true, VerifyError>`; 300s default tolerance; closes M5 cf #2.
> - Unit 2: New `@idriszade/cost` pack; `createCostCalculator` + `CostEvent`; 4-field Anthropic-cache-accurate input; bundled pricing snapshot; closes ADR X-4.
> - Unit 3: `RateLimitGuard` as 6th `RunGuard` shape; sliding-window; in-process LRU store; `RateLimitStore` interface declared for M7 Redis; closes ADR X-5 (in-process scope; distributed deferred).
> - Unit 4: `BudgetCeiling` + `BudgetAccumulator` on Composer; 4-axis ceiling; `budget.warn` span event; reuses **existing** `runtime_budget_exceeded` StageErrorCode (already in file, retryable: false — do NOT add a new code); recomputed from `run.steps[]` (Inngest replay-safe); closes cf-X-4. Depends on Unit 2 CostEvent shape.
> - Unit 5: Chores — fix `b25be67` placeholder SHA check in `docs/spec-v1.md` + biome warnings sweep.
> - Wave sequencing: Units 1/2/3 parallel (Wave 1) → Unit 4 (Wave 2) → Unit 5 (any wave).
> - ADRs after M6: X-4 SHIPPED, X-5 SHIPPED (in-process), cf-X-4 RESOLVED → 49/55 → 52/55.
> - New packages: 1 (`@idriszade/cost`). Extended: `@idriszade/core`.
> - Version bumps: `@idriszade/core` patch; `@idriszade/cost` 0.1.0.

> **Branch:** `m6-spend-guards`
> **Author (brain):** 2026-05-20
> **Estimated executor effort:** 20–28 hours (2 sessions)
> **Status:** Ready for executor pickup. Cut `m6-spend-guards` from master tip `fd1c675`.
> **Predecessor:** M5 shipped at `b25be67` (publish closure at `fd1c675`).

Per-unit detail in [`m6_executor_brief_units.md`](m6_executor_brief_units.md).

---

## State at M6 start

- Master tip: `fd1c675` (M5 publish closure)
- Tests: 991 passing, 132 test files
- Coverage: 87.95 / 80.13 / 89.94 / 89.21 (statement / branch / function / line)
- ADRs: 49/55 shipped
- Packages on npm: `@idriszade/core` 0.4.0, `@idriszade/adapter-inngest` 0.2.0, `@idriszade/secrets` 0.2.2, `@idriszade/observe` 0.3.0, `@idriszade/observe-vercel` 0.3.0 + 23 transitive patches

## What does NOT exist yet (confirm before Wave 1)

- `packages/core/src/webhooks/` has `sign.ts` + `verify.ts` (domain-typed `PipelineKitEvent` verifier) + `types.ts` + `index.ts`. NO general `verifyWebhook` export.
- `packages/cost/` does NOT exist.
- `RunGuard` in `packages/core/src/trigger.ts` has 2 fields only (`concurrency` + `dedup`). No `rateLimit` field.
- `BudgetCeiling` does NOT exist in core. `CostBudget` exists but operates on raw metric keys, not USD.
- `runtime_budget_exceeded` DOES exist in `StageErrorCode` (line 20 of `stage-error.ts`) — Unit 4 reuses it.

---

## Package surface

| Package | Tier | New / Extend | Version |
|---------|------|-------------|---------|
| `@idriszade/core` | 1 | extend | 0.4.0 → patch |
| `@idriszade/cost` | pack | **NEW** | 0.1.0 |

---

## Scope — 5 units (one-liner each)

| Unit | Name | Detail |
|------|------|--------|
| 1 | HMAC `verifyWebhook` | General-purpose raw-payload verifier, multi-key; see [drilldown §unit-1](m6_executor_brief_units.md#unit-1-hmac-verifywebhook-export) |
| 2 | `@idriszade/cost` pack | New package: pricing snapshot + `createCostCalculator`; see [drilldown §unit-2](m6_executor_brief_units.md#unit-2-idriszadicost-package) |
| 3 | `RateLimitGuard` shape | 6th RunGuard field; in-process LRU store; see [drilldown §unit-3](m6_executor_brief_units.md#unit-3-rate-limit-runguard-shape) |
| 4 | Cumulative budget tracking | `BudgetCeiling` on Composer; reuses `runtime_budget_exceeded`; see [drilldown §unit-4](m6_executor_brief_units.md#unit-4-cumulative-budget-tracking) |
| 5 | Chores | SHA check + biome sweep; see [drilldown §unit-5](m6_executor_brief_units.md#unit-5-chores) |

---

## Wave sequencing

```
Wave 1 (3 parallel sonnet-executor subagents — all independent):
  ├─ Unit 1: verifyWebhook  (packages/core/src/webhooks/)
  ├─ Unit 2: @idriszade/cost (packages/cost/)
  └─ Unit 3: RateLimitGuard  (packages/core/src/trigger.ts + src/rate-limit/)

Wave 2 (serial — depends on Wave 1; coordinate ComposerStep.costEvent shape with Unit 2):
  └─ Unit 4: BudgetCeiling   (packages/core/src/budget.ts + composer/)

Wave 3 (standalone — can run alongside Wave 1 or 2):
  └─ Unit 5: Chores
```

Dispatch Units 1, 2, 3 in a single orchestrator message as 3 parallel Agent calls. After all 3 report back, dispatch Unit 4. Unit 5 at any time.

---

## ADR ledger after M6

| Item | Status after M6 |
|------|----------------|
| ADR X-4 | SHIPPED — `@idriszade/cost` pack |
| ADR X-5 | SHIPPED — in-process scope; `RateLimitStore` interface declared; Redis deferred to M7 |
| cf-X-4 | RESOLVED — `BudgetCeiling` + `BudgetAccumulation` on Composer |
| M5 cf #2 | RESOLVED — `verifyWebhook` export |
| M5 cf #4 | RESOLVED — `b25be67` SHA placeholder checked/fixed |
| M5 cf #6 | RESOLVED — biome warnings swept |

ADR count: 49/55 → 52/55 (X-4, X-5, cf-X-4).

---

## Carry-forwards expected into M7

- `@idriszade/rate-limit-redis` — distributed `RateLimitStore` adapter; interface declared M6, impl deferred
- V-6 `memory-map` reference adapter
- IX-2 Python wire codegen (Zod → JSON Schema → Pydantic build-time)
- M2 CLI carry-forwards: `pk run` stdin, webhook trigger, full cron parser, `pk scaffold`
- Pricing-table refresh cadence policy (automated update process)
- `observe-vercel` cost-event wiring (if Vercel AI SDK integration warranted)
- Any new carry-forwards the executor discovers during M6

---

## Risk flags

| Flag | Summary |
|------|---------|
| RF-1: Pricing-table staleness | Mitigated by `LAST_UPDATED` + `console.debug` on first compute + `customPrices`. Never fetch live at runtime. |
| RF-2: Inngest replay safety | BINDING: recompute `BudgetAccumulation` from `run.steps[]` — never mutate `RunContext` in flight. |
| RF-3: RunGuard 5→6 non-breaking | `rateLimit` is optional; existing declarations remain valid; core bump is patch not minor. |
| RF-4: Anthropic cache fields load-bearing | `cacheWriteTokens` / `cacheReadTokens` are separate fields — do NOT collapse. |
| RF-5: `verifyWebhook` naming distinct from `verify` | Existing `verify()` is domain-typed; new `verifyWebhook()` is raw crypto. Both exported; add TSDoc; do NOT rename existing. |

---

## Verification gates

```bash
pnpm typecheck                              # Gate 1 — strict mode
pnpm test                                   # Gate 2 — Vitest + fast-check
pnpm biome check . --max-diagnostics=500    # Gate 3 — BINDING: check not lint
pnpm build                                  # Gate 4 — all packages
# Gate 5 — coverage >= 80/70/80/80 per-pkg; >= 85/75/85/85 aggregate
```

Test count target: **1050+** (991 baseline + ~15 Unit 1 + ~15 Unit 2 + ~20 Unit 3 + ~20 Unit 4).

M6 hard gates:
1. Unit 1: `verifyWebhook(payload, sign(payload, s), s)` always `ok(true)` — MUST pass.
2. Unit 2: `totalCost === inputCost + outputCost + cacheWriteCost + cacheReadCost` invariant for all models — MUST pass.
3. Unit 3: fake-timer window roll-over (≤ 2_000ms advances per step) — MUST pass.
4. Unit 4: ceiling enforcement property test (exceeded when any axis >= its limit) — MUST pass.

---

## Working rules (BINDING)

- **Model routing:** always pass `model:` explicitly (sonnet = executor/CRUD/tests; haiku = trivial git lookups; opus = judgment-heavy design).
- **Parallel dispatch:** Wave 1 = 3 parallel Agent calls in a single orchestrator message.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Out-of-scope files untouched:** `.claude/commands/brain.md`, `.claude/projects/`, `.clone/`.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **Fake-timer constraint:** pin system time + advance ≤ 2_000ms per step. No large single advances.
- **File-size limits:** 300 LOC soft, 500 LOC hard.
- **Result<T,E> at all public stage boundaries.** No thrown errors crossing the API.
- **Zod schemas at `@idriszade/cost` `compute()` input boundary.**
- **No `any` in stage signatures.**
- **Subagent branch discipline:** specify branch `m6-spend-guards` explicitly in each subagent brief.
- **Changeset required** for each package version bump (`pnpm changeset`).
- Per-unit detail including type shapes, acceptance criteria, and industry references: see [`m6_executor_brief_units.md`](m6_executor_brief_units.md).

---

## Changeset guidance

```bash
pnpm changeset
# Select: @idriszade/core (patch), @idriszade/cost (minor — first release)
# Summary: "M6: verifyWebhook, RateLimitGuard, BudgetCeiling; @idriszade/cost pricing pack"
```

Changeset 2-step publish flow: merging `.changeset/*.md` triggers Version Packages PR; merging that PR triggers `changeset publish`. Expect 2+ GHA `release.yml` runs.

---

## Report-back format

On completion, executor writes `docs/briefs/m6_report_back.md` with:
- Commits table (hash + description, one row per commit)
- Per-unit summary paragraph
- ADRs implemented (table: ADR / subject / status delta)
- Gates table (gate name / status / detail)
- Package bumps table
- Carry-forwards (new from M6 + outstanding from M5)

---

*M6 brief locked 2026-05-20. Cut `m6-spend-guards` from `fd1c675`. Confirm 991-test baseline green before Wave 1.*
