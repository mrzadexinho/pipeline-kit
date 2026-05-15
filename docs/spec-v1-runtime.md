# pipeline-kit v1 Spec — Runtime: Durable Execution & Triggers

> Drilldown for `spec-v1.md`. Covers Cat I (7 ADRs), Cat IV (7 ADRs).
> Source syntheses: `research-notes-v1-cat-I.md`, `research-notes-v1-cat-IV.md`.

---

## §I — Durable Execution (7 ADRs)

### I-1: Step-function runtime as durable execution layer

**Status:** RATIFIED

**Decision:** Kit composes with step-function runtimes at the atom-per-step boundary. Each
`step.run()` wraps one kit atom (Source emit, Process transform, Serve output). Kit is a pipeline
library; it is NOT a workflow engine. The durable runtime owns checkpointing, retry scheduling,
and run persistence.

**Key constraint:** Each atom must be its own `step.run()` call — whole-pipeline-as-one-step
defeats per-atom retry granularity.

**Consequence:** Per-atom retry is unlocked; atoms 0..N-1 replay from durable state on failure
at atom N. pg-boss / BullMQ documented as user-glue-tier pattern only.

---

### I-2: kitStep() shim — Result→throw bridging

**Status:** RATIFIED

**Decision:** A thin `kitStep()` shim (~8 LOC) at the adapter boundary translates `Result.err(...)` →
`throw` for Inngest's throw-only retry protocol. Lives in the adapter module, NOT kit-core.
Shim is stateless; safe for N-atom loops.

```ts
async function kitStep<T, E>(
  step: StepTools, id: string, fn: () => Promise<Result<T, E>>
): Promise<T> {
  const r = await step.run(id, fn);
  if (!r.ok) throw new Error(`kit:step_error code=${String(r.error)}`);
  return r.value;
}
```

**Key constraint:** Without the shim, `Result.err(...)` is treated as step-success by Inngest —
the pipeline silently advances with a failed result.

**Consequence:** Adapter exposes `kitStep()` as a named export; adapter authors call it for every
kit stage wrapped in `step.run()`. Return type is `Promise<T>`, not `Promise<Result<T,E>>`.

---

### I-3: NonRetryableError mapping

**Status:** RATIFIED

**Decision:** `Err<E>` gains an optional `retryable?: boolean` field (default `undefined` = retry).
The adapter shim maps `retryable: false` → `throw new NonRetryableError(...)` (Inngest dead-letter).
`Result<T,E>` shape is unchanged — `retryable` is metadata on the error value, not a new variant.

**Key constraint:** Never add `retryable` to the Err type inside stage handlers — it is adapter-layer
metadata only; stage authors set it on the returned `Err(...)`.

**Consequence:** Auth-denied (HTTP 403), schema-mismatch, and permanent not-found errors skip the
retry budget and dead-letter immediately. Shim extension: `if (!r.ok && r.retryable === false)
throw new NonRetryableError(...)`.

---

### I-4: PipelineContext fields for durable execution

**Status:** RATIFIED

**Decision:** Two optional fields added to `PipelineContext`:
- `attempt?: number` — 0-indexed retry count from Inngest; `undefined` in non-durable runs.
- `signal?: AbortSignal` — (existing, stays optional) adapter synthesises via `AbortController`
  connected to Inngest's `cancelOn`, or omits if cancellation is delegated to runtime.

All durable-execution fields are OPTIONAL — non-durable pipelines see unchanged context.

**Key constraint:** No runtime-specific subtype (`InngestPipelineContext`); `PipelineContext` is
the abstraction boundary.

**Consequence:** Retry-aware stages check `ctx.attempt ?? 0` for back-off logic. Adapter populates
`attempt` from `inngestCtx.attempt`; non-Inngest adapters leave it `undefined`.

---

### I-5: HRP checkpoint = step.waitForEvent

**Status:** RATIFIED

**Decision:** `Reviewable<I>` checkpoint maps directly to `step.waitForEvent`. Mapping:

| Reviewable concept | Inngest primitive |
|---|---|
| Checkpoint pause | `step.waitForEvent("hrp/review.completed", { timeout, match })` |
| Send review request | `step.run("send-review-request", ...)` — calls HRP webhook |
| Correlation | `match: "data.runId"` |
| Resume on approval | Event `hrp/review.completed` received |
| Timeout | `null` return; policy is per-checkpoint configurable |
| Decision | `reviewEvent.data.approved` + `reviewEvent.data.reviewer` |

Timeout policy: (a) continue with `approved: false`, or (b) `throw NonRetryableError`. No global
default — each checkpoint carries its own policy enum.

**Key constraint:** `match: "data.runId"` requires run ID in trigger event data at invocation time.

