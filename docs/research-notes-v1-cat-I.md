# v1 Research Notes — Cat I: Durable Execution

> Phase 1 v1 synthesis. Author: Brain — 2026-05-10.
> Inputs: 2 spike FINDINGS files (`research/spikes/durable-execution/`).
> Friction anchor: F-DURABLE (catalog top-15; step-function runtime composition).
> Status: synthesis complete; 7 ADR candidates locked direction; 14 carry-forwards resolved.

---

## Sources reviewed

### Spike evidence (this kit, 2 throwaway spikes — empirical truth)
- Spike #1 (`f9f5fca`, 2026-05-10) — `step-function-compose`. 4-experiment structure. Inngest v4 + `@inngest/test`. Per-step retry confirmed; Result→throw shim design; PipelineContext mapping; checkpoint visibility per step. Surfaced O-1..O-5 + 9 carry-forwards.
- Spike #2 (`5771531`, 2026-05-10) — `multi-atom-hrp`. 3-experiment structure. Leg 1: dynamic N-atom for-loop step IDs (replay fingerprint confirmed at N=3). Leg 2: `step.waitForEvent` as HRP-review checkpoint; approved + timeout paths both confirmed. 5 carry-forwards (#10-#14).

### External sources (modern industry standards 2024-26)
- **Inngest v4** — TS-first, event-driven, self-hostable. `step.run()` / `step.waitForEvent()` / `step.invoke()`. PostgreSQL-backed durability. SDK peer dep `^4.0.0`.
- **Temporal** — workflow engine; activity-per-step model; deterministic workflow code; gRPC-based. Generalises the composition pattern.
- **Trigger.dev v3** — TS-first; task-per-step model; compatible adapter pattern.
- **pg-boss / BullMQ** — job-queue primitives; per-JOB retry only, no per-step checkpoint. Demoted to user-glue tier.
- **Inngest NonRetryableError** — v4-native dead-letter primitive; maps to `retryable: false` Err metadata.
- **W3C Trace Context** — not directly probed; parallel Cat IX ADR-v1-IX-4 covers propagation; not repeated here.

---

## Spike #1 — step-function-compose

### What was built
3-stage kit-shaped pipeline (Source→Process→Serve), no `@idriszade/*` imports. Executed via Inngest `InngestTestEngine` (Dev Server binary unavailable via bunx). 4 experiments: (A) full pipeline; (B) Result.err vs throw — shim probe; (C) single-step checkpoint via `executeStep("source")`; (D) PipelineContext mapping enumeration.

### What it revealed
1. **Per-step retry confirmed (O-1).** N=3 steps → function body re-executes N times; each step handler runs exactly once. Earlier step outputs replayed from durable state — the handler does NOT re-run. Effect is per-atom retry from kit's perspective.
2. **State threading confirmed (O-2).** `step.run()` return values persist durably across step boundaries and are available as variables in subsequent closures. `sourceAtom` (step-1 output) accessible inside step-3 handler. 1:1 match to kit's atom-threading model.
3. **Result.err does NOT trigger Inngest retry (O-3).** Inngest treats ANY return value as step-success. `Result.err(...)` silently advances the pipeline with a failed result. Throw is the ONLY retry trigger. **The kitStep() shim is load-bearing.**
4. **Clean PipelineContext mapping with one gap — AbortSignal (O-4).** `runId`, `attempt`, `event.data`, and all stage deps map cleanly. `signal: AbortSignal` is not natively provided by Inngest; adapter must synthesise or omit.
5. **Per-step checkpoint confirmed (O-5).** `InngestTestEngine.executeStep("source")` returns the complete kit Atom<T> envelope (id, object, created_at, metadata, data). Granularity matches kit's atom boundary exactly.

### Code snippet — kitStep() shim (O-3)
```ts
// Without shim (BROKEN): Result.err returns, pipeline advances silently
const processResult = await step.run("process", async () => myKitProcess(input));

// With shim (CORRECT): Result.err → throw → Inngest retry
async function kitStep<T, E>(
  step: StepTools,
  id: string,
  fn: () => Promise<Result<T, E>>
): Promise<T> {
  const result = await step.run(id, fn);
  if (!result.ok) throw new Error(`kit:step_error code=${String(result.error)}`);
  return result.value;
}
```

