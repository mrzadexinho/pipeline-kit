# Brief — M3 Observability + Eval Foundation (4 new packages + 2 extensions)

> **Summary:** observe ships OTel GenAI v1.37 + W3C Trace Context + file sink; observe-vercel
> maps Vercel AI SDK v7 nested usage; core gains UsageAccumulator + CostBudget + 19th
> StageErrorCode; CLI gains `pk trace`; eval + eval-scorers ship Braintrust-style runner/scorer
> split. 7 ADRs ratified, 5 implemented. 20 tasks across 5 phases.

> **Branch:** `m3-observability-eval`
> **Author (brain):** 2026-05-19
> **Estimated executor effort:** 18–24 hours (1–2 sessions)
> **Status:** Ready for executor pickup. Branches off `master` tip `1d412d3`.
> **Predecessor:** M2 shipped at `1d412d3` (11 ADRs, 709 tests, adapter-inngest + cli).
> **Scope:** 7 of 55 v1 ADRs. Ships `@idriszade/observe`, `@idriszade/observe-vercel`,
> `@idriszade/eval`, `@idriszade/eval-scorers`; extends `@idriszade/core` + `@idriszade/cli`.

## What M3 ships

- **`@idriszade/core` extension** — `UsageAccumulator` (`Map<string,number>`, additive,
  commutative+associative tested), `CostBudget` interface + `evaluateBudgets()` hook between stage
  transitions, `runtime_budget_exceeded` 19th StageErrorCode (`retryable: false`, payload includes
  `ctx.usage` snapshot); `pipeline.run()` gains `costBudget?: CostBudget[]` option.