**Consequence:** No new kit-shape primitives required; `transformCtx` test pattern required for
`@inngest/test` adapter tests (not steps-array, due to upstream `waitForEvent` bug).

---

### I-6: Dynamic step ID stability (replay-safety constraint)

**Status:** RATIFIED

**Decision:** All inputs that determine dynamic step IDs MUST be wrapped in `step.run()` (memoized).
Kit adapter enforces this by wrapping Source emit as the first step — atom IDs are stable across
all replays, making derived step IDs (`process-${atom.id}`) deterministic.

**Key constraint:** Source computed OUTSIDE `step.run()` can produce different atom IDs between
replays → Inngest runtime error. This is the single load-bearing replay-safety constraint.

**Consequence:** Adapter README MUST document this as a "MUST" requirement with both passing and
failing code samples. No runtime guard at v1; documentation + code-review concern.

---

### I-7: adapter-inngest at pack tier

**Status:** RATIFIED

**Decision:** `@idriszade/adapter-inngest` ships as reference adapter at pack tier (not core).
Contains: `kitStep()`, `NonRetryableError` mapping, PipelineContext mapping, HRP bridge,
replay-safety docs. Peer dep: `"inngest": "^4.0.0"` — no v3 support (API break is runtime-silent).

**Non-goals (explicit rejections):**
- Kit is NOT a workflow engine.
- Kit does NOT lock users to Inngest — pg-boss/BullMQ = user-glue tier.
- Kit does NOT ship a generic `DurableRuntime<T>` interface (abstraction would be leaky).
- Kit does NOT own the Inngest Dev Server experience.

**Consequence:** Trigger.dev / Temporal adapters welcomed as ecosystem additions; the adapter shape
is documented, implementation deferred until a constellation project requires them.

---

## §IV — Trigger/Schedule (7 ADRs)

### IV-1: Fan-out = adapter pattern

**Status:** RATIFIED

**Decision:** Fan-out is an adapter-layer pattern — NOT a kit-core or Tier-2 primitive.
`Fan<I,Branches>` (packs outline proposal) is rejected. Correct expression is
`Promise.all + step.invoke()` in the adapter, abstracted behind `kitFanOut(items, childFn)` shipped
in `@idriszade/adapter-inngest`. Kit-core stays agnostic to fan-out execution shape.

**Key constraint:** Runtime-specific execution: Inngest uses `step.invoke()`, Temporal uses
`workflow.executeChild()`, local dev uses `Promise.allSettled()`. Kit does not abstract over runtimes.

**Consequence:** No Tier-2 `Fan<I,Branches>` type in kit-core or packs. Child functions must be
pre-registered on the Inngest client before fan-out; adapter documents this requirement.

---

### IV-2: Trigger&lt;O&gt; rejected; TriggerConfig at Tier 1

**Status:** RATIFIED

**Decision:** `Trigger<O>` is NOT a new kit stage primitive. Triggering is config (discriminated
union), not a type. `TriggerConfig` ships at Tier 1 core:

```ts
type TriggerConfig =
  | { kind: "cron";    expr: string }
  | { kind: "webhook"; path: string }
  | { kind: "event";   name: string }
  | { kind: "manual" }
  | { kind: "mcp";     toolName: string };
```

Inngest collapse: all 5 kinds map to 2 Inngest primitives (`{ cron }` or `{ event }`) — adapter
handles translation, not kit-core.

**Key constraint:** Switching cron → webhook requires 1 field change (TriggerConfig) + 1 adapter
registration method change; handler is unchanged.

**Consequence:** No `Trigger<O>` at Tier 2. `TriggerConfig` discriminated union is Tier 1 core.
Visual-builder trigger-as-type pattern (n8n / Zapier) explicitly not kit's concern.

---

### IV-3: Local-prod seam via TriggerAdapter.register()

**Status:** RATIFIED

**Decision:** `TriggerAdapter.register(config, handler)` is the adapter interface. Dev mode: cron →
`setInterval`, webhook → `express.post(path, handler)`. Prod mode: Inngest function config. Handler
receives `KitTriggerEnvelope<T>` in both modes — runtime-agnostic. This is the third confirmation
of the seam pattern (after MemoryAdapter + SecretsAdapter); now a documented kit convention.

**Key constraint:** Kit-core defines `TriggerAdapter` as an interface only; dev/prod mode
implementations live in adapter packages.

**Consequence:** Local development requires no live Inngest Dev Server for any trigger type.
Seam pattern joins MemoryAdapter + SecretsAdapter as a documented kit convention in v1 spec.

---

### IV-4: RunGuard type — 5-shape declaration

**Status:** RATIFIED

**Decision:** Kit-core defines `RunGuard` with 5 shapes. Zero enforcement code in kit-core —
`RunGuard` is a declaration passed through to the adapter. Adapter-inngest translates to Inngest
`concurrency[]` + `idempotency` expression. Runtime enforces.

