# @idriszade/core

## 0.6.3

### Patch Changes

- dced333: Refactor: split `wire/lsp-frame.ts` (462 LOC) into 5 cohesive modules
  (encode, decode, async-iter decode, shared header parser, barrel re-export).
  Dedups header-validation logic via new `parseFrameHeader()` helper.
  Public API unchanged.

## 0.6.2

### Patch Changes

- 102c627: M11: verify TP-OIDC publish via plumbing fix (no-op patch)

## 0.6.1

### Patch Changes

- 62c7446: M10: verify OIDC-only npm publish (no-op patch).

## 0.6.0

### Minor Changes

- 7c46265: M8 — cross-runtime wire framing module (IX-1), pk gen-py-schema codegen pipeline (IX-2), TP-OIDC 404 diagnosis prep.

  **`@idriszade/core` (minor):** New wire module at `packages/core/src/wire/` — NDJSON + LSP Content-Length codecs (`encodeNdjsonStream` / `decodeNdjsonStream` / `encodeLspStream` / `decodeLspStream` + async-iter variants), canonical JSON encoder per RFC 8785, RFC-3339 millisecond-precision timestamp validator, `decodeResult` cross-runtime discriminator helper per ADR IX-3, W3C Trace Context wire surfaces via `attachTraceToFrame` / `extractTraceFromFrame` per ADR IX-4. Closes the spike-3 `print(flush=True)` silent-pass class via strict LSP header parsing; closes the content-length-lying class via byte-exact body validation; closes the Python `fromisoformat` silent-truncate class via loud RFC-3339-ms boundary rejection.

  **`@idriszade/cli` (minor):** New `pk gen-py-schema` subcommand — Zod → JSON Schema Draft 2020-12 → Pydantic v2 build-time codegen per ADR IX-2. Feature-gap check rejects `.refine` / `.transform` / `.brand` / `.preprocess` / `.pipe` by default; opt out with `--no-strict-features`. `--check` mode gates CI on snapshot drift.

## 0.5.2

### Patch Changes

- 4ca032d: ci: verify Trusted Publishing OIDC end-to-end + remove NPM_TOKEN long-lived secret

  This patch bump exists to trigger one publish run via Trusted Publishing OIDC
  (npm Trusted Publishers configured on all 33 @idriszade/\* packages 2026-05-22).
  The workflow no longer passes NODE_AUTH_TOKEN — if this publishes successfully,
  TP-OIDC is the sole auth path. No source code or behavior changes in core.

## 0.5.1

### Patch Changes

- 7a07c7f: M7: rate-limit-redis distributed adapter; V-6 memory trio (map/orchestr8/sqlite); composer-internals refactor; Trusted Publishing.

  - **New `@idriszade/rate-limit-redis`**: distributed `RateLimitStore` adapter using node-redis v5+ Lua sliding-window EVAL with SHA caching and NOSCRIPT fallback; testcontainers-redis integration tests covering all 8 acceptance criteria; resolves M6 carry-forward #1 and closes ADR X-5 distributed-tier.
  - **New `@idriszade/memory-map`**: minimal in-process `MemoryAdapter` backed by a plain `Map`; V-6 reference adapter #1; closes ADR V-6.
  - **New `@idriszade/memory-orchestr8`**: `MemoryAdapter` backed by orchestr8 SQLiteBackend with first-write-wins LWW wrap; V-6 reference adapter #2; closes ADR V-6.
  - **New `@idriszade/memory-sqlite`**: `MemoryAdapter` backed by better-sqlite3 in WAL mode; V-6 reference adapter #3; closes ADR V-6.
  - **Refactor `@idriszade/core`**: split `apply-budget-ceiling.ts` into `budget-ceiling.ts`, `budget-helpers.ts`, and `run-errors.ts`; zero public API change; resolves M6 carry-forward #2.

## 0.5.0

### Minor Changes

- 6875740: M6: spend-aware runtime guards — verifyWebhook, RateLimitGuard, BudgetCeiling, plus @idriszade/cost pricing pack.

  - feat(core): verifyWebhook general-purpose HMAC verifier — multi-key rotation, 300s tolerance, Result<true, VerifyError>. Closes M5 cf #2.
  - feat(core): RateLimitGuard as 6th RunGuard shape (declaration-only; ADR X-5 in-process scope) + InProcessRateLimitStore reference impl (sliding-window log, LRU 1024 keys). Distributed adapter (Redis) deferred to M7.
  - feat(core): BudgetCeiling cumulative spend tracking on Composer — 4-axis (maxDollars/input/output/requests); warnAtFraction default 0.80; Inngest replay-safe via recomputeAccumulation pure reducer over run.steps[]. Reuses existing runtime_budget_exceeded StageErrorCode. Closes cf-X-4.
  - feat(cost): NEW @idriszade/cost pack — 12-entry bundled PRICES table (Anthropic / OpenAI / OSS); 4-field Anthropic-cache-accurate TokenUsage; LAST_UPDATED 2026-05-20; customPrices override; Zod boundary validation; pricing accuracy stance documented. Closes ADR X-4.
  - refactor(core): extract budget ceiling enforcement out of composer.ts (568 LOC → 423 LOC) to comply with 500 LOC hard limit.
  - chore(lint): sweep 84 biome warnings + 36 infos to zero (M5 cf #6).

## 0.4.0

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

## 0.3.0

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

## 0.2.0

### Minor Changes

- a331d6b: M1 Core v1 Foundation — 29 ADRs shipped

  @idriszade/core: StageErrorCode 19-code taxonomy, UsageAccumulator + CostBudget, TriggerConfig + RunGuard, PipelineContext v1 fields (deps, usage, attempt optional), SerializableContext wire helpers, DisposableRegistry, Gate/Aggregate/AgentProcess patterns, definePipeline + PipelineDefinitionEnriched, PII annotation constants, Composer budget checks + disposal lifecycle + buffer 'all' mode.

  @idriszade/secrets: SecretsResolver contract, createVersionAwareResolver (cache + version tracking), createTtlResolver (TTL-based invalidation), scope() namespace facade.

  @idriszade/memory: MemoryAdapter v1 contract (read/write with LWW semantics), Listable + isListable guard, Disposable re-export from core.

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

## 0.1.0

### Minor Changes

- Initial public release — M0 + M0.5 reference adapters under @idriszade
  scope. Composer + Pipeline factory + 4 Sources + 3 Stores + 5 Processes +
  4 Serves. v0 contracts per spec.md ADRs 1-23. APIs may break before
  1.0.0.
