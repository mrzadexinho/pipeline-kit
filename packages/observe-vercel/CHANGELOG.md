# @idriszade/observe-vercel

## 0.3.5

### Patch Changes

- Updated dependencies [62c7446]
  - @idriszade/core@0.6.1
  - @idriszade/observe@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [7c46265]
  - @idriszade/core@0.6.0
  - @idriszade/observe@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [4ca032d]
  - @idriszade/core@0.5.2
  - @idriszade/observe@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [7a07c7f]
  - @idriszade/core@0.5.1
  - @idriszade/observe@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [6875740]
  - @idriszade/core@0.5.0
  - @idriszade/observe@0.3.1

## 0.3.0

### Minor Changes

- d0a4472: M5 audit closure: ship 7 ADR closures across 5 packages (0 new).

  - @idriszade/core: LocalTriggerAdapter (dev-mode TriggerAdapter for cron / webhook / event / manual / mcp); HMAC-signed scopedIdempotencyKey via HKDF-derived subkey (set PK_SIGNING_KEY env); Composer auto-attaches pk.pii_annotations to step spans; parentTraceContext now consumed end-to-end (forwarded into runComposer, seeded into ctx.trace, passed to OTel withSpan); SAFE_TAG + markSafe added to pii.ts.
  - @idriszade/adapter-inngest: buildFunctionConfig rewritten — overflow:'reject' translates to Inngest singleton primitive, dedup forwards period via throttle, idempotency unconditional. kitFanOut wraps step.invoke data with W3C tracecontext carrier; context-mapping extracts on child entry. @opentelemetry/api added as direct dep. README ships 5-shape translation table.
  - @idriszade/secrets: createVersionAwareResolver probes inner.stats(name).currentVersion on every resolve so external rotation is observed without explicit invalidate().
  - @idriszade/observe: RedactingProcessor gains mode: 'denylist' | 'allowlist' (default denylist preserves behaviour). Allowlist mode emits only fields tagged with markSafe; redacts everything else.
  - @idriszade/observe-vercel: allowlist parity via existing type re-export.

  Closes IV-4, IV-5, IV-6, III-2, VIII-2, VIII-6.f, VIII-6.g. See docs/briefs/m5_audit_findings.md for the audit.

  Modern-standard adjustments adopted within ADRs (no new ADRs):

  - IV-5 reject: Inngest v4 singleton: { key, mode: 'skip' } primitive
  - IV-6 output: HKDF-derived HMAC via crypto.hkdfSync('sha256', PK_SIGNING_KEY, '', 'pk-idempotency-v1', 32)
  - III-2: @opentelemetry/api propagation.inject/extract via \_pk_trace carrier on step.invoke data envelope

### Patch Changes

- Updated dependencies [d0a4472]
  - @idriszade/core@0.4.0
  - @idriszade/observe@0.3.0

## 0.2.0

### Minor Changes

- e899b17: M4 — Secrets + Redaction Closure (closes last v1 must-have)

  **PII Redaction (VIII-6)** ships default-on at the OTel SpanProcessor
  layer:

  - `@idriszade/core`: `markRedact`/`markSecret` annotation helpers,
    `walkAnnotations` schema traverser, `formatRedacted`/`formatSecret`
    formatters
  - `@idriszade/observe`: `RedactingProcessor` wraps any inner
    SpanProcessor; rewrites attributes via known-sensitive table
    (`gen_ai.prompt` + `gen_ai.completion` auto-`@secret`) and via
    schema-derived hints (`pk.pii_annotations`)
  - `@idriszade/observe-vercel`: parity exports

  **Reference secrets adapter trio (VIII-5)** — three new packages
  implementing the M1 SecretsResolver contract:

  - `@idriszade/secrets-env`: env-var-backed, Zod-validated at
    construction (T3 Env pattern)
  - `@idriszade/secrets-sops`: SOPS CLI subprocess via
    `node:child_process` (no JS wrapper dep)
  - `@idriszade/secrets-oidc`: workload-identity OIDC tokens — `./gcp`
    (google-auth-library), `./aws` (@aws-sdk/credential-provider-node),
    `./azure` (@azure/identity); each peer dep optional

  ADRs: VIII-5, VIII-6 (with .a–.g micro-locks). Closes v1 must-have
  3-of-3 (eval → M3, local-prod-seam → M2, PII redaction → M4).

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0
  - @idriszade/observe@0.2.0

## 0.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [a331d6b]
- Updated dependencies [68d3766]
  - @idriszade/core@0.2.0
  - @idriszade/observe@0.1.0