---

## Spike #2 — multi-atom-hrp

### What was built
Leg 1: dynamic N-atom for-loop step IDs with `step.run(`process-${atom.id}`, ...)`. N=3 atoms. Execution ledger captured. Leg 2: `step.waitForEvent("wait-for-hrp", { match: "data.runId", timeout })` as HRP-review checkpoint. Approved path (reviewer=alice) and timeout path (returns null) both exercised. `InngestTestEngine` used with `transformCtx` workaround for waitForEvent (steps-array mock broken in v1.0.0).

### What it revealed
1. **Dynamic step IDs replay correctly (L1-O1).** `process-pk_atom_a/b/c` — each handler ran exactly once. Inngest keys step memoization by the ID string (internally hashed). Deterministic IDs across replays = correct replay.
2. **For-loop replay fingerprint confirmed (L1-O2).** N=3 atoms, 5 total steps (source + 3 process + serve). Function body re-executed 6 times (N_steps + 1). Formula from spike #1 generalises to N.
3. **CRITICAL footgun — unstable step IDs break replay (L1-O4).** Source computed OUTSIDE `step.run()` can produce different atom IDs between replays → Inngest runtime error. Source MUST be wrapped in `step.run()`. This is the single load-bearing replay-safety constraint.
4. **HRP checkpoint confirmed — clean composition (L2-O2, L2-O3, L2-O4).** `step.waitForEvent` maps directly to `Reviewable<I>` checkpoint. Approved path: payload `{ name, data }` with `data.approved=true, data.reviewer`. Timeout path: `null` return; function continues. No new kit-shape primitives required.
5. **kitStep() shim stable for N-atom composition (§4 cross-cut).** Shim is stateless; called once per atom per step; no changes required for multi-atom loop.

### Code snippet — replay-safety constraint (L1-O4)
```ts
// BROKEN — atoms unstable if source content changes between replays
const atoms = await fetchFromDB();
for (const atom of atoms) await step.run(`process-${atom.id}`, fn);

// CORRECT — source memoized; atom IDs stable across all replays
const atoms = await step.run("source", () => fetchFromDB());
for (const atom of atoms) await step.run(`process-${atom.id}`, fn);
```

---

## Open questions answered (from outline)

### Q1 — Per-step retry granularity: step-function or job-queue?
**Step-function, per-atom.** O-1 confirmed: each `step.run()` wrapping one kit atom is a distinct checkpoint. Earlier step handlers do not re-run on retry. Job queues (pg-boss, BullMQ) retry the whole job — per-atom granularity requires step-function runtime. (See ADR-v1-I-1.)

### Q2 — Kit Composer integration shape: thin adapter or documented pattern?
**Thin adapter** (`@idriszade/adapter-inngest`). Spike #1 §9 verdict: three non-trivial constraints (kitStep shim + AsyncIterator flatten + replay-safe wiring) make this a dedicated adapter module, not a documentation note. Spike #2 confirms shim stable for multi-atom composition. (See ADR-v1-I-2 + ADR-v1-I-7.)

### Q3 — Result<T,E> vs throw composition?
**kitStep() shim is load-bearing.** O-3: Inngest does not inspect return-value shape. `Result.err(...)` without a shim silently advances the pipeline. The shim (~8 LOC) lives at the adapter boundary, NOT in kit core. (See ADR-v1-I-2.)

### Q4 — PipelineContext mapping?
**Near-complete; one gap.** `run_id`, `event.data`, and deps close correctly. `attempt` added as optional field. `signal: AbortSignal` is adapter-synthesised or omitted — not Inngest-native. (See ADR-v1-I-4.)

### Q5 — HRP checkpoint mapping?
**step.waitForEvent = Reviewable<I> checkpoint.** L2-O4: clean 1:1 mapping. Pause = waitForEvent; review request = step.run(webhook); correlation = match:data.runId; resume = event received; timeout = null return → per-checkpoint policy. (See ADR-v1-I-5.)

---

## Open questions unresolved (carry-forwards)

