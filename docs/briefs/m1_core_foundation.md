# Brief — M1 Core v1 Foundation (3 packages, 29 ADRs)

> **Branch:** `m1-core-foundation`
> **Author (brain):** 2026-05-15
> **Estimated executor effort:** 15–25 hours (1–2 sessions)
> **Status:** Ready for executor pickup. Branches off `master` tip `3e4c1dc`.
> **Predecessor:** v1 spec locked at `3e4c1dc` (55 ADRs, 5 files).
> **Scope:** 29 of 55 v1 ADRs. Extends `@idriszade/core` + ships
> `@idriszade/secrets` + `@idriszade/memory` contracts.

## Summary (read this first)

### What M1 ships

- Extended `@idriszade/core` with 10 new types, 8 new files,
  PipelineContext v1 fields, Composer budget/buffer/disposal,
  definePipeline() DX layer.
- New `@idriszade/secrets` package — SecretsResolver contract +
  version-aware + TTL wrappers.
- New `@idriszade/memory` package — MemoryAdapter v1 contract +
  Disposable + Listable markers.

### Why this scope

Every M2 package (inngest, A2A, CLI, observe, cost, secrets trio,
memory trio, MCP extensions) imports core types. M1 clears the
dependency bottleneck. Once landed, M2's 10+ packages are fully
parallelizable.

### Key decisions (research-validated 2026-05-15)

| Area | Spec decision | Standard | Verdict |
|------|--------------|----------|---------|
| Disposable | `close()`, Symbol.dispose deferred v1.x | TC39 Stage 4; native Node 22+ only | CORRECT for Node 20+ |
| Usage keys | `gen_ai.usage.input_tokens` etc. | OTel GenAI semconv (experimental) | ALIGNED |
| DI pattern | Typed deps at construction site | tRPC/Inngest typed context | ALIGNED |
| Error codes | String literal union on `code` | neverthrow/tRPC/Hono consensus | ALIGNED |

### Tasks (15 total, 0–14)

| # | Task | Layer | ADRs |
|---|------|-------|------|
| 0 | State verify + branch | 0 | — |
| 1 | StageErrorCode taxonomy | 0 | VI-3, X-2 |
| 2 | UsageAccumulator + CostBudget | 0 | X-1, X-3 |
| 3 | Trigger + RunGuard + Envelope | 0 | IV-2..6 |
| 4 | PipelineContext v1 fields | 0 | I-3, I-4, V-1, VIII-1 |
| 5 | SerializableContext + wire helpers | 0 | VI-5 |
| 6 | DisposableRegistry + DisposalOptions | 0 | V-2, VI-6, VI-7 |
| 7 | Composer v1 extensions | 1 | VI-2, VI-6, X-3 |
| 8 | Named patterns (Gate/Aggregate/Agent) | 2 | VI-1, II-1 |
| 9 | definePipeline + describe enriched | 2 | VII-1, VII-3, VII-5 |
| 10 | Misc core (annotations, PII, RunOptions) | 2 | III-2, VI-4, VIII-6 |
| 11 | Core barrel export + tests | 2 | — |
| 12 | @idriszade/secrets package | 3 | VIII-1..4 |
| 13 | @idriszade/memory package | 3 | V-1..5 |
| 14 | Integration + gates | 4 | — |

### Gates (all 5 green = done)

```
pnpm typecheck            # zero errors across all packages
pnpm lint                 # zero violations
pnpm test                 # all green; ≥85% coverage on new code
pnpm test:types           # type tests pass
bun test                  # runtime-compat smoke
```

