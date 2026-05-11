# pipeline-kit — v1 Cat VI Research Notes: Stage Model Extension & Composer Lifecycle

> Phase 1 v1 synthesis. Author: Brain — 2026-05-11.
> Inputs: 3 spike FINDINGS files (`research/spikes/cat-vi-stage-model-extension/`).
> Friction anchor: F-PRIMITIVE (catalog top-15 #3) + F-COMPOSE / F-INTEROP cross-cuts.
> Status: synthesis complete; 7 ADR candidates locked direction; 20 carry-forwards dispositioned.

---

## Sources reviewed

### Spike evidence (3 spikes)
- Spike #1 (`04cb58c`, 2026-05-11) — `gate-and-aggregate`. 5 observations. Gate collapses to `Process<I,I>` + error-code conventions; Aggregate collapses to `Process<I[],O>` + Composer buffer config. Cardinality table proof (all 4 patterns via generics). Reviewable subsumption rejected (edit delta lost). Gate pattern documented, not typed. Industry comparison (Beam/Kafka/Flink/LangGraph/Effect.ts) confirms no dedicated Gate stage type exists anywhere.
- Spike #2 (`0afdc0a`, 2026-05-11) — `two-plane-split`. 6 observations. 4 conflation points assessed (1 of 4 mitigated by type split); wire-crossing mapped onto `SerializableContext` subset (NOT the data plane); error taxonomy enumerated (17 codes, 11 dual-plane); cancellation models probed (3 models, models a+c compose); industry comparison confirms no system formalises the split beyond what kit already has.
- Spike #3 (`8131153`, 2026-05-11) — `composer-lifecycle`. 5 observations. DisposableRegistry A vs B vs C probed (B ships; A additive Cat VI escape hatch); reconstruction via retry confirmed (`resource_expired`); seam convention confirmed as docs-only + `Disposable` as the typed cross-adapter convention; two-signal disposal design confirmed (pipeline AbortSignal ≠ disposal timeout). Industry: Fastify `onClose` is the exact structural match for Option A.

### External sources (from spike industry comparisons)
- **Streaming frameworks** — Apache Beam (`CombineFn`, windowing in framework), Kafka Streams (`.groupByKey().aggregate()`), Apache Flink (`WindowedStream.aggregate(AggregateFunction)`): all three separate windowing from accumulator.
- **Type systems** — Effect.ts (`.filterOrFail()` predicate, no aggregate primitive), LangGraph (conditional edges, not gate nodes).
- **Node.js lifecycle** — Express/Fastify `onClose` hooks (LIFO, plugin-registered teardowns); Go `defer` (panic-safe, ignores cancelled contexts); K8s `terminationGracePeriodSeconds` → SIGKILL.
- **Wire protocols** — Kafka record headers, gRPC metadata, HTTP headers, Temporal `CancellationScope` (the one system that formalises the split — because it is a workflow engine with determinism constraints kit does not share).

---

## Reframe note

The v1 outline posed 5 questions for Cat VI: (1) Gate<I> stage type?, (2) Aggregate<I[],O> stage type?, (3) Source<O> verb growth?, (4) two-plane formalisation?, (5) Process sub-type cardinality?. Spikes addressed 3 fully (Gate, Aggregate, two-plane) and 2 by deferral (Source growth to Cat III / v1.x; Agent<I,O> to Cat II). Two additional ADR-level decisions emerged from spike evidence that the outline did not anticipate: `SerializableContext` as a named wire-crossing type (VI-5) and `StageErrorCode` as an enumerated taxonomy closing Cat IX cf #5 (VI-3).

---

## Spike #1 — gate-and-aggregate

### What was built
Four probe files: content-moderation gate (3 ways), batch-summarise aggregate (3 ways), cardinality table TypeScript proof, Reviewable subsumption check. All probes strict TS, no runtime deps, exit 0.

### What it revealed
1. **Gate Way B wins.** `Process<I,I>` + `err({ code: "gate_held", retryable: true })` / `err({ code: "gate_rejected", retryable: false })` fully expresses gate semantics with OTel span, kit uniformity, and standard Composer wiring. Way A (`GateDecision<I>`) breaks kit uniformity (parallel return-type vocabulary). Way C (Composer predicate) loses OTel span observability.
2. **Composer owns buffering.** In Way A, `AggregateA.window` is metadata only — the Composer still fills the buffer and calls `accumulate()`. Moving `.window` to Composer config has zero semantic effect. `Process<I[],O>` is the correct type today.
3. **Cardinality via generics.** All 4 patterns (1:1, 1:N, N:1, 1:0) are `Process<I,O>` generic instantiations. `Process<I,never>` (1:0 as stage) is type-valid but semantically broken — filter is a Composer predicate.
4. **Reviewable NOT subsumed.** `Gate<I>` and `Reviewable<I>` are both `Process<I,I>` named patterns. Gate carries the full mutated atom; Reviewable carries a sparse `Partial<I>` delta. Edit delta (audit trail, `wasEdited` feedback, `applyEdits` validation) is lost in the gate envelope. No generalisation needed.
5. **Industry confirms verdict.** Zero streaming systems (Beam/Kafka/Flink/LangGraph/Effect.ts) have a dedicated Gate stage type. The absence is structural, not an oversight.

---

## Spike #2 — two-plane-split

### What was built
Four structural probe files: type exploration (Options A/B/C), 4 conflation points assessed, error taxonomy enumerated, 3 cancellation models traced.

### What it revealed
1. **Type split prevents bugs at 1 of 4 conflation points.** CP-2 (OTel span attribution) is the sole case where typed distinction adds real value — handled by `Pick<PipelineContext, "runId" | "attempt" | "trace">` slices in helper functions, not by a full `ControlPlane` interface.
2. **Wire boundary ≠ data/control split.** Serialisable fields are all control-plane minus runtime objects (`signal`, `deps`). `SerializableContext` is the correct abstraction: an explicit named subset, not a plane label.
3. **17 error codes, 11 dual-plane.** Dual nature (observable in `Result.error.code` AND drives retry routing) is inherent. Error CODE is data; retry ROUTING is the adapter shim's decision — both use the same code value. Separating them into a `ControlPlane` type adds no information.
4. **Cancellation models a+c compose.** `AbortSignal` on `ctx.signal` (local) + Inngest `function.cancelled` event (adapter) are additive and non-conflicting. `CancellationToken` (model b — serialisable boolean) deferred to M2.
5. **Kit already has the functional split.** `fn(atom: Atom<I>, ctx: PipelineContext)` — `Atom<T>` is data, `PipelineContext` is control. The split exists at the call-signature level without requiring a `ControlPlane` interface.

---

## Spike #3 — composer-lifecycle

### What was built
Four structural probe files: DisposableRegistry A/B/C comparison, reconstruction options (Cat VIII cf #8), seam convention uniformity check, abort-during-cleanup 4-scenario probe. No external deps; all probes exit 0.

### What it revealed
1. **Option B extensibility gap is real.** `composerDisposeAll(deps)` walks `Object.values(deps)` — adapters wired as module-local variables are silently skipped. Option A's `registry.register(name, teardown)` is the escape hatch that any code can call. B ships (Cat V ADR-V-2 confirmed); A is the additive Cat VI enhancement.
2. **`resource_expired` + retry is sufficient.** Reconstruction via `reconstruct()` hook (Option B) is rejected — it duplicates retry semantics with more surface area. Inngest step retry handles the outer loop natively (ADR-I-3). Cat VIII cf #8 RESOLVED.
3. **Seam convention is docs-only.** `AdapterConvention<Config, Instance>` typed base rejected. `Disposable` + `isDisposable()` IS the typed cross-adapter convention — the one shared behavioral contract across adapter types.
4. **Two-signal disposal confirmed.** Pipeline `AbortSignal` scope = stages/atoms only. `DisposalOptions.timeoutMs` scope = `disposeAll()` only. Disposal respecting the pipeline signal causes resource leaks (DB connections, interval handles). Scenarios 1-3 pass; rejected scenario (respects signal) leaks everything.
5. **Fastify onClose = exact structural match.** LIFO ordering, plugin-registered teardowns, framework-owned execution — structurally identical to Option A's `registry.register(name, teardown)` with LIFO.

---

## Open questions answered (from outline)

1. **`Agent<I,O>` stage type?** → Deferred to Cat II (F-AGENT). Spike #1 verdict that `Process<I,O>` is broad enough for all cardinality patterns suggests Agent would be another named pattern, but formal resolution is Cat II's authority.
2. **`Gate<I>` stage type?** → RESOLVED: `Process<I,I>` + error-code conventions (`gate_held` / `gate_rejected`). Neither generalises Reviewable nor requires a distinct primitive.
3. **`Aggregate<I[],O>` stage type?** → RESOLVED: `Process<I[],O>` + Composer buffer config. Window config belongs to Composer, not the stage.
4. **`Source<O>` verb growth?** → Deferred to Cat III / v1.x. Spike #2 implies checkpoint/health are context/convention concerns, not Source verb additions.
5. **Two-plane split?** → RESOLVED: convention + annotations, not ADR-level structural types. Two related ADR-level decisions emerged: `SerializableContext` (VI-5) and `StageErrorCode` (VI-3).

---

## Modern-direction framing

The 2024-26 streaming and pipeline consensus confirms kit's model: **all major streaming frameworks separate windowing from transform logic** — Beam `CombineFn`, Kafka `groupByKey().aggregate()`, Flink `WindowedStream.aggregate()`. None ships a dedicated Gate stage type; gate semantics are universally expressed as transforms with conditional output. Kit's 4-stage model (Source, Process, Serve, Store) is aligned with this consensus, not an arbitrary restriction.

The lifecycle direction in the Node.js ecosystem converges on **framework-owned resource lifetime** — Fastify `onClose` hooks, K8s `terminationGracePeriodSeconds`, Go `defer`. Kit's `DisposableRegistry` (Option A) follows this pattern exactly: Fastify's plugin `onClose` is structurally identical to `registry.register(name, teardown)` with LIFO ordering.

The wire/context direction: **no comparable system formalises a typed ControlPlane object**. Kafka, gRPC, HTTP, and K8s all co-locate data and control on the same wire object (bytes, headers, annotations). Temporal does formalise the split — but Temporal is a deterministic workflow engine with replay constraints that kit, as a library, does not share. Kit's `Atom<T>` (data) + `PipelineContext` (control) split at the call-signature level is already the correct abstraction depth.

---

## ADR candidates

### ADR-v1-VI-1 — 4-stage model preserved; no new stage primitives

**Status:** v1 candidate (synthesis 2026-05-11). Awaiting brain v1 spec lock.

**Context:** v1 outline asked whether `Gate<I>`, `Aggregate<I[],O>`, `Agent<I,O>`, and Process sub-types need new stage interfaces. Spike #1 probed all candidates.

**Decision:** Kit's 4-stage model (Source, Process, Serve, Store) is confirmed sufficient. No new stage types at v1.

- `Gate<I>` collapses to `Process<I, I>` with two error-code conventions: `gate_held` (retryable) maps to HRP `waitForEvent` (ADR-I-5); `gate_rejected` (non-retryable) maps to `NonRetryableError` (ADR-I-3). Documented as "gate pattern" — no interface changes.
- `Aggregate<I[], O>` collapses to `Process<I[], O>` with Composer buffer config. Windowing belongs to Composer (see ADR-VI-2).
- All 4 cardinality patterns (1:1, 1:N, N:1, 1:0) expressed via TypeScript generics on `Process<I, O>`. No new interfaces. 1:0 (filter) is a Composer predicate, NOT `Process<I, never>` (type-valid but semantically broken — ok path unreachable).
- `Reviewable<I>` unchanged — remains a named `Process<I, I>` specialisation with field-level audit semantics (edit delta). Gate does NOT subsume Reviewable (spike #1 O4).
- `Agent<I,O>` deferred to Cat II (F-AGENT depends on Cat VI primitives). Cat II has formal authority.
- `Source<O>` growth (checkpoint/health) deferred — spike #2 implies context/convention concerns, not Source verb growth. Carry to Cat III / v1.x.

**Alternatives considered:** Way A (`GateDecision<I>` — new return-type vocabulary) rejected; breaks kit uniformity (parallel vocab, separate Composer overload). Way C (Composer config predicate — no stage) rejected; loses OTel span observability.

**Reference:** Spike #1 §2 O1-O5 + §3; industry comparison (Beam/Kafka/Flink — NO streaming system has a dedicated Gate stage type).

**Consequences:** Gate and Aggregate join the "named patterns" in kit docs — conventions on existing types, not new types. `Process<I,never>` formally disqualified as anti-pattern.

---

### ADR-v1-VI-2 — Composer buffer config for aggregate/windowed patterns

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #1 established Aggregate collapses to `Process<I[],O>`. Remaining question: who owns the buffering that fills the `I[]` array?

**Decision:** Composer owns buffering. Window config lives on Composer, not on the stage. Minimal API: `Composer.through(process, { buffer: { window: { type: 'count', n: 5 } } })`. Window types at v1: `count` (fixed N), `time` (duration), `all` (collect-then-flush). The Process receives a filled array — it knows nothing about window boundaries.

**Alternatives considered:** `AggregateA.window` metadata on stage type (rejected — Composer still fills buffer; moving `.window` to config has zero semantic effect). Source inversion (Way C) rejected; upstream coupling prevents Composer reordering.

**Reference:** Spike #1 §2 O2, backpressure probe; industry: Beam `CombineFn` / Kafka `.aggregate()` / Flink `WindowedStream.aggregate()` — all three major frameworks separate windowing from accumulator.

**Consequences:** One Composer config enhancement needed (buffer option). Cross-cuts Cat I (how `kitStep()` interacts with buffered batches — carry-forward).

---

### ADR-v1-VI-3 — StageErrorCode enumerated taxonomy

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #2 enumerated 17 error codes across 5 stage categories. Cat IX cf #5 required an enumerated taxonomy to prevent string-sniffed error matching.

**Decision:** Kit-core ships `StageErrorCode` as a string literal union type + `StageError` structured error type. Minimum viable codes (18 total, adding `resource_expired` from spike #3 O2):

- Source (4): `source_unavailable`, `source_timeout`, `source_auth_failed`, `source_schema_invalid`
- Process (3): `process_failed`, `process_timeout`, `process_invalid_output`
- Serve (4): `serve_failed`, `serve_timeout`, `serve_auth_failed`, `serve_idempotency_conflict`
- Gate (3): `gate_rejected`, `gate_timeout`, `gate_hold_expired`
- Runtime (3): `runtime_retry_exhausted`, `runtime_cancelled`, `runtime_concurrency_rejected`
- Resource (1): `resource_expired` (non-re-readable resource refresh)

Each code has a default retryability policy (`never` / `always` / `unknown`). Retryability table ships as a documented registry alongside the type. Error CODE is data (observable in `Result.error.code`). Retry ROUTING is control (kitStep shim maps code → `throw NonRetryableError`). The dual nature is inherent — separating them into a `ControlPlane` type adds no information.

**Alternatives considered:** Per-module error enums (rejected — prevents cross-stage error handling). Untyped string codes (rejected — string-sniffed matching is the Cat IX friction). Numeric codes (rejected — less greppable).

**Reference:** Spike #2 §2 O2; spike #3 §2 O2 (`resource_expired` added); Cat I ADR-I-3 (`retryable` field on `Err<E>`); Cat IX cf #5.

**Consequences:** Resolves Cat IX cf #5 (enumerated taxonomy). `resource_expired` resolves Cat VIII cf #8 (non-re-readable resources → existing retry semantics). adapter-inngest's `kitStep()` maps codes to retry policy.

---

### ADR-v1-VI-4 — Two-plane as convention + annotations, not structural types

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Outline asked whether the data/control-plane split in `PipelineContext` warrants ADR-level structural types. Spike #2 probed 4 conflation points and 3 cancellation models.

**Decision:** The split is real, already expressed (`Atom<T>` = data, `PipelineContext` = control-adjacent), and does NOT need new top-level types.

- `PipelineContext` stays as a single type.
- Fields annotated with `@control` (runId, signal, attempt, trace, deps), `@data-adjacent` (deps.memory content), `@user` (metadata) JSDoc tags.
- OTel span case (the one conflation point where type-level distinction has value) handled by `Pick<PipelineContext, "runId" | "attempt" | "trace">` slices in typed helper functions — no `ControlPlane` interface needed.
- `AbortSignal` stays on `ctx.signal` — model (a) locally + model (c) via Inngest adapter, composing. `CancellationToken` (model b — serialisable boolean for cross-runtime soft cancel) deferred to M2.

**Alternatives considered:** Option A (explicit `ControlPlane` + `DataPlane` types) rejected; only prevents bugs at 1 of 4 conflation points; adds ceremony. Option C (status quo, no annotations) rejected; annotations are zero-cost documentation that prevent CP-2 OTel conflation.

**Reference:** Spike #2 §2 O1 (4 conflation points), O4 (cancellation models), O5 (industry: none of Kafka/gRPC/HTTP/K8s formalise the split; Temporal does but kit is not a workflow engine), O6 (verdict).

**Consequences:** No new types. Convention + annotations ship in v1 implementation. OTel helper functions (`recordControlSpanAttrs`, `recordDataSpanAttrs`) are the typed enforcement mechanism.

---

### ADR-v1-VI-5 — SerializableContext subset type for wire-crossing

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #2 O3 tested whether the serialisable subset of `PipelineContext` maps to the "data plane." Answer: NO — it maps to a subset of the control plane. The wire boundary is a named subset, not a plane split.

**Decision:** Kit-core ships `SerializableContext` as an explicit subset type of `PipelineContext`. Fields: `{ runId, trace: { traceparent, tracestate }, idempotencyKey }`. This is the ONLY context that crosses the TS→Python wire (Cat IX ADR-IX-4 W3C Trace Context).

Non-serialisable fields excluded: `signal` (runtime object), `deps` (adapter references), `metadata` (default excluded — PII risk per Cat VIII ADR-VIII-6). `attempt` excluded (Python doesn't own retries — carry to M2).

**Reference:** Spike #2 §2 O3 (wire round-trip verified); Cat IX ADR-IX-4 (trace context out-of-band).

**Consequences:** Load-bearing for Cat IX cross-runtime wire protocol. `extractWireContext(ctx): SerializableContext` + `injectWireContext(frame, ctx)` helpers ship alongside the type.

---

### ADR-v1-VI-6 — DisposableRegistry as opt-in Composer escape hatch

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Cat V ADR-V-2 ships `Disposable` opt-in (deps-aware disposal via `isDisposable` + `disposeAll`). Spike #3 O1 identified the extensibility gap: Option B can only see adapters in the `deps` shape. Custom adapters wired as module-local variables are silently skipped.

**Decision:** `DisposableRegistry` ships as an additive Cat VI enhancement — an opt-in escape hatch for adapters not threaded through `deps`. Relationship to Cat V ADR-V-2: V-2's `Disposable` interface is forwards-compatible — `registry.register(name, async () => adapter.close())`.

- Registry is Composer-opt (`{ registry? }` in `ComposerOptions`), NOT Composer-mandatory.
- LIFO disposal order (Fastify `onClose` pattern — when trigger depends on memory, trigger closes first).
- `registry.register(name, teardown: () => Promise<void>)` — explicit, any object.
- ~40 LOC pay-once kit cost; +2 LOC per registered adapter; 0 cost for lifecycle-free adapters.

TC39 `Symbol.asyncDispose` alignment deferred to v1.x (Node 22+; kit uses `close()` at v1.0 for self-containedness).

**Alternatives considered:** Option B only (rejected as ceiling — extensibility gap is real at N > 3 adapters). Option C self-managed (rejected — error isolation is user's problem; scales linearly). Mandatory registry (rejected — imposes cost on lifecycle-free adapters).

**Reference:** Spike #3 §2 O1 (3-option comparison), O5 (Fastify `onClose` = exact structural match); Cat V ADR-V-2 (forwards-compatible).

**Consequences:** Resolves Cat V cf #9 (DisposableRegistry carry-forward). Cat V ADR-V-2 is the immediate ship; VI-6 is the additive escape hatch.

---

### ADR-v1-VI-7 — Two-signal disposal contract

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #3 O4 probed 4 scenarios of abort-during-cleanup. Key finding: disposal respecting pipeline `AbortSignal` causes resource leaks (DB connections, interval handles).

**Decision:** Two-signal contract:
- Signal 1: pipeline `AbortSignal` — scope = stages/atoms only. "Stop processing new work."
- Signal 2: `DisposalOptions.timeoutMs` — scope = `disposeAll()` only. "How long to wait for cleanup." Default: 5000ms.

Rules:
1. Disposal ALWAYS runs (happy path + error + abort).
2. Disposal IGNORES pipeline `AbortSignal`.
3. Per-adapter timeout via `Promise.race` (non-blocking to other adapters).
4. Errors + timeouts routed to `onError` / `onTimeout` callbacks (non-throwing).

Kit API shape: `composer.run(atoms, { deps, signal, disposal?: DisposalOptions })` where `DisposalOptions = { timeoutMs?: number; onTimeout?: (name, err) => void; onError?: (name, err) => void }`.

**Reference:** Spike #3 §2 O4 (4 scenarios + rejected option), O5 (industry: Node.js `server.close`, K8s `terminationGracePeriodSeconds` → SIGKILL, Go `defer` ignores cancelled contexts).

**Consequences:** Prevents resource leaks on abort. Disposal timeout is configurable per-pipeline, not per-adapter (per-adapter timeout = same `timeoutMs` applied via `Promise.race` to each adapter's `close()`).

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)
- **spike #1 cf #1** (Composer buffer config shape) → RESOLVED by ADR-VI-2
- **spike #1 cf #2** (StageError code taxonomy) → RESOLVED by ADR-VI-3
- **spike #1 cf #7** (Process<I,never> disqualification) → RESOLVED by ADR-VI-1 (noted as anti-pattern)
- **spike #2 CF-VI-4** (retryability table) → RESOLVED by ADR-VI-3
- **spike #3 cf** (DisposableRegistry opt-in vs mandatory) → RESOLVED by ADR-VI-6 (opt-in)
- **spike #3 cf** (LIFO vs insertion-order) → RESOLVED by ADR-VI-6 (LIFO)
- **spike #3 cf** (`resource_expired` in taxonomy) → RESOLVED by ADR-VI-3
- **Cat V cf #9** (DisposableRegistry) → RESOLVED by ADR-VI-6
- **Cat VIII cf #8** (non-re-readable resource reconstruction) → RESOLVED by ADR-VI-3 (`resource_expired` + retry)
- **Cat IX cf #5** (enumerated error taxonomy) → RESOLVED by ADR-VI-3

### Lifted to future milestones or categories
- **spike #1 cf #3** (hold timeout propagation path) → LIFTED to Cat I / v1 spec (timeout in `StageError.metadata` or dedicated field)
- **spike #1 cf #4** (Reviewable feedback loop via MemoryAdapter) → LIFTED to Cat V cf / v1.x
- **spike #1 cf #5** (Disposable lifecycle + buffering-Source) → LIFTED to v1.x (not a v1 blocker)
- **spike #1 cf #6** (1:N cardinality + Composer fan-out reconciliation) → LIFTED to Cat IV (cross-cut)
- **spike #2 CF-VI-1** (idempotencyKey sub-key namespacing for Python) → LIFTED to Cat IX / Cat IV
- **spike #2 CF-VI-2** (CancellationToken for multi-runtime) → LIFTED to M2
- **spike #2 CF-VI-3** (OTel span attribution helpers) → LIFTED to OTel adapter implementation
- **spike #2 CF-VI-5** (metadata wire opt-in) → LIFTED to Cat IX
- **spike #2 CF-VI-6** (attempt field for Python) → LIFTED to M2
- **spike #3 cf** (TC39 `Symbol.dispose` alignment) → LIFTED to v1.x (Node 22+)

---

*End of v1 Cat VI research notes. 7 ADR candidates locked direction; 20 carry-forwards dispositioned (10 resolved by ADRs, 10 lifted). 4-stage model confirmed — Gate and Aggregate collapse to named patterns on `Process<I,O>`. Two-plane split is convention, not types. `StageErrorCode` taxonomy (18 codes) closes Cat IX cf #5. `DisposableRegistry` + two-signal disposal are the Composer lifecycle additions. Cat III (DAG / linear extension) NEXT in spike order.*

*Author: Brain — 2026-05-11. Inputs: spike #1 `04cb58c` / spike #2 `0afdc0a` / spike #3 `8131153`. Branch: `master`. Master tip at synthesis: `8131153`.*