- **`@idriszade/observe`** — Typed OTel GenAI v1.37 key constants (cache sub-fields flagged
  non-additive; Langfuse #12306); `KitSpanExporter` emitting `gen_ai.system` +
  `gen_ai.request.model` (cross-vendor join key per Datadog/Honeycomb/Langfuse); W3C Trace Context
  out-of-band serde into NDJSON frame envelope (parent serializes `traceparent`/`tracestate`; child
  reads + forwards — no SDK required); `FileSinkExporter` JSONL append to `.pk/traces/<run-id>.jsonl`.
- **`@idriszade/observe-vercel`** — Vercel AI SDK v7 nested-usage shim. Maps
  `usage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens,noCacheTokens}` and
  `usage.outputTokenDetails.{reasoningTokens,textTokens}` → `ctx.usage.record()` via OTel GenAI
  key constants. Does NOT sum `cacheReadTokens` into `input_tokens` total (non-additive; v7 removed
  top-level `cachedInputTokens`/`reasoningTokens`).
- **`@idriszade/cli` extension** — `pk trace [--file <path>] [--run <id>]` reads file-sink JSONL,
  renders stage-timeline ASCII tree + per-stage + total usage rollup; `--json` flag. Closes M2
  carry-forward. ADR VII-1.
- **`@idriszade/eval`** — `defineEval({name, cases, task, scorers, judge?})` factory; parallel
  runner with concurrency limit; `EvalResult<I,O>` carries `usage: UsageAccumulator`, `durationMs`,
  `error?`. Eval common-denominator API matches Inspect AI/Braintrust/Promptfoo/LangSmith:
  `Case<I,O> = {input, expected?, metadata?}`, `Scorer<I,O> = (args) => Score`,
  `Score = {pass, score, reason?}`.
- **`@idriszade/eval-scorers`** — `exactMatch()`, `numericClose({tolerance})`,
  `jsonShape({zodSchema})`, `llmJudge({model, rubric})`. LLM-judge = `Scorer<I,O>` that calls a
  model internally — no special type (Braintrust/autoevals 2025–26 per-SDK split).

## Package surface

| Package | Tier | New / Extend | LOC ceiling |
|---------|------|-------------|-------------|
| `@idriszade/core` | 1 | extend | +200 |
| `@idriszade/observe` | 2 | new | ~400 |
| `@idriszade/observe-vercel` | 2 | new | ~80 |
| `@idriszade/cli` | 2 | extend | +150 |
| `@idriszade/eval` | 2 | new | ~350 |
| `@idriszade/eval-scorers` | 2 | new | ~250 |

## Tasks (20 total)

**Phase A — Core extension (strict serial):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| A1 | `packages/core/src/usage.ts` | `UsageAccumulator` ~50 LOC; `record(key,delta)` additive; `get/getAll/merge`; fast-check: commutativity + associativity | X-1 |
| A2 | `packages/core/src/context.ts` | add `usage: UsageAccumulator`; Composer init per-run + merge children on fan-out | X-1 |
| A3 | `packages/core/src/budget.ts` | `CostBudget` + `evaluateBudgets()`; `action:'review'` → existing Reviewable path; `action:'abort'` → Result.err | X-3 |
| A4 | `packages/core/src/error-codes.ts` | 19th code `runtime_budget_exceeded`; `retryable:false`; payload = `ctx.usage` snapshot | X-2 |
| A5 | `packages/core/src/pipeline.ts` | extend `run(input, opts)` with `costBudget?: CostBudget[]`; pass to Composer | X-3 |

Acceptance: typecheck + all 709 tests green + ~25 new tests.

**Phase B — Observe pkgs (parallel after A; B4 in observe-vercel):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| B1 | `packages/observe/src/otel-genai-keys.ts` | typed v1.37 constants; cache sub-fields JSDoc-marked non-additive (Langfuse #12306) | IX-4 |
| B2 | `packages/observe/src/exporter.ts` | `KitSpanExporter`; emits `gen_ai.system` + `gen_ai.request.model`; respects `OTEL_SEMCONV_STABILITY_OPT_IN` | IX-4 |
| B3 | `packages/observe/src/trace-context.ts` | W3C `traceparent`/`tracestate` serde into NDJSON frame; no SDK in child | IX-4 |
| B5 | `packages/observe/src/file-sink.ts` | `FileSinkExporter` JSONL; default path `.pk/traces/<run-id>.jsonl`; override via `PK_TRACE_DIR` | IX-4 |
| B4 | `packages/observe-vercel/src/index.ts` | v7 nested-usage→`ctx.usage.record()`; non-additive cache baked in | IX-4 |

Acceptance: OTel GenAI v1.37 conformance fixture pass; cache non-additivity property test pass.

**Phase C — `pk trace` (depends on B5):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| C1 | `packages/cli/src/commands/trace.ts` | reads JSONL; ASCII timeline + rollup; `--json`; integration test 3-stage → sink → trace → expected output | VII-1 |

**Phase D — Eval pkgs (parallel after A+B; D1→D2→D3 serial; D4–D7 parallel):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| D1 | `packages/eval/src/types.ts` | `Case<I,O>`, `Scorer<I,O>`, `Score`, `EvalResult<I,O>` | II-5 |
| D2 | `packages/eval/src/define-eval.ts` | `defineEval()` factory; `judge?:{model}` forwarded to llmJudge | II-5 |
| D3 | `packages/eval/src/runner.ts` | parallel via p-limit; per-case `UsageAccumulator` snapshot | II-5 |
| D4 | `packages/eval-scorers/src/exact-match.ts` | `exactMatch()` deep-equal | II-5 |
| D5 | `packages/eval-scorers/src/numeric.ts` | `numericClose({tolerance})` | II-5 |
| D6 | `packages/eval-scorers/src/json-shape.ts` | `jsonShape({zodSchema})` Zod parse | II-5 |
| D7 | `packages/eval-scorers/src/llm-judge.ts` | `llmJudge({model,rubric})`; inject `ModelClient` for testability | II-5 |

Acceptance: example eval against `process-extract` adapter with golden set; per-case usage
recorded; llmJudge mocked at `ModelClient` boundary.

**Phase E — READMEs (after pkgs exist; all 4 parallel):**

| # | Target |
|---|--------|
| E2 | `observe/README.md` + `observe-vercel/README.md` + `eval/README.md` + `eval-scorers/README.md` — each ≤250 lines; observe README must document cache-token non-additivity with example |

## Sequencing

```
A1 → A2 → A3 → A4 → A5
                      ↓
               B1 ∥ B2 ∥ B3 ∥ B5
                           ↓
                     C1 ∥ B4
                           ↓
                     D1 → D2 → D3
                          D4 ∥ D5 ∥ D6 ∥ D7
                                ↓
                           E2 (×4 parallel)
```

## Gates (5 standard + 2 M3-specific)

```
pnpm typecheck / pnpm lint / pnpm test (baseline 709) / pnpm test:types / bun test
```

M3-specific: OTel GenAI v1.37 conformance fixture; eval integration test against
`process-extract` with golden set.

Test count target: **760+**.

## ADR coverage

| ADR | Covered by | Status delta |
|-----|-----------|--------------|
| X-1 UsageAccumulator | A1, A2 | candidate → ratified+implemented |
| X-2 19th StageErrorCode | A4 | candidate → ratified+implemented |
| X-3 CostBudget declaration | A3, A5 | candidate → ratified+implemented |
| X-4 cost-derivation adapter-tier | — | candidate → ratified (no-impl) |
| X-5 rate-limit adapter-tier | — | candidate → ratified (no-impl) |
| IX-4 W3C Trace Context out-of-band | B3 | candidate → ratified+implemented |
| VII-1 `pk trace` UX | C1 | partial → implemented |

7 ADRs ratified, 5 implemented. Brings total to 45/55.

## Pre-existing carry-in fix

`store-sqlite` has 11 test failures from M2 (NODE_MODULE_VERSION mismatch). Fix before A1:
`pnpm rebuild better-sqlite3` or pin `NODE_VERSION` in `.node-version`. Confirm 709 baseline
green before starting A1.

## Out-of-scope (carry to M4)

`@idriszade/cost` pricing pack (X-4); rate-limit RunGuard impl (X-5); thin adapters
(secrets-env, secrets-sops, secrets-oidc, memory-map); PII redaction (must-have 3-of-3 / VIII-6);
Python wire codegen (IX-2); cross-attempt cumulative budget (cf-X-4); remaining M2 CLI
carry-forwards (stdin `pk run`, webhook trigger, cron, `pk scaffold`).

---

*M3 brief locked 2026-05-19. 7 ADRs. 4 new packages + 2 extensions. Phase 3 continues.*

## Ready for executor session

Fresh executor session should invoke `superpowers:executing-plans` against this brief.
Start with the pre-existing carry-in fix, then Phase A serial tasks before any parallel dispatch.