1. **(cf #2 — LIFTED to M2)** AsyncIterator → sequential `step.run()` flattening utility. Phase 3 implementation concern; ADR direction is established (flatten the iterator). M2 adapter code concern, not Phase 1 research.
2. **(cf #8 — LIFTED to M2)** `InngestTestEngine` error propagation: `execute()` returns `{ result: undefined }` on function-level throw rather than re-throwing. Kit adapter test docs must document `transformCtx` pattern. Adapter test-suite authoring concern.
3. **(cf #10 — LIFTED to Cat IV)** Parallel fan-out probe: `step.invoke()` for parallel multi-atom composition. Sequential for-loop covers serial fan-out; parallel requires a distinct Inngest primitive. Carry to Cat IV (Orchestration Patterns) or M2.
4. **(cf #11 — LIFTED to housekeeping)** `@inngest/test@1.0.0` steps-array `waitForEvent` bug: `result.data` (Promise) passed to `validateEvents` before awaiting. One-line fix at `engine.js:1433`. Upstream report welcome; does not block ADR direction.
5. **(cf #12 — LIFTED to Cat VI)** HRP + MemoryAdapter composition: if pipeline persists checkpoint state to a MemoryAdapter before `step.waitForEvent`, `Disposable` lifecycle (ADR-V-2) must compose with Inngest function lifecycle. Cross-cuts Cat VI (Lifecycle Management).

---

## Modern-direction framing (2024-26 industry context)

Step-function runtimes — Inngest, Temporal, Trigger.dev — are the 2024-26 industry standard for durable execution, replacing raw job queues (pg-boss, BullMQ, Celery). The defining characteristic is **per-step checkpointing and replay**, not per-job retry. A job queue knows "this job failed"; a step-function runtime knows "step 3 of this job failed; steps 1-2 are memoized; retry step 3 only."

**Why this matters for kit:** kit's atom-per-step composition maps onto step-function granularity exactly. Each atom is a checkpoint unit. Retry, observability, and HRP-review checkpoints all align to the atom boundary without additional instrumentation. A job queue can approximate this only by splitting each atom into a separate job — no native composition, no built-in HRP-pause primitive.

**Inngest's fit for kit's constraints:** TS-first SDK (TS-primary per v0); self-hostable (PostgreSQL-backed, no vendor lock-in); event-driven (HRP checkpoints map to events natively); v4 NonRetryableError shipped (dead-letter ergonomics). Trigger.dev v3 is structurally similar; Temporal is lower-level (gRPC, workflow-code discipline) but the composition pattern (atom-per-activity + result→throw + replay-safe wiring) generalises.

**The adapter shape is runtime-agnostic in principle.** The kitStep() shim concept — translate Result.err → throw at the adapter boundary — is not Inngest-specific. Temporal uses activity-level exceptions; Trigger.dev uses task-level throws. Each adapter speaks its runtime's native protocol. Kit does NOT abstract over runtimes; each adapter is idiomatic to its target.

**Non-goals (explicit rejections):**
- Kit is NOT a workflow engine. Does not own checkpoint storage, retry scheduling, or run persistence.
- Kit does NOT lock users to Inngest. pg-boss/BullMQ documented as user-glue-tier pattern.
- Kit does NOT ship a generic `DurableRuntime<T>` interface. Each adapter is idiomatic; a common interface would be leaky (`step.waitForEvent` ≠ Temporal activity heartbeat).

---

## ADR candidates

### ADR-v1-I-1 — Step-function runtime as kit's durable execution composition layer

**Status:** v1 candidate (synthesis 2026-05-10). Awaiting brain v1 spec lock.

**Context:** F-DURABLE: constellation projects (orchestr8, gatewerk, pursuit) need pipelines that survive process restarts, retry individual failed atoms, and support human-review checkpoints. v0 Composer runs in-process; no durability. Cat I Q1 asks: per-step or per-job granularity?

**Decision:** Kit composes with step-function runtimes at the atom-per-step boundary. Each `step.run()` wraps one kit atom (Source emit, Process transform, Serve output). Kit is a pipeline library that COMPOSES WITH workflow engines; it is NOT a workflow engine. The durable execution runtime owns checkpointing, retry scheduling, and run persistence. Kit owns typed-stage composition, Result<T,E> semantics, and Zod boundary validation.

**Alternatives considered:**
- *Raw job queue (pg-boss, BullMQ).* Rejected as kit primitive — no native per-step checkpointing; builds 2018-era durability on a queue primitive. Demoted to user-glue-tier documented pattern for teams who refuse a step-function framework.
- *Kit as workflow engine.* Rejected — violates "library not runtime" principle; duplicates Inngest/Temporal/Trigger.dev with no competitive advantage.
- *Whole-pipeline-as-one-step.* Rejected — defeats step-function retry granularity; Inngest retries the entire pipeline on any failure; per-atom retry granularity lost.

**Reference:** Spike #1 O-1 (per-step retry confirmed), O-2 (state passing confirmed), O-5 (per-step checkpoint = per-atom). Spike #2 L1-O1 (dynamic N-atom step IDs confirmed). Modern-direction framing (per-step checkpoint is the defining characteristic of 2024-26 durable execution).

**Consequences:**
- Kit Composer fan-out (AsyncIterator) must be flattened to sequential `await step.run()` calls in the Inngest adapter (cf #2, M2 implementation).
- Code in the Composer wiring function (between `step.run()` calls) re-executes on every replay — safe because kit mandates "functional core, imperative shell" (no side effects between steps).
- Per-atom retry granularity is unlocked: a transient failure at atom N retries atom N only; atoms 0..N-1 are replayed from durable state.
- pg-boss/BullMQ pattern documented in kit guides as user-glue tier; no pack-tier adapter shipped at v1.

### ADR-v1-I-2 — Result&lt;T,E&gt; → throw bridging shim at adapter boundary

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #1 O-3 HEADLINE: Inngest's retry protocol is throw-only. `Result.err(...)` returned from a `step.run()` handler is treated as step-success — Inngest does not inspect the return-value shape. Without a bridging shim, transient failures returned as `Result.err` silently advance the pipeline with a failed result. Kit's no-throw-across-public-API discipline must be preserved inside stage handlers.

**Decision:** A thin `kitStep()` shim (~8 LOC) at the adapter boundary translates `Result.err(...)` → `throw` for Inngest's throw-only retry protocol. Kit's Result<T,E> discipline stays intact inside stage handlers. The shim lives in the adapter module, NOT in kit core. Spike #2 §4 confirms the shim is stateless and composes correctly for N-atom loops (called once per atom, no state accumulated).

```ts
async function kitStep<T, E>(
  step: StepTools,
  id: string,
  fn: () => Promise<Result<T, E>>
): Promise<T> {
  const result = await step.run(id, fn);
  if (!result.ok) throw new Error(`kit:step_error code=${String(result.error)}`);
  return result.value;
}
```

**Alternatives considered:**
- *Throwing inside stage handlers.* Rejected — violates Result<T,E> contract; throws cross the public API boundary.
- *Inngest retry on return-value inspection.* Rejected — Inngest SDK does not support this; throw is the only retry trigger per SDK design.
- *Embedding shim in kit core.* Rejected — adapter concern, not kit concern; other runtimes (Temporal, Trigger.dev) have different retry protocols; shim must be adapter-idiomatic.

**Reference:** Spike #1 §4 O-3 (Result.err does NOT trigger Inngest retry); spike #2 §4 cross-cut (kitStep stable for N-atom composition).

**Consequences:**
- **Resolves cf #1** (kitStep shim design).
- Adapter module exposes `kitStep()` as a named export; adapter authors call it for every kit stage wrapped in `step.run()`.
- Error message format `kit:step_error code=<E>` is parseable by adapters that inspect retry error messages; `String(result.error)` must produce a stable, non-PII identifier.
- `kitStep()` return type is `Promise<T>` (not `Promise<Result<T,E>>`); Inngest function body receives `T` directly, simplifying subsequent step wiring.
- NonRetryableError integration (cf #1 extension): adapter maps `retryable: false` on the Err metadata to `throw new NonRetryableError(...)` — see ADR-v1-I-3.

### ADR-v1-I-3 — Retryable vs non-retryable error distinction

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Not all failures are retryable. Auth denied (HTTP 403), schema mismatch (invalid input), or permanent resource-not-found should go to dead-letter immediately — not exhaust the retry budget. Inngest v4 exports `NonRetryableError` natively. Spike #1 §10 cf #1 identified this gap.

**Decision:** Kit's `Err<E>` variant gains an optional `retryable?: boolean` metadata field. Default is `retryable: true` (retry on failure; permanent failure is opt-in). The adapter shim maps `retryable: false` → `throw new NonRetryableError(...)` (Inngest dead-letter, no further retry). `retryable` is metadata on the error value, NOT a new Result variant — the `Result<T,E>` shape is unchanged.

**Alternatives considered:**
- *Always retry.* Rejected — permanent failures (auth denied, schema mismatch) should not exhaust retry budget; silent dead-letter after max retries is a worse outcome than immediate dead-letter.
- *Separate error channel.* Rejected — adds complexity; `retryable` on existing `Err<E>` is minimal and backwards-compatible. Result shape is unchanged.
- *Retry count in Result.* Rejected — Inngest owns retry scheduling via `attempt`; kit should not duplicate the retry count field.

**Reference:** Spike #1 §10 cf #1 (NonRetryableError integration); Inngest v4 `NonRetryableError` export.

**Consequences:**
- **Resolves cf #1** (extends ADR-v1-I-2).
- Kit's `Err<E>` type: `{ ok: false; error: E; retryable?: boolean }`. Default `undefined` treated as `true` (retry by default).
- Adapter shim extended: `if (!result.ok && result.retryable === false) throw new NonRetryableError(...)`.
- Stage authors who know a failure is permanent set `retryable: false` on the Err — one field, no new type.
- Conformance suite: `Err({ retryable: false })` from a stage → Inngest function dead-letters without retry. Verified in adapter integration tests.

### ADR-v1-I-4 — PipelineContext extensions for durable execution

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #1 O-4 enumerated the Inngest-to-PipelineContext mapping. `run_id` and `event.data` map 1:1. `attempt` (0-indexed retry count) is useful for retry-aware stages (e.g., exponential back-off logic in a stage). `signal: AbortSignal` is not natively provided by Inngest — stages already use it for cancellation.

**Decision:** Two optional fields on `PipelineContext`:
- `attempt?: number` — 0-indexed retry count, populated by adapter from Inngest's `attempt` field. `undefined` when not running under a durable runtime. Non-durable pipelines unaffected.
- `signal` (existing, stays optional) — adapter synthesises an `AbortSignal` from Inngest's `cancelOn` function option via a manual `AbortController`, OR omits it if cancellation is delegated entirely to the runtime. No mandatory new field.

All durable-execution fields are OPTIONAL. Stages that do not care about durability see the same `PipelineContext` as non-durable runs.

**Alternatives considered:**
- *Mandatory durable fields.* Rejected — breaks non-durable pipelines; violates kit's backward-compat principle.
- *Runtime-specific context (InngestPipelineContext extends PipelineContext).* Rejected — violates kit's runtime-agnostic principle; `PipelineContext` is the abstraction boundary; runtime-specific subtype leaks into stage handler signatures.
- *`stepId` in PipelineContext.* Rejected — Inngest's step concept is adapter-internal; kit stages see atoms, not steps; exposing stepId couples stage logic to the durable runtime.

**Reference:** Spike #1 §5 O-4 (mapping table); AbortSignal gap documented.

**Consequences:**
- **Resolves cf #3** (AbortSignal gap) and **cf #4** (attempt in PipelineContext).
- `PipelineContext.attempt` enables retry-aware stages (back-off, reduced concurrency on retry). Stage authors check `ctx.attempt ?? 0`.
- Adapter populates `attempt` from `inngestCtx.attempt`; non-Inngest adapters leave it `undefined`.
- AbortSignal synthesis (if implemented): adapter creates an `AbortController`, connects its `abort()` to Inngest's `cancelOn` delivery, passes `controller.signal` into PipelineContext. Optional enhancement, not required for v1.

### ADR-v1-I-5 — HRP checkpoint = step.waitForEvent

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Kit's `Reviewable<I>` checkpoint (M0 Composer kernel) pauses a pipeline for human review. Spike #2 Leg 2 probed whether Inngest's `step.waitForEvent` maps to this checkpoint cleanly. Both approved and timeout paths were confirmed.

**Decision:** Kit's `Reviewable<I>` checkpoint maps directly to `step.waitForEvent("hrp/review.completed", { match: "data.runId", timeout })`. The full mapping:

| kit Reviewable&lt;I&gt; concept | Inngest primitive |
|---|---|
| Checkpoint pause | `step.waitForEvent("hrp/review.completed", { event, timeout, match })` |
| Send review request | `step.run("send-review-request", ...)` — calls HRP webhook |
| Correlation to this run | `match: "data.runId"` — Inngest filters events by run ID |
| Resume on approval | Event `hrp/review.completed` received; function body resumes |
| Timeout | `null` return; policy is PER-CHECKPOINT CONFIGURABLE |
| Review decision | `reviewEvent.data.approved` + `reviewEvent.data.reviewer` (adapter unwraps `.data`) |

Timeout policy is per-checkpoint configurable: (a) continue with `approved: false`; or (b) throw `NonRetryableError` (dead-letter). No global default. The checkpoint configuration type carries the policy enum.

**Alternatives considered:**
- *Custom polling checkpoint.* Rejected — defeats Inngest's event-driven model; wastes compute polling for a decision that is asynchronously delivered.
- *Global timeout policy.* Rejected — different checkpoints have different severity; a 30-minute SLA review and a 24-hour editorial review are not the same policy.
- *HRP as separate Inngest function.* Rejected — loses pipeline context; correlation becomes inter-function RPC, not intra-function event match; step state must cross function boundaries.

**Reference:** Spike #2 §3 L2-O2 (event payload access confirmed), L2-O3 (timeout = null), L2-O4 (mapping table).

**Consequences:**
- **Resolves cf #13** (waitForEvent payload shape) and **cf #14** (timeout policy).
- Adapter must unwrap `reviewEvent.data` from the full `{ name, data }` payload returned by `step.waitForEvent`.
- `match: "data.runId"` requires the run ID to be injected into the trigger event data at function invocation time — adapter documents this requirement.
- `transformCtx` test pattern (not steps-array) required for `step.waitForEvent` in `@inngest/test` adapter tests (cf #11 upstream bug noted).

### ADR-v1-I-6 — Dynamic step ID stability constraint

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #2 L1-O4 CRITICAL: if the source array is computed outside `step.run()`, atom IDs can differ between replays, causing Inngest runtime error (step ID mismatch). This is the single most consequential footgun in the multi-atom composition pattern.

**Decision:** All inputs that determine dynamic step IDs MUST be wrapped in `step.run()` (memoized by Inngest). Kit's adapter enforces this by wrapping Source emit in the first step — the source atom array is stable across all replays, making derived step IDs (`process-${atom.id}`) deterministic. This is the single load-bearing replay-safety constraint. Violation causes Inngest runtime error.

**Alternatives considered:**
- *Index-based step IDs (`process-0`, `process-1`).* Rejected — fragile if source order changes or atoms are inserted/removed; `atom.id` is semantically stable (tied to the atom, not its position).
- *All-in-one source step (no dynamic per-atom steps).* Rejected — defeats per-atom retry; a single Source step wrapping all atoms means any atom failure retries the entire batch.
- *Adapter-level validation.* Noted as enhancement — adapter could detect non-memoized source inputs at runtime (requires introspection); deferred to M2.

**Reference:** Spike #2 §2 L1-O4 (CRITICAL footgun); L1-O1 (dynamic IDs replay correctly when source is memoized).

**Consequences:**
- **Resolves cf #9** (replay side-effect safety).
- Adapter README MUST document this constraint prominently as a "MUST" requirement.
- Replay safety is a documentation + code-review concern at v1; no runtime guard shipped at v1.0.
- Conformance scenario: source inside `step.run()` → process loop → PASS; source outside `step.run()` → process loop → Inngest runtime error. Both paths should be documented with code samples.
- Kit's "functional core, imperative shell" discipline (CLAUDE.md) provides safety for Composer wiring code between steps; no side effects between `step.run()` calls is enforced by convention.

### ADR-v1-I-7 — Adapter placement + non-goals

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Cat I Q5 (outline): where does the Inngest integration live — kit core, pack tier, or user-glue? Spike #1 §9 verdict: thin adapter (not documented pattern); the shim + context mapping + HRP bridge + replay-safety constraint define a dedicated module. v4 API break (v3→v4 `createFunction` signature) requires a versioned peer dep.

**Decision:** `@idriszade/adapter-inngest` as reference adapter at pack tier (not core). Contains: `kitStep()` shim (ADR-v1-I-2), `NonRetryableError` mapping (ADR-v1-I-3), PipelineContext mapping (ADR-v1-I-4), HRP↔waitForEvent bridge (ADR-v1-I-5), replay-safety documentation (ADR-v1-I-6). Peer dep: `"inngest": "^4.0.0"`. No v3 support — v3→v4 API break is blocking (`createFunction` signature changed; no TS compile error, runtime failure only).

**Non-goals (explicit rejections):**
- Kit is NOT a workflow engine — does not own checkpoint storage, retry scheduling, or run persistence.
- Kit does NOT lock users to Inngest — pg-boss/BullMQ documented as user-glue-tier pattern; Trigger.dev/Temporal adapters welcomed as ecosystem additions.
- Kit does NOT ship a generic `DurableRuntime<T>` interface — each adapter speaks its runtime's native protocol; abstraction would be leaky (`step.waitForEvent` ≠ Temporal activity heartbeat).
- Kit does NOT own the Inngest Dev Server experience — CLI installation, dashboard, and local server binary are Inngest's concern.

**Reference:** Spike #1 §9 verdict (thin adapter, not documented pattern); spike #1 §7 O-6 (inngest-cli binary distribution is Inngest's concern).

**Consequences:**
- **Resolves cf #5** (v4 peer dep), **cf #6** (v3→v4 version friction), **cf #7** (inngest-cli binary).
- Pack tier: `@idriszade/adapter-inngest` ships alongside `@idriszade/memory-orchestr8` and other reference adapters. Same tier, same release cadence.
- Trigger.dev / Temporal adapters: pattern is documented; implementation deferred until a constellation project requires them. ADR establishes the adapter shape, not the implementation.
- Non-goal note on `DurableRuntime<T>`: the reason is leaky abstraction, not lack of interest. If 3+ runtime adapters ship and a common surface emerges empirically, a thin interface may be extracted at v1.x — evidence first.

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)
- **cf #1** (kitStep shim design) → RESOLVED by ADR-v1-I-2 + ADR-v1-I-3
- **cf #3** (AbortSignal gap) → RESOLVED by ADR-v1-I-4 (optional, adapter-synthesised)
- **cf #4** (attempt in PipelineContext) → RESOLVED by ADR-v1-I-4
- **cf #5** (v4 peer dep) → RESOLVED by ADR-v1-I-7
- **cf #6** (v3→v4 version friction) → RESOLVED by ADR-v1-I-7 (v4-only, no v3 support)
- **cf #7** (inngest-cli binary) → RESOLVED by ADR-v1-I-7 non-goals (kit doesn't own CLI experience)
- **cf #9** (replay side-effect safety) → RESOLVED by ADR-v1-I-6
- **cf #13** (waitForEvent payload shape) → RESOLVED by ADR-v1-I-5
- **cf #14** (timeout policy) → RESOLVED by ADR-v1-I-5 (per-checkpoint configurable)

### Lifted to future milestones or categories
- **cf #2** (AsyncIterator flattening) → LIFTED to M2 implementation (Phase 3 code concern)
- **cf #8** (InngestTestEngine error propagation) → LIFTED to M2 adapter test-suite authoring
- **cf #10** (parallel fan-out) → LIFTED to Cat IV (Orchestration Patterns) or M2
- **cf #11** (@inngest/test waitForEvent bug) → LIFTED to housekeeping (upstream report)
- **cf #12** (HRP + MemoryAdapter) → LIFTED to Cat VI (Lifecycle Management)

---

*End of v1 Cat I research notes. 7 ADR candidates locked direction; 14 carry-forwards resolved (9 by ADRs, 5 lifted). Modern-direction framing: step-function runtimes (Inngest / Temporal / Trigger.dev) are the 2024-26 per-step checkpoint standard; job queues demoted to user-glue tier. kitStep() shim (ADR-v1-I-2) + replay-safety constraint (ADR-v1-I-6) are the two load-bearing composition findings. Cat VIII (secrets) + Cat V (memory) deps-shape patterns lift unchanged into the Inngest adapter; no new kit-shape primitives required beyond optional PipelineContext fields.*

*Author: Brain — 2026-05-10. Inputs: spike #1 `f9f5fca` / spike #2 `5771531`. Branch: `master`. Master tip at synthesis: `e8a4666`.*
