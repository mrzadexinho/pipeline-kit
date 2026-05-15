# pipeline-kit v1 Spec — Core: Stage Model, Composition & Agent Patterns

> Drilldown for `spec-v1.md`. Covers Cat VI (7 ADRs), Cat III (2 ADRs), Cat II (5 ADRs).
> 14 ADRs total. All status: RATIFIED.

---

## §VI — Stage Model Extension (7 ADRs)

### VI-1: 4-stage model preserved; no new stage primitives

**Status:** RATIFIED
**Decision:** Kit's 4-stage model (Source, Process, Serve, Store) is sufficient for v1. No new stage types added.
- `Gate<I>` → `Process<I,I>` with error codes `gate_held` (retryable) / `gate_rejected` (non-retryable). Named pattern only.
- `Aggregate<I[],O>` → `Process<I[],O>` with Composer buffer config. Windowing belongs to Composer (see VI-2).
- All 4 cardinality patterns (1:1, 1:N, N:1, 1:0) expressed via TypeScript generics on `Process<I,O>`.
- `Process<I,never>` formally disqualified — anti-pattern; the ok path is unreachable. Filters are Composer predicates.
- `Reviewable<I>` unchanged — named `Process<I,I>` specialisation with field-level audit semantics. Gate does NOT subsume it.
**Key constraint:** Agent<I,O> deferred to Cat II. Source verb growth deferred to Cat III / v1.x.
**Consequence:** Gate and Aggregate are documented conventions, not new types. No Composer overload changes.

---

### VI-2: Composer owns buffer config for aggregate/windowed patterns

**Status:** RATIFIED
**Decision:** Window config lives on Composer, not on the stage. The Process receives a filled array and knows nothing about window boundaries.
API shape: `Composer.through(process, { buffer: { window: { type: 'count' | 'time' | 'all', n?: number } } })`.
Window types at v1: `count` (fixed N items), `time` (duration ms), `all` (collect-then-flush).
**Key constraint:** No `AggregateA.window` metadata on the stage type — moving config to Composer has zero semantic effect on the accumulator.
**Consequence:** One Composer config enhancement required. Cross-cuts Cat I kitStep() interaction with buffered batches (carry-forward to implementation).

---

### VI-3: StageErrorCode enumerated taxonomy

**Status:** RATIFIED
**Decision:** Kit-core ships `StageErrorCode` as a string literal union type and `StageError` structured error type. 19 codes total:

| Code | Category | Retryable |
|---|---|---|
| `source_unavailable` | Source | always |
| `source_timeout` | Source | always |
| `source_auth_failed` | Source | never |
| `source_schema_invalid` | Source | never |
| `process_failed` | Process | unknown |
| `process_timeout` | Process | always |
| `process_invalid_output` | Process | never |
| `serve_failed` | Serve | unknown |
| `serve_timeout` | Serve | always |
| `serve_auth_failed` | Serve | never |
| `serve_idempotency_conflict` | Serve | never |
| `gate_rejected` | Gate | never |
| `gate_timeout` | Gate | always |
| `gate_hold_expired` | Gate | always |
| `runtime_retry_exhausted` | Runtime | never |
| `runtime_cancelled` | Runtime | never |
| `runtime_concurrency_rejected` | Runtime | always |
| `resource_expired` | Resource | always |
| `runtime_budget_exceeded` | Runtime | never |

Error CODE is data (observable in `Result.error.code`). Retry ROUTING is control (kitStep shim maps code → `throw NonRetryableError`). Retryability table ships as a documented registry alongside the type.
**Key constraint:** No per-module error enums; no untyped string codes. One shared taxonomy.
**Consequence:** Resolves Cat IX cf #5 (enumerated taxonomy). `resource_expired` resolves Cat VIII cf #8. `adapter-inngest`'s `kitStep()` maps codes to retry policy.

---

### VI-4: Two-plane as convention + annotations, not structural types

**Status:** RATIFIED
**Decision:** `PipelineContext` stays as a single type. Fields annotated with JSDoc tags: `@control` (runId, signal, attempt, trace, deps), `@data-adjacent` (deps.memory content), `@user` (metadata).
The existing call-signature split `fn(atom: Atom<I>, ctx: PipelineContext)` is the correct abstraction — `Atom<T>` = data, `PipelineContext` = control. No `ControlPlane` interface.
OTel span attribution (the one conflation point with real value) handled by typed `Pick<PipelineContext, "runId" | "attempt" | "trace">` slices in helper functions.
`AbortSignal` stays on `ctx.signal`. `CancellationToken` (serialisable boolean for cross-runtime soft cancel) deferred to M2.
**Key constraint:** No new top-level types. Convention + annotations are zero-cost documentation.
**Consequence:** OTel helper functions (`recordControlSpanAttrs`, `recordDataSpanAttrs`) are the typed enforcement mechanism.

---

