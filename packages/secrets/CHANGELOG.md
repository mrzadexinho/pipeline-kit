# @idriszade/secrets

## 0.2.7

### Patch Changes

- Updated dependencies [62c7446]
  - @idriszade/core@0.6.1

## 0.2.6

### Patch Changes

- Updated dependencies [7c46265]
  - @idriszade/core@0.6.0

## 0.2.5

### Patch Changes

- Updated dependencies [4ca032d]
  - @idriszade/core@0.5.2

## 0.2.4

### Patch Changes

- Updated dependencies [7a07c7f]
  - @idriszade/core@0.5.1

## 0.2.3

### Patch Changes

- Updated dependencies [6875740]
  - @idriszade/core@0.5.0

## 0.2.2

### Patch Changes

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

- Updated dependencies [d0a4472]
  - @idriszade/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0

## 0.2.0

### Minor Changes

- a331d6b: M1 Core v1 Foundation — 29 ADRs shipped

  @idriszade/core: StageErrorCode 19-code taxonomy, UsageAccumulator + CostBudget, TriggerConfig + RunGuard, PipelineContext v1 fields (deps, usage, attempt optional), SerializableContext wire helpers, DisposableRegistry, Gate/Aggregate/AgentProcess patterns, definePipeline + PipelineDefinitionEnriched, PII annotation constants, Composer budget checks + disposal lifecycle + buffer 'all' mode.

  @idriszade/secrets: SecretsResolver contract, createVersionAwareResolver (cache + version tracking), createTtlResolver (TTL-based invalidation), scope() namespace facade.

  @idriszade/memory: MemoryAdapter v1 contract (read/write with LWW semantics), Listable + isListable guard, Disposable re-export from core.

### Patch Changes

- Updated dependencies [a331d6b]
- Updated dependencies [68d3766]
  - @idriszade/core@0.2.0
