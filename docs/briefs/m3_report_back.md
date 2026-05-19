# M3 Report-Back — Observability + Eval Foundation

> **Status:** Complete
> **Branch:** `m3-observability-eval`
> **Commits:** 6 (incl. pre-flight carry-in fix)
> **Test count:** 824 passing, 2 skipped (up from 720 baseline; +104 new)

## Commits

| Commit | Description |
|--------|-------------|
| `b7d9020` | fix(store-sqlite): bump better-sqlite3 to ^12.10.0 for Node 26+ compat |
| `a6dc703` | feat(core): M3 Phase A — UsageAccumulator.merge, evaluateBudgets, wire costBudget |
| `b82cc42` | feat(observe): M3 Phase B — @idriszade/observe pkg (OTel GenAI v1.37 + W3C + file sink) |
| `289e36b` | feat(m3): Phase B4/C1/D — observe-vercel, pk trace, eval + eval-scorers |
| `abd60f2` | docs(m3): Phase E — READMEs for observe, observe-vercel, eval, eval-scorers |
| `ff71ba0` | style(m3): apply biome format + auto-fixable lint |

## What shipped

### @idriszade/core extension

- `UsageAccumulator.merge(other)` — folds an external snapshot into the accumulator
- `evaluateBudgets()` — pure hook returning `{action:'ok'} | {action:'abort'|'review'|'warn', budget, current}`; first-triggered-breach semantics
- `Pipeline.run()` — wires `RunOptions.costBudget` through to `runComposer`
- Composer `applyBudgets`: `abort` → RunError `code:'runtime_budget_exceeded'` with `metadata.usage` snapshot; `review` → RunError `type:'review_failed'`; `warn` → console.warn (unchanged)

### @idriszade/observe (NEW package)

- `otel-genai-keys.ts` — 15 typed v1.37 constants (top-level + cache/reasoning sub-fields); JSDoc-marked NON-ADDITIVE per Langfuse #12306; `CACHE_SUB_FIELDS` / `REASONING_SUB_FIELDS` arrays + `isCacheSubField` / `isReasoningSubField` helpers
- `KitSpanExporter` — implements OTel SpanExporter; emits `gen_ai.system` + `gen_ai.request.model` cross-vendor join key; respects `OTEL_SEMCONV_STABILITY_OPT_IN` (`gen_ai/dup` → mirrors `llm.*`)
- `trace-context.ts` — W3C `traceparent`/`tracestate` serde out-of-band; strict regex (lowercase, non-zero traceId/spanId); `NDJSONFrame` envelope; child needs no SDK
- `FileSinkExporter` — JSONL append; dir resolution: constructor → `PK_TRACE_DIR` → `.pk/traces/`; lazy mkdir; runId-required-or-traceId-fallback

### @idriszade/observe-vercel (NEW package)

- `recordVercelUsage(usage, accumulator)` — maps Vercel AI SDK v7 nested-usage (`inputTokenDetails.cacheReadTokens` etc) to OTel GenAI keys; cache sub-fields recorded under their own keys WITHOUT summing into parent total; accepts both `noCacheTokens` and `nonCachedTokens` spellings

### @idriszade/cli extension — `pk trace`

- `pk trace [--file <path>] [--run <id>] [--dir <dir>] [--json]` — reads file-sink JSONL, renders stage-timeline ASCII tree + per-stage + total usage rollup; `--json` for machine-readable; rollup excludes `CACHE_SUB_FIELDS` + `REASONING_SUB_FIELDS` (non-additive)

### @idriszade/eval (NEW package)

- `defineEval({name, cases, task, scorers, judge?})` factory — validates non-empty cases + at least one scorer-or-judge; stores `judge` field without auto-injection
- `runEval()` — parallel via `p-limit` (default concurrency 4); per-case `UsageAccumulator` snapshot; task/scorer throws CAPTURED (not propagated)
- Types: `Case<I,O>`, `Scorer<I,O>`, `Score`, `EvalResult<I,O>`, `EvalSummary<I,O>`
- `EvalSummary` aggregates `passRate` (all scorers pass) + `totalUsage` (merged) + `totalDurationMs`

### @idriszade/eval-scorers (NEW package)

- `exactMatch()` — recursive structural `deepEqual` (Date/Map/Set/Array/Object, `Object.is` for primitives incl. NaN)
- `numericClose({tolerance})` — abs-diff; NaN-guarded
- `jsonShape({zodSchema})` — zod `safeParse`; failures stringify all zod issues into `reason`
- `llmJudge({model, rubric, client})` — LLM-as-judge as a plain `Scorer<I,O>` with injected `ModelClient` boundary for testability (Braintrust/autoevals 2025–26 pattern)

## ADRs implemented

| ADR | Subject | Status |
|-----|---------|--------|
| X-1 | UsageAccumulator | ratified + implemented |
| X-2 | 19th StageErrorCode `runtime_budget_exceeded` + usage payload | ratified + implemented |
| X-3 | CostBudget declaration + `evaluateBudgets` | ratified + implemented |
| X-4 | cost-derivation adapter-tier | ratified (no-impl, deferred to `@idriszade/cost`) |
| X-5 | rate-limit adapter-tier | ratified (no-impl, deferred to RunGuard) |
| IX-4 | W3C Trace Context out-of-band | ratified + implemented |
| VII-1 | `pk trace` UX | implemented |

7 ratified, 5 implemented. Brings total to 45/55.

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| Tests | PASS | 824 passing, 2 skipped |
| Typecheck | PASS | 0 errors across all 24 packages |
| Lint | PASS | 0 errors (51 warnings, non-blocking) |
| Format | PASS | No fixes needed |
| Build | PASS | All 24 packages compiled cleanly |
| Test:types | PASS | 21/21 tstyche assertions |
| OTel GenAI v1.37 conformance | PASS | top-level + cache/reasoning constants + non-additivity property test |
| Eval integration | PASS | 2-case golden set + `exactMatch` scorer end-to-end |

## Pre-existing carry-in fix

- **store-sqlite**: 11 test failures from M2 — `better-sqlite3@11.x` does not compile against Node 26 (v8 API removed). Resolved by bumping to `^12.10.0` (prebuilt binary available). M2 baseline 709 + 11 fixed sqlite tests = 720; M3 added 104 net new tests for 824 total.

## Carry-forwards to M4

- `@idriszade/cost` pricing pack (X-4 implementation tier)
- Rate-limit RunGuard impl (X-5 implementation tier)
- Thin secrets adapters: `secrets-env`, `secrets-sops`, `secrets-oidc` (VIII-3 ref impls)
- `memory-map` adapter (V ref impl)
- PII redaction default-on at Zod boundary (VIII-6 — must-have 3-of-3)
- Python wire codegen (IX-2 — Zod→JSON-Schema→Pydantic build-time)
- Cross-attempt cumulative budget tracking (cf-X-4)
- Remaining M2 CLI carry-forwards: stdin `pk run`, webhook trigger, full cron, `pk scaffold`
- Integration test against a real `process-extract` (currently uses simulated pure function — process-extract needs an API key to exercise)
