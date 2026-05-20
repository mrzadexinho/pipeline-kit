# pipeline-kit v1 Specification

> **Status:** LOCKED — Phase 2 complete. Phase 3 (build) may begin.
> **Author:** Brain — 2026-05-15.
> **Phase 1 inputs:** 10 research categories, 55 ADR candidates.
> **Phase 2 output:** This spec + 4 drilldown files.
> **Predecessor:** v0 spec at `docs/spec.md` (23 ADRs, M0+M0.5 shipped).

---

## v1 Scope

v0 shipped the 4-stage model (Source/Store/Process/Serve), Composer, 17 adapters, Reviewable/HRP, and 23 locked ADRs. v1 extends this foundation across 10 research categories: durable execution via Inngest (Cat I), trigger/schedule primitives and RunGuard (Cat IV), DisposableRegistry and the 19-code StageErrorCode taxonomy (Cat VI), linear DAG confirmation (Cat III), agent-as-Process named pattern (Cat II), code-first config via definePipeline() and CLI (Cat VII), SecretsResolver with version-aware resolution and PII redaction (Cat VIII), MemoryAdapter with Disposable/Listable markers (Cat V), cross-runtime NDJSON+LSP wire and W3C Trace Context (Cat IX), and UsageAccumulator with CostBudget declaration (Cat X).

v1 adds 13 new packages, 8 new PipelineContext fields, and 10 new top-level types. No v0 ADR is reopened.

## What v1 is NOT

- Not a re-deliberation of v0 ADRs (23 ADRs locked at `docs/spec.md`)
- Not a graph/DAG model (Cat III: linear sufficient for v1; graph deferred to v2)
- Not a serialisable pipeline config format (Cat VII: code-first wins)
- Not a framework or runtime (library beneath workflow engines)
- Not a product launch (kit is infrastructure, not product)

---

## Package topology (v1)

| Tier | Package | Description | New in v1? |
|------|---------|-------------|------------|
| Core | `@idriszade/core` | 4-stage types, Composer, PipelineContext, Result\<T,E\>, StageErrorCode (19), UsageAccumulator, CostBudget, RunGuard, TriggerConfig, definePipeline() | Extended |
| Core | `@idriszade/cli` | `pk dev/run/inspect/trace` (~150 LOC) | NEW |
| Adapter | `@idriszade/adapter-inngest` | kitStep(), kitFanOut(), NonRetryableError, trigger registration | NEW |
| Adapter | `@idriszade/source-mcp` | MCP Resources/Prompts as Source | NEW |
| Adapter | `@idriszade/serve-mcp` | MCP Tool handler as Serve | NEW |
| Adapter | `@idriszade/serve-a2a` | A2A protocol as Serve | NEW |
| Adapter | `@idriszade/secrets` | SecretsResolver (B-placement), version-aware resolver, TTL wrapper | NEW |
| Adapter | `@idriszade/memory` | MemoryAdapter (orchestr8 ref impl), Disposable, Listable | NEW |
| Pack | `@idriszade/observe` | OTel, Langfuse, Helicone adapters + cost span mapping | NEW |
| Pack | `@idriszade/cost` | Model pricing tables, tokens→USD derivation | NEW |
| Pack | `@idriszade/secrets-env` | EnvSecretsAdapter (reference) | NEW |
| Pack | `@idriszade/secrets-sops` | SOPSSecretsAdapter (reference) | NEW |
| Pack | `@idriszade/secrets-oidc` | OIDCSecretsAdapter (reference) | NEW |

---

## Core API surface summary

### PipelineContext (v1 fields)

| Field | Type | Source ADR | v0? |
|-------|------|-----------|-----|
| runId | string | v0 | Yes |
| signal | AbortSignal | v0 | Yes |
| attempt | number | I-4 | NEW |
| trace | \{ traceparent, tracestate \} | IX-4 | NEW |
| idempotencyKey | string | VI-5 | NEW |
| usage | UsageAccumulator | X-1 | NEW |
| deps | Record\<string, unknown\> | v0 | Yes |
| metadata | Record\<string, unknown\> | v0 | Yes |

### Key new types

- `StageErrorCode` — 19-code string literal union (VI-3 + X-2)
- `UsageAccumulator` — Map\<string, number\>, ~12 LOC (X-1)
- `CostBudget` — \{ metric, limit, action: abort|review|warn \} (X-3)
- `RunGuard` — 5-shape declaration (IV-4)
- `TriggerConfig` — discriminated union: cron|webhook|event|manual|mcp (IV-2)
- `SerializableContext` — wire-crossing subset (VI-5)
- `DefinedPipeline<I,O>` — definePipeline() return type (VII-1)
- `PipelineDefinitionEnriched` — describe() output (VII-5)
- `DisposableRegistry` — opt-in Composer escape hatch (VI-6)
- `DisposalOptions` — two-signal contract (VI-7)

---

## ADR index (55 candidates → ratified)