Test count target: **500+** (M0.5's 435 baseline + ~80 new).

---

## Section 1 — Package Manifest

### @idriszade/core (EXTEND) — 19 ADRs

**New files (8):**

| File | Contents | ADRs | ~LOC |
|------|----------|------|------|
| `src/stage-error.ts` | StageErrorCode (19 codes), StageError, RETRYABILITY_MAP | VI-3, X-2 | 80 |
| `src/usage.ts` | UsageAccumulator (record/get/getAll), CostBudget type | X-1, X-3 | 40 |
| `src/trigger.ts` | TriggerConfig, RunGuard, KitTriggerEnvelope, TriggerAdapter | IV-2..6 | 60 |
| `src/serializable-context.ts` | SerializableContext, extractWireContext, injectWireContext | VI-5 | 50 |
| `src/disposable.ts` | Disposable, isDisposable, DisposableRegistry, DisposalOptions | V-2, VI-6, VI-7 | 80 |
| `src/patterns.ts` | Gate\<I\>, Aggregate\<I,O\>, AgentProcess\<I,O\> type aliases | VI-1, II-1 | 30 |
| `src/define-pipeline.ts` | definePipeline, DefinedPipeline, PipelineDefinitionEnriched | VII-1, VII-5, VII-3 | 80 |
| `src/pii.ts` | REDACT_TAG, SECRET_TAG constants (direction-only) | VIII-6 | 20 |

**Modified files (6):**

| File | Changes | ADRs |
|------|---------|------|
| `src/context.ts` | PipelineContext + deps, usage; attempt optional; memory deprecated | I-4, V-1, VIII-1, X-1 |
| `src/errors/base.ts` | BaseError + `retryable?: boolean` | I-3 |
| `src/pipeline-types.ts` | RunOptions + parentTraceContext, costBudget, deps | III-2, X-3 |
| `src/composer/composer.ts` | ComposerOpts + buffer, registry, costBudget; budget check loop | VI-2, VI-6, X-3 |
| `src/pipeline.ts` | definePipeline integration point | VII-1 |
| `src/index.ts` | Barrel export for all new types | — |

### @idriszade/secrets (NEW) — 4 ADRs

Package at `packages/secrets/`. Peer dep: `@idriszade/core`.

| File | Contents | ADRs | ~LOC |
|------|----------|------|------|
| `src/types.ts` | SecretsResolver, SecretsError, ScopedSecretsResolver | VIII-1, VIII-4 | 40 |
| `src/version-aware.ts` | createVersionAwareResolver wrapper | VIII-2 | 40 |
| `src/ttl.ts` | createTtlResolver wrapper | VIII-3 | 30 |
| `src/scope.ts` | scope() facade helper | VIII-4 | 20 |
| `src/index.ts` | Barrel export | — | 10 |

### @idriszade/memory (NEW) — 6 ADRs

Package at `packages/memory/`. Peer dep: `@idriszade/core`.

| File | Contents | ADRs | ~LOC |
|------|----------|------|------|
| `src/types.ts` | MemoryAdapter (read/write -> Result), MemoryError | V-1, V-4, V-6 | 30 |
| `src/markers.ts` | Listable interface + isListable guard | V-3 | 20 |
| `src/index.ts` | Barrel export; re-exports Disposable + isDisposable from core | V-2 | 10 |

Disposable lives in core (used by DisposableRegistry). Memory re-exports.
Close-before-init (V-5) is convention, not code.

---

## Section 2 — Task Detail

### Layer 0: Foundation types (Tasks 0–6, independent)

**Task 0: State verify + branch**
Confirm master tip = `3e4c1dc`, all 5 gates green, spec files present.
Branch off `m1-core-foundation`. Read all required files.

**Task 1: StageErrorCode taxonomy** (VI-3, X-2)
New file: `packages/core/src/stage-error.ts`.
Spec ref: `spec-v1-core.md` lines 36–64.
19-code `StageErrorCode` string literal union. `StageError` structured
error type: `{ type: 'stage_error'; code: StageErrorCode; message: string;
param?: string; doc_url?: string }`. `RETRYABILITY_MAP` as
`Map<StageErrorCode, 'always' | 'never' | 'unknown'>` per the table.
Tests: exhaustiveness type test, RETRYABILITY_MAP completeness.

**Task 2: UsageAccumulator + CostBudget** (X-1, X-3)
New file: `packages/core/src/usage.ts`.
Spec ref: `spec-v1-cross-cutting.md` lines 308–350.
`UsageAccumulator` interface + class: `record(key, delta)`, `get(key)`,
`getAll(): ReadonlyMap`. ~12 LOC impl backed by `Map<string, number>`.
`CostBudget`: `{ metric: string; limit: number; action: 'abort' |
'review' | 'warn' }`.
Tests: accumulation sum property, getAll immutability, negative delta.

**Task 3: Trigger + RunGuard + Envelope** (IV-2, IV-3, IV-4, IV-5, IV-6)
New file: `packages/core/src/trigger.ts`.
Spec ref: `spec-v1-runtime.md` lines 170–305.
`TriggerConfig` discriminated union (5 kinds). `RunGuard` as single
interface with optional `concurrency` + `dedup` fields (orthogonal per
IV-4 key constraint — NOT a discriminated union). `KitTriggerEnvelope<T>`
with `dedupKey?: string`. `TriggerAdapter` interface: `register(config,
handler)` — declaration only, no implementation.
Tests: TriggerConfig kind exhaustiveness, RunGuard shape coverage.

**Task 4: PipelineContext v1 fields** (I-3, I-4, V-1, VIII-1, X-1)
Modify: `packages/core/src/context.ts`.
Add `deps: Readonly<Record<string, unknown>>` (default `{}` in
createContext). Add `usage: UsageAccumulator` (default new instance).
Change `attempt: number` to `attempt?: number` (0-indexed, undefined in
non-durable — per I-4). Deprecate `memory?: MemoryAdapter` via JSDoc
`@deprecated Use deps.memory`.
Modify: `packages/core/src/errors/base.ts` — add `retryable?: boolean`.
Update `CreateContextOpts`, `createContext`, `deriveAtomCtx`.
**BREAKING:** existing tests with `ctx.attempt` need `?? 0` adjustment.
Tests: deriveAtomCtx preserves parent deps/usage; default context shape.

**Task 5: SerializableContext + wire helpers** (VI-5)
New file: `packages/core/src/serializable-context.ts`.
Spec ref: `spec-v1-core.md` lines 80–89.
`SerializableContext = { runId, trace: { traceparent, tracestate? },
idempotencyKey }`. `extractWireContext(ctx)` extracts W3C trace strings
from OTel Context via `@opentelemetry/api` propagation.
`injectWireContext(frame, wireCtx)` sets fields on frame object.
Tests: extract/inject round-trip, null-field handling.

**Task 6: DisposableRegistry + DisposalOptions** (V-2, VI-6, VI-7)
New file: `packages/core/src/disposable.ts`.
Spec ref: `spec-v1-core.md` lines 92–123; `spec-v1-cross-cutting.md`
lines 140–153.
`Disposable = { close(): Promise<void> }`. `isDisposable(dep)` guard.
`DisposableRegistry`: `register(name, teardown)` + `disposeAll(opts?)`.
LIFO order. Per-adapter `Promise.race` timeout. Non-throwing.
`DisposalOptions = { timeoutMs?, onTimeout?, onError? }`.
Tests: LIFO order property, timeout fires, error isolation.

### Layer 1: Composer integration (Task 7, depends on 1–6)

**Task 7: Composer v1 extensions** (VI-2, VI-6, X-3) — BRAIN CHECK-IN
Modify: `packages/core/src/composer/composer.ts`.
Add to `ComposerOpts`: `registry?: DisposableRegistry`,
`costBudget?: CostBudget[]`, `buffer?: { window: { type: 'count' |
'time' | 'all'; n?: number } }`.
**Budget check:** between every stage transition, iterate costBudget[],
check `ctx.usage.get(b.metric) >= b.limit`. Action mapping: `'abort'` ->
return `err({ type: 'stage_error', code: 'runtime_budget_exceeded', ... })`;
`'warn'` -> structured log + continue; `'review'` -> stub (compose with
Reviewable in M2 adapter-inngest).
**Disposal:** call `registry?.disposeAll()` in pipeline-level finally.
**Buffer:** add config type to ComposerOpts. Minimum viable: `type: 'all'`
(collect all atoms into array, pass to Process). `'count'` and `'time'`
modes are stretch — defer to M2 if run-loop complexity warrants.
Tests: budget abort at threshold, budget warn logs, disposal on
success/error/abort, buffer 'all' collects atoms.
**Pause after this task** — surface budget/buffer/disposal findings.

### Layer 2: DX + patterns (Tasks 8–11, depends on 7)

**Task 8: Named patterns** (VI-1, II-1)
New file: `packages/core/src/patterns.ts`.
`Gate<I> = Process<I, I>`. `Aggregate<I, O> = Process<I[], O>`.
`AgentProcess<I, O>` alias per `spec-v1-core.md` lines 156–159.
Tests: type-level assignability (Gate\<string\> -> Process\<string,string\>).

**Task 9: definePipeline + describe enriched** (VII-1, VII-3, VII-5)
New file: `packages/core/src/define-pipeline.ts`.
Spec ref: `spec-v1-dx.md` lines 17–137.
`definePipeline(opts, pipeline)` wraps a `TerminalPipeline<O>` with config.
`DefinedPipeline<I,O>`: `.run()` delegates with merged opts; `.describe()`
returns `PipelineDefinitionEnriched` (id, trigger, retry, concurrency,
tags, version, steps[]{name, adapterType, kind}).
Modify `pipeline-types.ts`: `RunOptions` + `parentTraceContext?` (III-2),
`costBudget?` (X-3), `deps?`.
Tests: define/describe round-trip, generic propagation, config merge.

**Task 10: Misc core types** (III-2, VI-4, VIII-6)
Two-plane JSDoc annotations on PipelineContext fields in `context.ts`
(`@control` / `@data-adjacent` / `@user`).
New file: `packages/core/src/pii.ts` — `REDACT_TAG = '@redact'`,
`SECRET_TAG = '@secret'`. Direction-only per VIII-6; hooks ship in M2.

**Task 11: Core barrel export + tests** — BRAIN CHECK-IN
Update `packages/core/src/index.ts` with all new exports.
Property tests: StageErrorCode exhaustiveness, UsageAccumulator
accumulation, DisposableRegistry LIFO.
Type tests: PipelineContext completeness, DefinedPipeline generics,
Pattern assignability.
Update all existing tests for PipelineContext changes.
Coverage: >= 85% on new files.
**Pause** — core complete. Confirm readiness for Layer 3.

### Layer 3: New packages (Tasks 12–13, independent)

**Task 12: @idriszade/secrets** (VIII-1..4)
Bootstrap `packages/secrets/` (package.json, tsconfig, vitest).
Spec ref: `spec-v1-cross-cutting.md` lines 9–68.
`SecretsResolver = { resolve(name) -> Result<string, SecretsError>;
invalidate(name); stats(name) -> { reads, current_version } }`.
`createVersionAwareResolver(real)`: cache {value, version} tuples.
`createTtlResolver(inner, ttlMs)`: time-based invalidation.
`scope(resolver, prefix)`: forwards `${prefix}-${name}`.
Composition: `createTtlResolver(createVersionAwareResolver(real), 60_000)`.
Tests: cache hit/miss, TTL expiry, scope prefix, composition order.
~150 LOC prod, ~120 LOC test.

**Task 13: @idriszade/memory** (V-1..5) — parallelizable with 12
Bootstrap `packages/memory/` (package.json, tsconfig, vitest).
Spec ref: `spec-v1-cross-cutting.md` lines 114–217.
`MemoryAdapter = { read(key) -> Result<string|null, MemoryError>;
write(key, value) -> Result<void, MemoryError> }`.
`MemoryError` codes: `memory_unavailable`, `key_invalid`, `unknown`.
`Listable = { list(namespace) -> Result<string[], MemoryError> }`.
`isListable(dep)` guard. Re-export `Disposable` + `isDisposable` from core.
LWW contract: semantic spec (JSDoc), not enforced in type.
~80 LOC prod, ~60 LOC test.

### Layer 4: Finalization (Task 14)

**Task 14: Integration + gates**
Cross-package import test: secrets/memory import core without cycles.
Full gate run (all 5). Coverage >= 85%. No file > 500 lines.
Write report-back to `docs/briefs/m1_report_back.md`.

---

## Section 3 — M2 Preview

Deferred (26 ADRs, 10+ packages, fully parallelizable against M1):

| Package | Cat | ADRs |
|---------|-----|------|
| `adapter-inngest` | I | I-1..7 (kitStep, kitFanOut, HRP bridge) |
| `serve-a2a` | II | II-3 (A2A protocol) |
| `source-mcp` / `serve-mcp` ext | II, IX | II-2, IX-5 |
| `observe` | X, VIII | X-4, VIII-6 impl (OTel + PII hooks) |
| `cost` | X | X-4 (pricing tables) |
| `cli` | VII | VII-2 (pk dev/run/inspect/trace) |
| `secrets-env/sops/oidc` | VIII | VIII-5 (reference trio) |
| `memory-map/orchestr8/sqlite` | V | V-6 (reference trio) |
| Cross-runtime wire | IX | IX-1..4 (parsers, helpers) |
| TriggerAdapter impls | IV | IV-1, IV-3, IV-7 |

---

## Section 4 — Report-back Format

When all 5 gates green and Tasks 0–14 complete:

```markdown
## Summary
## Tasks completed (0–14, status + notes)
## 5-gate verification (terminal output)
## Test counts (before -> after)
## Files added / modified (with line counts)
## Branch state (commits ahead, any uncommitted)
## OPEN QUESTIONS (if any)
## M2 readiness assessment
```

---

## Section 5 — Implementation Notes

### Spec inconsistency: MemoryAdapter method names
Entry spec V-6 says "storeMemory/retrieveMemory." Drilldown V-1 says
`read` / `write`. **Drilldown is authoritative.** Use `read` / `write`.

### Breaking change: PipelineContext.attempt
v0: `attempt: number` (required, default 1). v1 I-4: `attempt?: number`
(optional, 0-indexed). Update existing tests — use `ctx.attempt ?? 0`.

### deps placement
`PipelineContext.deps` = RUNTIME deps (memory, observer).
SecretsResolver = CONSTRUCTION-TIME only (VIII-1: "secrets is never
ambient"). Do NOT add secrets to PipelineContext.deps.

### Entry spec table: deps marked "v0: Yes"
v0 code has NO `deps` on PipelineContext. `deps` is NEW in v1.

### Buffer config scope
Minimum viable: `type: 'all'` only. `'count'` and `'time'` windowing
MAY be deferred to M2 — surface complexity in Task 7 check-in.

### PII redaction scope
VIII-6 is direction-only. M1 ships annotation constants. Actual
redaction hooks ship in M2 with @idriszade/observe.

### RunGuard shape
IV-4 lists 5 "shapes" but three concerns (concurrency, dedup, singleton)
are orthogonal. Implement as single interface with optional fields, NOT
as discriminated union.

---

*M1 brief locked 2026-05-15. 29 of 55 v1 ADRs. Phase 3 build Layer 1.*
