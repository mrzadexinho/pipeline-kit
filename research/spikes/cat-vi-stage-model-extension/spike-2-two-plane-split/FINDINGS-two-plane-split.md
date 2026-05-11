# Spike #2 — two-plane-split FINDINGS

> Spike: structural probe — does kit need an ADR-level data/control-plane split
> in PipelineContext, or is the current flat context + convention sufficient?
> Branch: `v1-cat-VI-spike-2`. Author: Executor — 2026-05-11.
> Companion to: `docs/research-outline-v1.md` § Category VI (Stage Model Extension).
> Status: spike output (NOT a notes file; brain synthesises research-notes-v1-cat-VI.md later).
> Friction anchor: F-COMPOSE / F-INTEROP (cross-cuts from Cat IX cf #1, #2, #5).

---

## §1. SETUP

**Type:** Structural probe — 4 TypeScript files, no external deps, no real IO.

**Files:**
- `src/types.ts` — Three-option type exploration: Option A (explicit two-plane types),
  Option B (annotated PipelineContext), Option C (status quo). Includes `SerializableContext`
  + `NonSerializableContext` subset types + type-level wire-boundary verification.
- `src/probe-conflation-points.ts` — 4 conflation points enumerated and assessed.
- `src/probe-error-taxonomy.ts` — Minimum viable error taxonomy (16 codes); data vs control routing.
- `src/probe-cancellation-semantics.ts` — 3 ownership models; propagation traces; industry comparison.

**Cross-cuts entering this spike:**
- Cat IX cf #1: PipelineContext crossing the wire (`signal.aborted`, trace, `idempotencyKey`, `memory`).
- Cat IX cf #2: Cancellation semantics across runtimes (Python honour pipe-close as `signal.aborted`?).
- Cat IX cf #5 (spike #2 finding 7): Error-code enumerated taxonomy (stage-model error semantics).
- Cat IX ADR-v1-IX-4: W3C Trace Context out-of-band (NOT in atom data).
- Cat I ADR-v1-I-3: `retryable?: boolean` on `Err<E>` (NonRetryableError integration).
- Cat I O-4: `AbortSignal` not natively provided by Inngest — adapter must synthesise.

**Industry baseline:**
- Kafka: record value (data) + record headers (control).
- gRPC: message (data) + metadata (control). Context carries cancellation (`ctx.Done()`).
- HTTP: body (data) + headers (control). Both are bytes — no type-level split.
- Temporal: activity payload (data) + workflow context (control). CancellationScope is typed.
- Kubernetes: Pod spec (data) + annotations/labels (control). Both on the same object.

---

## §2. OBSERVATIONS

### O1 — Conflation points in current PipelineContext

4 conflation points enumerated:

| ID   | Fields conflated                           | Bug today? | Bug at scale? | Type-split prevents? |
|------|--------------------------------------------|------------|---------------|----------------------|
| CP-1 | `signal` (control) + `metadata` (data)    | NO         | YES           | NO                   |
| CP-2 | OTel span records atom (data) + ctx (ctrl) | NO         | YES           | YES (span helpers)   |
| CP-3 | `deps.memory` (ctrl ref, data content)     | NO         | NO            | NO                   |
| CP-4 | `Result.err` code (data) + retry routing   | NO         | YES           | NO                   |

**CP-1 (PII leakage):** Real mitigation is ADR-VIII-6 (PII redaction at Zod boundary), not a
structural type split. A split would make an overly-broad `log(ctx)` a type error — but developers
can still destructure and log individually. Type split is not the load-bearing defence.

**CP-2 (OTel spans) — the strongest case FOR the split:** Typed helper functions
`recordControlSpanAttrs(span, Pick<ctx>)` and `recordDataSpanAttrs(span, Atom<T>)` make
the separation auditable and statically checkable. This is the one conflation point where
typed distinction has real value — but it does NOT require a full `ControlPlane` interface.
`Pick<PipelineContext, "runId" | "attempt" | "trace">` is sufficient.

**CP-3 (MemoryAdapter):** The adapter reference is control-plane (non-serialisable, lifecycle-owning)
but its content is data-plane. Structurally analogous to HTTP (socket = infrastructure, body = data).
No type-level representation prevents this hybrid nature.

**CP-4 (Error code vs retry routing):** Error CODE is data (observable in `Result<T,E>`, returned
to user). RETRY ROUTING is control (kitStep shim maps code → `throw NonRetryableError`). The bug
(missing `retryable:false` for permanent failures) is prevented by a documented code registry,
not by types.

**Finding:** Type-level split directly prevents bugs at **1 of 4 conflation points**. At the
3 remaining points, the split adds ceremony without preventing the underlying bug.

---

### O2 — Error taxonomy: minimum viable for v1

17 error codes enumerated across 5 stage categories (16 from briefing + `runtime_concurrency_rejected`
added from Cat IV carry-forwards):

| Category | Codes | Plane | Default retryable |
|----------|-------|-------|-------------------|
| Source   | `source_unavailable`, `source_timeout` | data | true |
| Source   | `source_auth_failed`, `source_schema_invalid` | data+control | **false** |
| Process  | `process_failed`, `process_timeout` | data | true / unknown |
| Process  | `process_invalid_output` | data+control | **false** |
| Serve    | `serve_failed`, `serve_timeout` | data | true |
| Serve    | `serve_auth_failed`, `serve_idempotency_conflict` | data+control | **false** |
| Gate     | `gate_rejected`, `gate_timeout`, `gate_hold_expired` | data+control | **false** |
| Runtime  | `runtime_retry_exhausted`, `runtime_cancelled` | data+control | **false** |
| Runtime  | `runtime_concurrency_rejected` | data+control | true (requeue) |

**Finding: 11 of 17 codes are `data+control`** — observable in `Result<T,E>` (data) AND
drive retry/cancel routing (control). The dual nature is inherent, not a design flaw.

**Key distinction:** Error CODE is data (the label lives in `Result.error.code`, is logged,
returned to user). Retry ROUTING is control (kitStep shim maps the code to `throw
NonRetryableError(...)` for the Inngest adapter). The routing lives in the adapter shim,
NOT in the code value itself.

**Verdict:** Enumerated `StageErrorCode` union + `StageError` type are load-bearing for v1.
They prevent string-sniffed error matching (Cat IX spike #2 finding 7) and enable the
retryability table. Separating them into a `ControlPlane` type adds no information: the
code value is the same in both planes; only the READER's decision differs.

**Cross-adapter coverage:** Cat I Inngest adapter, Cat V memory, Cat VIII secrets all map
onto the 17-code taxonomy without speculative additions. Cat V's `MemoryError` feeds into
`StageError` via a translator in the adapter layer.

---

### O3 — Wire-crossing as natural plane boundary

**Test:** Does the serialisable subset of `PipelineContext` map onto the "data plane"?

**Result: NO — the wire boundary maps onto a SUBSET of the control plane, not the data plane.**

| Field | Serialisable? | Plane | Crosses wire? |
|-------|--------------|-------|---------------|
| `runId` | YES | control | YES (correlation) |
| `signal` | NO | control | NO (runtime object) |
| `attempt` | YES | control | NO (Python doesn't own retries) |
| `trace.traceparent` | YES | control | YES (ADR-v1-IX-4) |
| `idempotencyKey` | YES | control | YES (ambiguous — cf #1) |
| `deps.memory` | NO | data-adjacent | NO |
| `deps.secrets` | NO | control | NO |
| `metadata` | YES (structurally) | hybrid | NO (default; may contain PII) |

**Wire round-trip verified:** `{runId, traceparent, tracestate, idempotencyKey}` round-trips
through NDJSON parse cycle. `signal`, `deps`, `metadata` excluded. PII excluded. All PASS.

**Finding:** Serialisable fields are all control-plane, minus runtime objects (`signal`, `deps`).
The wire boundary is NOT the data/control split — it is a named subset: `SerializableContext`.
A two-plane type split would not simplify `extractWireContext()` — the extraction needs an
explicit field list regardless of how context is structured.

**`SerializableContext`** (defined in `src/types.ts`) is the correct abstraction: an explicit
subset type of `PipelineContext`, not a `DataPlane` or `ControlPlane`.

---

### O4 — Cancellation semantics

Three ownership models probed:

**Model (a) — Composer/ctx owns signal:** `AbortSignal` on `ctx.signal`. Stage checks
`signal.aborted` in iterator loops. Inngest gap: signal must be synthesised by adapter (Cat I O-4).
Python gap: signal not serialisable; Python is cancelled via pipe-close/SIGTERM. Both gaps
are adapter concerns. **PASS for TS-local. Adapter synthesis closes Inngest gap.**

**Model (b) — CancellationToken:** New kit type `{ cancelled: boolean; onCancel(cb) }`.
Bridges `AbortSignal` → serialisable boolean. Python receives `{ cancelled: true }` in next
wire frame. Value: soft-cancel propagation across the wire. Cost: new primitive + bridge
boilerplate in every adapter. Latency: 100ms+ wire round-trip — not atomic cancel.
**OPTIONAL — not ADR-level for v1.**

**Model (c) — Runtime owns cancellation:** Inngest `function.cancelled` event → adapter
checks `isRunCancelled()` after each `step.run()`. Python: stdin EOF is the signal (POSIX).
No new kit types. **PASS for Inngest. Models (a) and (c) compose.**

**Finding:** Formalising cancellation as a `ControlPlane` type does NOT simplify any of the
three models. Each model's complexity lives in the adapter bridge (event listener, pipe-close
handler), not in the context type structure.

---

### O5 — Industry comparison

| System | Data plane | Control plane | Formalised in types? |
|--------|-----------|---------------|---------------------|
| Kafka | Record value | Record headers | NO — both are bytes |
| gRPC | Protobuf message | Metadata (`context.Context`) | PARTIAL — `context.Context` typed but carries both |
| HTTP | Body | Headers | NO — both are bytes over TCP |
| Temporal | Activity payload | Workflow context + CancellationScope | YES — distinct types |
| Kubernetes | Pod spec | Annotations/labels | NO — both on the same `metadata` object |

**Pattern confirmed:** Almost no system formalises the two-plane split in TypeScript-level types.
The exception (Temporal) has a specific reason: workflow code must be deterministic; activity
payloads and workflow control state have genuinely different lifecycle semantics enforced at
compile time. **Kit is NOT a workflow engine** and does not share Temporal's determinism
constraint. Kit is library-tier (closer to HTTP/Kafka/gRPC-library, not Temporal-runtime).

**Key observation:** kit already HAS a functional two-plane split at the **call-signature level**:
`fn(atom: Atom<I>, ctx: PipelineContext) → Result<Atom<O>, E>`. `Atom<T>` is data;
`PipelineContext` is control. The split exists in the types — just not WITH an explicit
`ControlPlane` interface around the context fields.

---

### O6 — Verdict: ADR-level or implementation detail?

**The split is real. It is already expressed. It does not need new top-level types.**

Evidence:

1. `Atom<T>` (data) and `PipelineContext` (control-adjacent) are already distinct types in the
   stage handler signature. The two-plane split exists structurally. There is no `ControlPlane`
   type because `PipelineContext` IS the control-plane object — it just lacks the explicit label.

2. The conflation WITHIN `PipelineContext` (signal vs metadata vs deps) is handled better by
   JSDoc annotations (`@control`, `@data-adjacent`, `@user`) than by introducing a three-argument
   stage handler: `fn(atom, control, userMeta)` — more ceremony, same expressiveness.

3. The wire-crossing test found that serialisable fields = a named subset of control-plane fields,
   not a clean data/control split. `SerializableContext` (explicit subset type) is the right
   abstraction. It does not require a `ControlPlane` type to be defined first.

4. The OTel span case (CP-2) — the one case where a type-level distinction has value — is
   handled by `Pick<PipelineContext, "runId" | "attempt" | "trace">` slices in typed helper
   functions. No new top-level `ControlPlane` interface needed.

5. Industry pattern: none of the comparable systems (HTTP, Kafka, gRPC, K8s) formalise the
   split beyond what kit already has. Temporal does, but kit is not a workflow engine.

---

## §3. VERDICT

**CONVENTION + ANNOTATIONS. Not a new top-level type. Not an ADR-level structural change.**

Specifically:

- `PipelineContext` stays as a single type (Option B from `src/types.ts`).
- Fields annotated with `@control`, `@data-adjacent`, and `@user` JSDoc tags.
- `SerializableContext` (explicit subset type) ships for wire-crossing — **load-bearing**.
- Typed OTel helper functions (`recordControlSpanAttrs`, `recordDataSpanAttrs`) ship in the
  OTel instrumentation module — enforces data/control distinction at span attribution.
- Enumerated `StageErrorCode` (17 codes) + `StageError` type ship in kit core — closes Cat IX cf #5.
- Retryability table (code → policy) lives in kit docs + the Inngest adapter's kitStep() shim.
- `AbortSignal` stays on `ctx.signal` (model a local + model c Inngest adapter, additive).
- `CancellationToken` NOT shipped at v1 — carry as optional enhancement to Cat VI synthesis.

---

## §4. CARRY-FORWARDS

| # | Description | Destination |
|---|-------------|-------------|
| CF-VI-1 | `idempotencyKey` wire-crossing sub-key namespacing for Python subprocess. Does Python inherit `parentKey:py_step_N`? Ties to Cat IV RunGuard protocol. | Cat IV synthesis |
| CF-VI-2 | `CancellationToken` — optional enhancement for multi-runtime pipelines (Python soft-cancel via `cancelled:boolean` in wire context). Not ADR-level for v1; revisit in M2. | Cat VI synthesis (non-ADR) |
| CF-VI-3 | OTel span attribution helpers (`recordControlSpanAttrs` / `recordDataSpanAttrs`) — load-bearing once OTel instrumentation lands. `Pick<PipelineContext, ...>` slices. | Cat VI synthesis / OTel adapter |
| CF-VI-4 | Retryability table — 17 codes with `never`/`always`/`unknown` policy — must ship as documented registry in kit core alongside `StageError` type. | v1 spec (error taxonomy section) |
| CF-VI-5 | `metadata` wire opt-in — user metadata may need to cross the TS→Python wire. Default: excluded. Opt-in via explicit `wireMetadata?: Record<string, string>` on `SerializableContext`. | Cat IX / Cat VI synthesis |
| CF-VI-6 | `attempt` field usefulness for Python — whether retry attempt index should cross the wire (useful for Python logging but Python doesn't own retries). Low priority. | M2 cross-runtime adapter |