### Cat IX — Cross-Runtime (5 ADRs)
See `spec-v1-cross-cutting.md` §IX.
- IX-1: NDJSON+LSP Content-Length framing as kit wire protocol
- IX-2: Zod→JSON-Schema→Pydantic build-time codegen; no runtime coupling
- IX-3: decode_result helper + per-frame Result\<T,E\> at boundary
- IX-4: W3C Trace Context propagated out-of-band (header/env, not payload)
- IX-5: Kit owns wire-spec; MCP+A2A delegated to adapter-tier

### Cat VIII — Identity/Secrets (6 ADRs)
See `spec-v1-cross-cutting.md` §VIII.
- VIII-1: SecretsResolver B-placement (passed via deps, not constructor)
- VIII-2: Version-aware resolver as kit default; invalidate() load-bearing
- VIII-3: TTL wrapper for rotation-mid-run; workload-identity compatible
- VIII-4: Flat hyphenated naming default; scope() optional façade for N≥3
- VIII-5: 3-ref-adapter trio (env/sops/oidc); vault + encryption primitives = non-goals
- VIII-6: PII redaction default-on at Zod boundary; opt-out explicit

### Cat V — Memory/Feedback (6 ADRs)
See `spec-v1-cross-cutting.md` §V.
- V-1: MemoryAdapter injected via deps.memory; orchestr8 as reference impl
- V-2: Disposable opt-in marker (isDisposable + disposeAll helper)
- V-3: Listable opt-in marker; core-2-verb + opt-in shape consistent with Disposable
- V-4: LWW spec (last-write-wins explicit contract); reference-adapter wraps silent first-write-wins
- V-5: Close-before-init convention for adapter lifecycle
- V-6: Verbose method names (storeMemory/retrieveMemory); no abbrev

### Cat I — Durable Execution (7 ADRs)
See `spec-v1-runtime.md` §I.
- I-1: Inngest step-function runtime as reference durable backend
- I-2: kitStep() shim wraps Inngest step.run(); preserves Result\<T,E\>
- I-3: NonRetryableError mapping for terminal failures
- I-4: PipelineContext.attempt populated by Inngest retry counter
- I-5: HRP↔waitForEvent bridge for human-review checkpoints
- I-6: Replay-safety constraint — no side-effects outside kitStep()
- I-7: adapter-inngest as Tier 2 reference adapter; other runtimes = community

### Cat IV — Trigger/Schedule (7 ADRs)
See `spec-v1-runtime.md` §IV.
- IV-1: Fan-out = adapter pattern (kitFanOut); no new Composer primitive
- IV-2: TriggerConfig at Tier 1 (core); discriminated union cron|webhook|event|manual|mcp
- IV-3: Local-prod seam via TriggerAdapter.register(); dev mock built-in
- IV-4: RunGuard 5-shape declaration (before/after/onError/onCancel/onBudget)
- IV-5: Full pipeline idempotency — input hash + output cache (not step-only)
- IV-6: TriggerAdapter.register() as standard registration contract
- IV-7: kitFanOut() helper; maps Source\<O[]\> to parallel Process invocations

### Cat VI — Stage Model (7 ADRs)
See `spec-v1-core.md` §VI.
- VI-1: 4-stage model preserved; Gate/Aggregate = named Process patterns, not new primitives
- VI-2: Composer buffer config (backpressure, highWaterMark)
- VI-3: StageErrorCode 19-code string literal union; exhaustive switch enforced
- VI-4: Two-plane (data/control) as convention + annotations; not enforced by type
- VI-5: SerializableContext subset type for wire-crossing; idempotencyKey + trace fields
- VI-6: DisposableRegistry as opt-in Composer escape hatch for non-re-readable resources
- VI-7: Two-signal disposal contract (AbortSignal for cancellation + dispose() for cleanup)

### Cat III — DAG Composition (2 ADRs)
See `spec-v1-core.md` §III.
- III-1: Linear API sufficient for v1; pipe/fan-out covers real reference project needs
- III-2: Graph model (DAG, cycles, conditional branching) deferred to v2

### Cat II — Agent Protocols (5 ADRs)
See `spec-v1-core.md` §II.
- II-1: Agent = named pattern on Process\<I,O\>; no new stage type
- II-2: MCP composition via existing Source/Serve adapters (source-mcp, serve-mcp)
- II-3: Handoff = through-chain; protocol negotiation = Process-internal
- II-4: Session state = MemoryAdapter + sessionId key convention
- II-5: maxTurns per-Process config; StreamingProcess deferred to v2

### Cat VII — Config/DX (5 ADRs)
See `spec-v1-dx.md` §VII.
- VII-1: definePipeline() code-first config; no serialisable format
- VII-2: @idriszade/cli with 4 commands (dev/run/inspect/trace)
- VII-3: Templates = factory functions returning DefinedPipeline; no codegen
- VII-4: PRP-as-Source\<PRPContent\> pattern; prompt as typed data
- VII-5: describe() enriched (schema + guards + triggers) and one-way (read-only)