### VI-5: SerializableContext subset type for wire-crossing

**Status:** RATIFIED
**Decision:** Kit-core ships `SerializableContext` as an explicit subset type:
`{ runId: string; trace: { traceparent: string; tracestate?: string }; idempotencyKey: string }`
This is the ONLY context that crosses the TS→Python wire (per Cat IX ADR-IX-4 W3C Trace Context).
Excluded: `signal` (runtime object), `deps` (adapter references), `metadata` (PII risk, Cat VIII ADR-VIII-6), `attempt` (Python doesn't own retries — lifted to M2).
Helpers: `extractWireContext(ctx): SerializableContext` + `injectWireContext(frame, ctx)`.
**Key constraint:** Wire boundary is a named subset, not a plane split. `metadata` excluded by default.
**Consequence:** Load-bearing for Cat IX cross-runtime wire protocol. Helpers ship alongside the type in `@idriszade/core`.

---

### VI-6: DisposableRegistry as opt-in Composer escape hatch

**Status:** RATIFIED
**Decision:** `DisposableRegistry` ships as an additive enhancement — opt-in escape hatch for adapters not threaded through `deps`. Cat V ADR-V-2's `Disposable` interface is forwards-compatible: `registry.register(name, async () => adapter.close())`.
- Registry is Composer-opt via `{ registry? }` in `ComposerOptions`. NOT mandatory.
- LIFO disposal order (Fastify `onClose` pattern — when trigger depends on memory, trigger closes first).
- API: `registry.register(name: string, teardown: () => Promise<void>)`.
- Cost: ~40 LOC kit-core; +2 LOC per registered adapter; 0 cost for lifecycle-free adapters.
TC39 `Symbol.asyncDispose` alignment deferred to v1.x (Node 22+ — kit uses `close()` at v1.0).
**Key constraint:** Mandatory registry rejected — imposes cost on lifecycle-free adapters.
**Consequence:** Resolves Cat V cf #9. Cat V ADR-V-2 is the immediate ship; VI-6 is the additive escape hatch.

---

### VI-7: Two-signal disposal contract

**Status:** RATIFIED
**Decision:**
- Signal 1 — pipeline `AbortSignal`: scope = stages/atoms only. Meaning: "stop processing new work."
- Signal 2 — `DisposalOptions.timeoutMs`: scope = `disposeAll()` only. Meaning: "how long to wait for cleanup." Default: 5000ms.

Rules:
1. Disposal ALWAYS runs (happy path + error + abort).
2. Disposal IGNORES pipeline `AbortSignal`.
3. Per-adapter timeout via `Promise.race` (non-blocking to other adapters).
4. Errors + timeouts routed to `onError` / `onTimeout` callbacks — non-throwing.

Kit API: `composer.run(atoms, { deps, signal, disposal?: { timeoutMs?: number; onTimeout?: (name: string, err: Error) => void; onError?: (name: string, err: Error) => void } })`.
**Key constraint:** Disposal respecting pipeline AbortSignal causes resource leaks — explicitly forbidden.
**Consequence:** Prevents resource leaks on abort. Disposal timeout is per-pipeline, applied via `Promise.race` to each adapter's `close()`.

---

## §III — DAG Composition (2 ADRs)

### III-1: Linear API + adapter-tier patterns sufficient for v1; graph model deferred to v2

**Status:** RATIFIED
**Decision:** No new kit-core primitive required for v1 DAG-shaped workloads.
- *Linear chain* — zero gaps; generic type threading via `.through()` is a compile-time guarantee.
- *Gate at any step* — `Process<I,I>` slots into `.through()` unchanged; chain type parameter unaffected.
- *Parallel branches* — `Promise.all` + factory Source is canonical. Tuple type inference preserves heterogeneous branch types without casts (~20 LOC).
- *Fan-out → merge* — expressible via 3 pipeline executions + imperative assembly; explicit non-goal for v1. Threshold for adding: 2+ reference projects requiring merge within 12 months of v1 ship.
- *Back-edge/loop* — not expressible in Composer. `kitStep()` retry (ADR-I-2) is the natural substitute. Explicit non-goal.
`passthroughServe<O>(): Serve<O>` is a documented pattern (docs-only; not shipped in kit-core).
**Key constraint:** `Fan<I,Branches>` as Tier-2 primitive rejected (confirms ADR-IV-1). Graph model (declarative topology, `Pipeline.merge()`) rejected — LangGraph/Beam complexity not justified at personal-toolkit scale.
**Consequence:** No new API surface. Factory-Source pattern is canonical for typed branch inputs; adapter-inngest docs must show this alongside `kitFanOut()`.

---

### III-2: `RunOptions.parentTraceContext` for OTel span hierarchy across fan-out

**Status:** RATIFIED
**Decision:** Add `RunOptions.parentTraceContext?: TraceContext` (optional field). Branch pipelines pass the parent run's trace context; the OTel SDK uses it to establish parent-child span relationships.
`kitFanOut()` in `adapter-inngest` populates this field automatically from the parent step's context — callers get correct span hierarchy without manual wiring.
**Key constraint:** Implicit propagation via AsyncLocalStorage rejected — kit is a library; ALS availability across runtimes (Cloudflare Workers, Bun) is unsafe. Explicit opt-in via `RunOptions` is the correct seam.
**Consequence:** One-field addition to `RunOptions` in `@idriszade/core`. Non-breaking — existing callers unaffected. Adapter docs must note automatic population in `kitFanOut()`.

---

## §II — Agent Protocols (5 ADRs)

### II-1: Agent = named pattern on `Process<I,O>`; no new stage type

**Status:** RATIFIED
**Decision:** `AgentProcess<I,O>` is a type alias — `Process<I & AgentInput, O & ExtractOutput>` — naming convention, not a new type. Assignable to `Process<I,O>` with zero coercion. Multi-turn agentic loops (Anthropic SDK), tool-calling agents, and structured-extraction agents all return structured output from a single async function. Kit's `Process<I,O>` IS this pattern.
**Key constraint:** Dedicated `AgentStage<I,O>` type rejected — stage-type proliferation without new capability. Cat VI ADR-VI-1 precedent is definitive.
**Consequence:** Agent pipelines compose identically with non-agent stages. Kit remains 4-stage-type stable. Naming convention documented at adapter tier.

---

### II-2: MCP composition via existing Source/Serve adapters; no new primitives

**Status:** RATIFIED
**Decision:** MCP Resources = `Source<MCPResource>`. MCP Prompts = `Source<MCPPromptOutput>` variant. MCP Tool handler = `Serve<StructuredResult>` registration. Agent Process consumes `ctx.deps.mcpClient` as a dep (Cat VIII deps-shape). No new stage type.
**Key constraint:** `MCPSource<T>` as distinct stage type rejected — unnecessary subtype; plain Source suffices. Cat IX ADR-IX-5 governs adapter-tier placement.
**Consequence:** MCP pipelines compose with non-MCP stages transparently. MCP blob content decoding (`decodeMCPContent`) is an adapter-tier utility — lifted to v1 spec (MCP adapter package).

---

### II-3: Multi-agent handoff = Composer through-chain; protocol interop = Process-internal

**Status:** RATIFIED
**Decision:** Agent handoff = `.through(agentA).through(agentB)`. Composer through-chain enforces type constraint at compile time: Agent A output type IS Agent B input type.
Fan-out = `kitFanOut([agentP1, agentP2])` per Cat IV ADR-IV-7. Protocol choice (Anthropic, OpenAI, A2A) is an implementation detail inside the async Process body — invisible at the stage boundary.
A2A exposure = `Source<A2ATask>` + `Serve<FinalResult>` pair. Agent Card discovery is pre-pipeline HTTP metadata served before the pipeline runs — not a stage.
**Key constraint:** Agent-aware Composer routing primitive rejected — Cat IV ADR-IV-1 governs; protocol containment is the correct boundary.
**Consequence:** Protocol migrations (e.g., Anthropic → A2A) are Process body swaps — zero Composer changes.

---

### II-4: Agent session state = MemoryAdapter + sessionId key; A2A Agent Card = pre-pipeline metadata

**Status:** RATIFIED
**Decision:** Within-turn state = local variable inside Process body. Cross-turn session state = `ctx.deps.memory.get(sessionId)` / `.set(sessionId, state)`. No modern SDK bakes session state into the agent primitive (Anthropic, OpenAI Agents SDK, A2A all stateless per run).
A2A Agent Card = pre-pipeline HTTP metadata, not a stage. Agent Card serving is user-space setup — outside kit scope.
**Key constraint:** Session object threaded through Atom metadata rejected — Atom is data, not session carrier. Cat V ADR-V-1 governs.
**Consequence:** Stateful agent pipelines require MemoryAdapter in deps. Cross-turn state confirmed via `ctx.deps.memory` keyed by `sessionId`.

---

### II-5: `maxTurns` = per-Process config; StreamingProcess deferred to v2

**Status:** RATIFIED
**Decision:** `maxTurns` = per-Process constructor option with optional Composer-level override guard. Composer guard is a safety ceiling only, not primary config — per-agent limits reflect agent-specific contracts.
`StreamingProcess<I,O>` (AsyncIterable<O> variant) = v2 scope. Token streaming is covered at v1 via observer callback (`ctx.deps.observer?.onToken(chunk)`). v1 orchestration is final-result only.
**Key constraint:** `maxTurns` at Composer level only rejected — too coarse; different agents have different turn budgets. StreamingProcess deferred — no reference project drives the need.
**Consequence:** v1 agent configs carry `maxTurns` locally. Streaming output variant explicitly deferred — prevents premature API surface lock.
