# M6 Report-Back — Spend-Aware Runtime Guards

> **Status:** Complete
> **Branch:** `m6-runtime-guards-spend` | **Tip:** `<m6-tip-after-merge>`
> **Implementation commits:** 8 (SHA `8cf295b`..`c8b7f7c`) + 2 closeout commits (changeset + this doc)
> **Key shipped:** verifyWebhook, RateLimitGuard (in-process), BudgetCeiling, @idriszade/cost pricing pack, biome zero
> **ADR delta:** 49/55 → 52/55 (X-4, X-5 in-process, cf-X-4)
> **Test delta:** 991 → 1110 passing + 2 skipped (+119 net; gate 5 thresholds met)
> **Coverage:** 88.44 / 80.72 / 90.22 / 89.62 (stmt / branch / fn / line)
> **Carry-forwards into M7:** 4 new (Redis RateLimitStore adapter, apply-budget-ceiling.ts rename, pricing refresh cadence, biome dispatch guardrail)

## Commits

| # | SHA | Subject |
|---|-----|---------|
| 1 | `8cf295b` | feat(core): add verifyWebhook general-purpose HMAC verifier (Unit 1) |
| 2 | `62edce1` | feat(cost): add @idriszade/cost pack with bundled pricing snapshot (Unit 2) |
| 3 | `eafd507` | feat(core): add RateLimitGuard as 6th RunGuard shape (Unit 3) |
| 4 | `07ec81c` | chore(core): wire M6 Wave 1 top-level barrel + verify.ts TSDoc |
| 5 | `81d7ef1` | chore(core): biome organizeImports auto-fix on M6 Wave 1.5 barrel |
| 6 | `bc98fdd` | feat(core): add BudgetCeiling cumulative spend tracking on Composer (Unit 4) |
| 7 | `0bb0bac` | refactor(core): extract budget ceiling enforcement out of composer.ts |
| 8 | `c8b7f7c` | chore(lint): resolve all biome warnings + infos (cf #6) |
| 9 | `6875740` | chore(changeset): M6 runtime guards + spend |
| 10 | TBD | docs(m6): report-back doc for M6 spend-aware runtime guards |

## Per-unit summary

### Unit 1 — verifyWebhook (M5 cf #2)

General-purpose HMAC-SHA256 webhook verifier exported from `@idriszade/core`. Supports multi-key rotation via `secret: string | string[]` (no fixed limit; iterates each key, returns ok on first match), 300s timestamp tolerance, and returns `Result<true, VerifyError>` with structured error codes (`signature_mismatch`, `timestamp_expired`, `malformed_header`). TSDoc added in Wave 1.5 barrel commit (commit 4) due to git-add path list scoping during the Wave 1 dispatch. 28 webhook tests added to core (Unit 3 separately added 31 rate-limit tests; combined core delta = 59).

### Unit 2 — @idriszade/cost pricing pack (ADR X-4)

New package `@idriszade/cost` with a 12-entry bundled PRICES table covering Anthropic (claude-sonnet-4-7, claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7), OpenAI (gpt-5, gpt-5-mini, gpt-4.1, gpt-4o, gpt-4o-mini), and OSS (meta:llama-3.3-70b, deepseek:deepseek-v3, alibaba:qwen-3-235b-a22b). `TokenUsage` is a 4-field struct (inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens) matching Anthropic cache-accurate billing. `createCostCalculator` factory accepts `customPrices` override; Zod boundary validates input; `LAST_UPDATED 2026-05-20` stamped inline. 37 tests. Package set to 0.0.0 in package.json (minor changeset → first publish as 0.1.0 per repo convention).

### Unit 3 — RateLimitGuard as 6th RunGuard shape (ADR X-5)

`RateLimitGuard` declaration type added to core's `RunGuard` discriminated union (6th shape alongside queue/reject/dedup/idempotency/throttle). `RateLimitStore` interface (in-process only per ADR X-5 in-process scope) + `InProcessRateLimitStore` reference impl with sliding-window log and LRU 1024-key eviction. Distributed Redis adapter deferred to M7 (`@idriszade/rate-limit-redis`). 31 new tests added (rate-limit unit tests, fast-check property tests, fake-timer integration tests with ≤ 2_000ms advances per `feedback_fake_timer_gha_flake`). RateLimitGuard declaration-only at kit-core; full distributed integration tests arrive with the Redis adapter in M7.

### Unit 4 — BudgetCeiling on Composer (cf-X-4)

`BudgetCeiling` type (4-axis: maxDollars / maxInputTokens / maxOutputTokens / maxRequests) wired into `ComposerOpts.budgetCeiling?` and `ComposerStep.costEvent?`. `evaluateBudgetCeiling` pure function checks all axes and returns `BudgetCeilingVerdict`; `recomputeAccumulation` is a pure reducer over `run.steps[]` for Inngest replay-safety. Enforcement extracted into `src/apply-budget-ceiling.ts` to bring composer.ts from 568 LOC to 423 LOC (hard limit compliance). Reuses existing `runtime_budget_exceeded` StageErrorCode. 25 new tests.

### Unit 5 — biome warnings sweep (M5 cf #6)

`pnpm biome check . --max-diagnostics=500` reduced from 84 warnings + 36 infos to 0/0/0 across 378 files. Auto-fix touched `.claude/commands/brain.md` (out-of-scope); caught during dispatch and reverted before commit. Final sweep is hand-confirmed clean with no scope leakage.

## ADRs implemented

| Item | Subject | Status delta |
|------|---------|-------------|
| X-4 | Cost derivation pack | DEFERRED → SHIPPED (@idriszade/cost) |
| X-5 | Rate-limit RunGuard shape | DEFERRED → SHIPPED (in-process; Redis adapter deferred to M7) |
| cf-X-4 | Cumulative budget tracking on Composer | OPEN → RESOLVED (BudgetCeiling) |
| M5 cf #2 | HMAC verifyWebhook export | OPEN → RESOLVED |
| M5 cf #4 | `b25be67` SHA placeholder in docs/spec-v1.md | OPEN → VERIFIED-NO-CHANGE (SHA was correct) |
| M5 cf #6 | biome warnings sweep | OPEN → RESOLVED (0/0/0) |

ADR count: **49/55 → 52/55** (X-4, X-5, cf-X-4 counted as the 3 increments).

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| 1 typecheck | PASS | 29 pkgs, 0 errors |
| 2 test | PASS | 1110 passed + 2 skipped (+119 from 991 baseline) |
| 3 biome | PASS | 0/0/0 (378 files; tightened from 0/84/36 by Unit 5) |
| 4 build | PASS | 29 pkgs emit dist/ |
| 5 coverage | PASS | 88.44/80.72/90.22/89.62 (all thresholds met) |

## Package bumps

| Package | Before | After | Reason |
|---------|--------|-------|--------|
| @idriszade/core | 0.4.0 | 0.5.0 | minor — new exports: verifyWebhook + VerifyError types; RateLimitGuard + RateLimitStore + InProcessRateLimitStore; BudgetCeiling + BudgetAccumulation + BudgetCeilingVerdict + evaluateBudgetCeiling + recomputeAccumulation; ComposerStep.costEvent? + ComposerOpts.budgetCeiling? |
| @idriszade/cost | (new) | 0.1.0 | first release — pricing snapshot pack (0.0.0 in package.json + minor changeset → 0.1.0 published) |

## Carry-forwards into M7

**New from M6:**

1. **`@idriszade/rate-limit-redis`** — distributed `RateLimitStore` adapter (interface declared M6, implementation deferred per ADR X-5 in-process scope). Highest-priority M7 item for production rate-limit use cases.
2. **`apply-budget-ceiling.ts` naming** — refactor commit `0bb0bac` extracted not only budget ceiling logic but also pre-existing `applyBudgets`, `makeBudget`, `sourceIterError`, `toRunError` into the same new file. Functional but under-describes contents. Optional cleanup: rename to `composer-internals.ts` or split further.
3. **Pricing-table refresh cadence** — `@idriszade/cost` PRICES table will drift as providers change rates. Need a quarterly-or-similar update process (or a CHANGELOG entry discipline per rate change).
4. **biome auto-fix dispatch guardrail** — Unit 5 auto-fix touched out-of-scope `.claude/commands/brain.md` (caught + reverted). Future biome sweep dispatches should explicitly exclude `.claude/**` from the fix scope.

**Outstanding from earlier milestones:**

- V-6 `memory-map` reference adapter
- IX-2 Python wire codegen (Zod → JSON Schema → Pydantic build-time)
- M2 CLI carry-forwards: `pk run` stdin, webhook trigger, full cron parser, `pk scaffold`
- `observe-vercel` cost-event wiring (if Vercel AI SDK integration warranted)
- Trusted Publishing (SLSA provenance) on npmjs.com for v0.2.0+ packages