### Cat X — Cost/Usage (5 ADRs)
See `spec-v1-cross-cutting.md` §X.
- X-1: UsageAccumulator on PipelineContext; accumulate() + snapshot() API
- X-2: runtime_budget_exceeded as 19th StageErrorCode
- X-3: CostBudget declaration; action gradient (warn→review→abort)
- X-4: Cost derivation = adapter-tier only; core has no pricing tables
- X-5: Rate limiting = adapter-tier only; no Composer primitive

---

## Config/code boundary (normative, from Cat VII)

| Concern | Config (data) | Code (logic) |
|---------|--------------|-------------|
| Pipeline identity | id, name, tags | — |
| Trigger | type, schedule, event name | — |
| Retry policy | maxAttempts, backoff enum | Custom backoff fn |
| Concurrency | maxConcurrent, queue mode | Custom queue logic |
| Timeout | ms integer | — |
| Schema validation | — | Zod schemas (live) |
| Process logic | — | Process\<I,O\> function |
| Serve output | — | Serve\<I\> function |
| Error handling | — | Custom error handlers |
| Prompt templates | — | Template literals |
| Env overrides | — | TS ternaries |
| Adapter selection | type string | Factory fn |
| Observability | tags, version, step names | — |

---

## Carry-forwards deferred past v1.0

### M1 (post v1.0, pre v1.1)
- cf-X-3: ctx.usage snapshot on StageError payload
- cf-X-4: cross-attempt budget persistence in Inngest adapter
- cf-I-12: HRP + MemoryAdapter Disposable lifecycle composition

### M2 (v1.x)
- CancellationToken for multi-runtime (Cat VI CF-VI-2)
- AsyncIterator sequential step.run() utility (Cat I cf #2)
- Bidirectional RPC / callbacks (Cat IX cf #4)
- sql.js durability at >10k entries (Cat V cf #3)
- Real-backend secrets probes (Cat VIII cf #3)
- TC39 Symbol.dispose alignment (Cat VI, Node 22+)
- StreamingProcess (Cat II, v2)
- Graph/DAG composition (Cat III, v2)

---

## Test plan

### Property tests (fast-check)
- Idempotency: `run(input) === run(input)` for deterministic pipelines
- Round-trip: Atom serialise→deserialise preserves all fields
- Cancellation: `signal.abort()` stops processing within 1 stage boundary
- Cost accumulation: `sum(atom.usage) === run.usage` for all metrics
- Budget guard: `usage >= limit` triggers correct action (abort/review/warn)

### Integration tests
- Inngest adapter: kitStep + kitFanOut + waitForEvent end-to-end
- Cross-runtime: TS→Python NDJSON round-trip
- Memory: orchestr8 read/write/list lifecycle
- Secrets: env + version-aware resolver rotation
- OTel: span emission with GenAI usage attributes
- CLI: pk inspect output matches describe()

### Type tests
- StageErrorCode exhaustiveness (19 codes)
- PipelineContext field completeness
- DefinedPipeline generic propagation
- Process\<I,O\> assignability for all named patterns (Gate, Aggregate, Agent)

---

## Drilldown files

- `spec-v1-core.md` — Stage model (VI), composition (III), agent patterns (II)
- `spec-v1-runtime.md` — Durable execution (I), triggers (IV)
- `spec-v1-cross-cutting.md` — Secrets (VIII), memory (V), cross-runtime (IX), cost (X)
- `spec-v1-dx.md` — Config/DX (VII)

---

*v1 spec locked 2026-05-15. 55 ADRs ratified. Phase 3 (build) in progress.*

---

## Build progress (Phase 3)

| Milestone | ADRs implemented | Key packages |
|-----------|-----------------|--------------|
| M1 | 29 | core (v1 ext), secrets, memory |
| M2 | 11 | adapter-inngest, cli |
| M3 | 7 | observe, observe-vercel, eval, eval-scorers |
| M4 | 2 | secrets-env, secrets-sops, secrets-oidc; core + observe PII redaction |
| M5 | 2 | core, adapter-inngest, secrets, observe, observe-vercel (5 extended, 0 new); closes IV-4, IV-5, IV-6, III-2, VIII-2, VIII-6.f, VIII-6.g — see `briefs/m5_audit_findings.md`; commit: `<m5-tip>` |
| **Total** | **49 / 55** | — |

ADRs VIII-5 (secrets adapter trio) and VIII-6 (PII redaction) ratified and implemented in M4.
Closes v1 must-have 3-of-3: eval (M3), local-prod-seam (M2 partial), PII redaction (M4).

**M5 audit (2026-05-20):** IV-4, IV-5, IV-6, III-2 marked PARTIAL / NOT-SHIPPED after code-level audit. See `briefs/m5_audit_findings.md`. M5 will close these to full implementation.
