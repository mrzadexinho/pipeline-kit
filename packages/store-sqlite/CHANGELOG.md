# @idriszade/store-sqlite

## 0.1.8

### Patch Changes

- Updated dependencies [62c7446]
  - @idriszade/core@0.6.1

## 0.1.7

### Patch Changes

- Updated dependencies [7c46265]
  - @idriszade/core@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [4ca032d]
  - @idriszade/core@0.5.2

## 0.1.5

### Patch Changes

- Updated dependencies [7a07c7f]
  - @idriszade/core@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [6875740]
  - @idriszade/core@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [d0a4472]
  - @idriszade/core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0

## 0.1.1

### Patch Changes

- 68d3766: M3 Observability + Eval Foundation — 7 ADRs (5 implemented, 2 no-impl)

  @idriszade/core: UsageAccumulator.merge(other); evaluateBudgets() hook;
  Pipeline.run() wires RunOptions.costBudget through to runComposer; budget
  abort now returns RunError with metadata.usage snapshot; budget review
  surfaces review_failed RunError instead of M1 no-op stub.

  @idriszade/observe (new): typed OTel GenAI v1.37 key constants with cache +
  reasoning sub-fields JSDoc-marked NON-ADDITIVE (Langfuse #12306, Vercel AI
  SDK v7); KitSpanExporter emits gen_ai.system + gen_ai.request.model
  cross-vendor join key, respects OTEL_SEMCONV_STABILITY_OPT_IN; W3C Trace
  Context out-of-band serde into NDJSONFrame envelope (no SDK in child);
  FileSinkExporter JSONL append with PK_TRACE_DIR override.

  @idriszade/observe-vercel (new): recordVercelUsage shim maps Vercel AI
  SDK v7 nested usage (inputTokenDetails / outputTokenDetails) into kit
  UsageAccumulator under OTel GenAI keys; cache sub-fields recorded under
  their own keys WITHOUT summing into parent input_tokens total — non-additive
  by construction; accepts both noCacheTokens + nonCachedTokens spellings.

  @idriszade/cli: pk trace [--file | --run] [--dir] [--json] reads file-sink
  JSONL, renders stage-timeline ASCII tree + per-stage + total usage rollup;
  usage rollup excludes CACHE_SUB_FIELDS + REASONING_SUB_FIELDS (non-additive).
  Closes ADR VII-1.

  @idriszade/eval (new): defineEval({name, cases, task, scorers, judge?})
  factory + parallel runEval via p-limit (default concurrency 4); per-case
  UsageAccumulator snapshot; task/scorer throws captured (not propagated);
  EvalSummary aggregates passRate (all scorers pass) + totalUsage merge +
  totalDurationMs. Common-denominator API matches Inspect AI / Braintrust /
  Promptfoo / LangSmith.

  @idriszade/eval-scorers (new): exactMatch (recursive deep-equal incl.
  Date/Map/Set/NaN), numericClose({tolerance}), jsonShape({zodSchema}) via
  zod safeParse, llmJudge({model, rubric, client}) with injected ModelClient
  boundary for testability — LLM-as-judge is a plain Scorer<I,O>, not a
  special type (Braintrust/autoevals 2025-26 per-SDK split).

  @idriszade/store-sqlite: bump better-sqlite3 to ^12.10.0 for Node 26+
  compat (v11.x v8 APIs removed in Node 26). Prebuilt binary, no native
  build step required for users on Node 20/22/24/26.

  Closes ADRs X-1 (UsageAccumulator), X-2 (19th StageErrorCode payload),
  X-3 (CostBudget declaration), IX-4 (W3C Trace Context out-of-band),
  VII-1 (pk trace UX). Ratifies no-impl X-4 (cost-derivation adapter-tier
  deferred to @idriszade/cost) and X-5 (rate-limit adapter-tier deferred to
  RunGuard). 824 tests passing.

- Updated dependencies [a331d6b]
- Updated dependencies [68d3766]
  - @idriszade/core@0.2.0

## 0.1.0

### Minor Changes

- Initial public release — M0 + M0.5 reference adapters under @idriszade
  scope. Composer + Pipeline factory + 4 Sources + 3 Stores + 5 Processes +
  4 Serves. v0 contracts per spec.md ADRs 1-23. APIs may break before
  1.0.0.

### Patch Changes

- Updated dependencies
  - @idriszade/core@0.1.0