| Shape | Semantics | Inngest equivalent |
|---|---|---|
| `{}` | Unbounded parallelism (default) | no config (ALLOW_DUPLICATE) |
| `{ concurrency: { limit: N } }` | Bounded parallelism | `concurrency: [{ limit: N }]` |
| `{ concurrency: { limit: 1, overflow: "queue" } }` | Sequential singleton, never skip | `concurrency: [{ limit: 1 }]` |
| `{ concurrency: { limit: 1, overflow: "reject" } }` | True singleton, skip overlapping | `concurrency: [{ limit: 1, key: "..." }]` |
| `{ dedup: { period: "24h" } }` | Event dedup window | `idempotency: "..."` expression |

TERMINATE and ALLOW_DUPLICATE_FAILED_ONLY policies (Temporal WorkflowIdReusePolicy): expressible in
the type system; enforcement deferred to v1.x.

**Key constraint:** Three concerns — concurrency, dedup, singleton — are genuinely orthogonal.
`concurrency=1+overflow:queue` is NOT dedup; conflating them is the root of F-TRIGGER friction.

**Consequence:** `ComposerOptions.runGuard?: RunGuard` added to kit-core. Declaration only.

---

### IV-5: Full pipeline idempotency — input-side + output-side

**Status:** RATIFIED

**Decision:** Two composing layers provide full pipeline idempotency:
- **Input-side (trigger layer):** `TriggerEvent<T>.dedupKey` — computed by trigger adapter at the
  trigger boundary before the pipeline runs. Inngest `idempotency` expression enforces it.
- **Output-side (Serve adapter):** HMAC-signed idempotency key — computed at the Serve boundary
  before mutation. Serve adapter enforces it (v0 pattern retained).

Per-type dedup key strategy:
- Webhook: `hash(stable_payload_fields)` — NOT timestamp-derived
- Cron: `pipelineId + ":" + scheduledAt`
- CloudEvent: `event.id` (spec-mandated unique per source)

**Key constraint:** Input-side dedup key is ALWAYS computable before the pipeline runs — for all
trigger types. Inside-pipeline dedup is structurally wrong (run already started by that point).

**Consequence:** `TriggerEvent<T>` gains `dedupKey?: string` (optional). Inngest 24h dedup window
limitation: for windows > 24h, a Store adapter with TTL is required at the trigger layer (M2).

---

### IV-6: KitTriggerEnvelope&lt;T&gt; with CloudEvents projection

**Status:** RATIFIED

**Decision:** Kit defines minimal `KitTriggerEnvelope<T>`:

```ts
type KitTriggerEnvelope<T> = {
  id: string;     // prefixed pk_tev_*
  type: string;   // TriggerType
  source: string; // kit source identifier
  time: string;   // ISO 8601
  data: T;
};
```

CloudEvents compliance is an adapter concern: adapters add `specversion: "1.0"` and URI-formatted
`source` on serialize. All 5 trigger shapes (cron, webhook, event, manual, MCP) converge to this
same envelope — only `data: T` differs.

**Key constraint:** No `specversion`, `dataschema`, or `datacontenttype` in kit-core.
Full CloudEvents (+102% byte overhead vs kit envelope) rejected for personal-automation scale.

**Consequence:** Adapters publishing to CloudEvents-compatible buses add `specversion: "1.0"` on
serialize. Extension attributes (`traceparent`, `sequence`) are adapter-tier concerns.

---

### IV-7: kitFanOut() helper in adapter-inngest

**Status:** RATIFIED

**Decision:** `kitFanOut(items, childFn)` ships in `@idriszade/adapter-inngest`. It encapsulates:
1. Source memoization via `step.run("validate-source", ...)` (replay-safety — ADR-v1-I-6)
2. `Promise.all(items.map(item => step.invoke(...)))` with per-invoke try/catch
3. Per-invoke catch mapping Inngest child failure → `Result.err(...)` (not rethrow)
4. `Result<T,E>` aggregation — returns `Array<Result<T,E>>`

**Key constraint:** Children MUST return `Result.err(...)`, not throw at the Inngest function level.
If a child throws after exhausting retries, `step.invoke()` rejects and `Promise.all` short-circuits;
the per-invoke catch in `kitFanOut` is the guard.

**Consequence:** Ships alongside `kitStep()` in `@idriszade/adapter-inngest`. Adapter docs must
state the `Result.err` discipline requirement prominently. Local equivalent is `Promise.allSettled`
— no separate local helper required.

---

*End of runtime drilldown. 14 ADRs total (I-1..I-7, IV-1..IV-7). All statuses: RATIFIED.*
*Sources: `research-notes-v1-cat-I.md` (2026-05-10) + `research-notes-v1-cat-IV.md` (2026-05-10).*
