# pipeline-kit — v1 Cat IV Research Notes: Trigger, Scheduling & Orchestration Patterns

> Phase 1 v1 synthesis. Author: Brain — 2026-05-10.
> Inputs: 3 spike FINDINGS files (`research/spikes/cat-iv-trigger-orchestration/`).
> Friction anchor: F-TRIGGER (catalog top-15; trigger shape divergence + fan-out composition).
> Status: synthesis complete; 7 ADR candidates locked direction; 14 carry-forwards resolved.

---

## Sources reviewed

### Spike evidence (this kit, 3 throwaway spikes — empirical truth)
- Spike #1 (`856d918`, 2026-05-10) — `fan-out-compose`. 7 observations. `step.invoke()` parallel fan-out via `Promise.all`. Replay-safety constraint confirmed (memoize source before dynamic step IDs). Local-prod seam thin (`Promise.allSettled` ↔ `step.invoke`). Surfaced O1..O8 + cf #15..#18.
- Spike #2 (`856d918`, 2026-05-10) — `trigger-unification`. 6 observations. Way A/B/C LOC comparison (35/22/12 LOC, 2/1/1 type params). CloudEvents byte-size probe (CE=378B vs kit=187B; lossless projection confirmed). All 5 trigger shapes converge to `{ id, type, source, time, data }`. Local-prod seam end-to-end confirmed (cron→dev=setInterval, cron→prod=Inngest config). Surfaced O1..O6 + cf #19..#23.
- Spike #3 (`c04b994`, 2026-05-10) — `concurrent-run-idempotency`. 6 observations. Three-concern separation (concurrency / dedup / singleton — genuinely orthogonal). Dedup key always computable at trigger boundary before pipeline runs. Temporal WorkflowIdReusePolicy mapped to 5 RunGuard shapes. Kit boundary = declaration only, zero enforcement code. Surfaced O1..O6 + cf #19..#22.

### External sources (modern industry standards 2024-26)
- **Inngest v4** — `concurrency:[]` (limit+key+overflow) + `idempotency` expression (24h window). `step.invoke()` for parallel child dispatch. Event-driven function config.
- **Temporal** — `WorkflowIdReusePolicy` (ALLOW_DUPLICATE / REJECT_DUPLICATE / TERMINATE_IF_RUNNING / ALLOW_DUPLICATE_FAILED_ONLY). Activity-level error propagation.
- **CloudEvents v1.0.2** — CNCF envelope standard. 10 required/optional attributes; `specversion`, `source` (URI), `type` (reverse-DNS). Projection probe confirmed.
- **GitHub Actions / n8n / Zapier** — trigger-as-config (workflow engines) vs trigger-as-type (visual builders). Pattern split confirms kit's config direction.
- **AWS SQS / pg-boss** — dedup via `MessageDeduplicationId` / `singletonKey`. Runtime-owned enforcement pattern confirmed across 5 runtimes.

---

## Reframe note

The v1 research outline framed Cat IV as two sub-questions: (1) should `Trigger<O>` be a Tier-2 stage
primitive (parallel to `Source<O>`, `Process<I,O>`, `Serve<I>`)? and (2) how do orchestration patterns
(fan-out, concurrency) compose with kit?

Post-Cat-I reconciliation refined the scope. ADR-v1-I-7 demoted pg-boss to user-glue tier and
confirmed Inngest as kit's durable execution reference runtime. This made the Cat IV question more
precise: with Inngest as the composition layer, does kit need a Trigger stage type, or is triggering
a config concern at the adapter boundary?

Brain reframed Cat IV as two concerns: (1) **Trigger** = what starts a pipeline (config vs stage-type);
(2) **Orchestration** = how pipelines compose at runtime (fan-out, concurrency, dedup). The three spikes
addressed these in order: fan-out composition (spike #1), trigger unification (spike #2), concurrent-run
and idempotency (spike #3).

The reframe is consequential: it turns two speculative questions into three grounded probes, each
with confirmed output. The result is 7 ADR candidates with evidence for all directions.

---

## ADR candidates

### ADR-v1-IV-1 — Fan-out as adapter pattern, not kit primitive

**Status:** v1 candidate (synthesis 2026-05-10). Awaiting brain v1 spec lock.

**Context:** Cat I spike #2 carry-forward #10 deferred parallel fan-out to Cat IV. The v0 Composer
supports fan-out (Source emits N atoms) but only serially (sequential `step.run()` loop). For high-value
workloads, parallel atom processing requires `step.invoke()` — each atom dispatched as an independent
Inngest child function. The question was whether kit-core needs a `Fan<I,Branches>` primitive (as
proposed in the packs outline) to express this pattern.

**Decision:** Fan-out is an adapter-layer pattern, not a kit-core or Tier-2 primitive. `Fan<I,Branches>`
from the packs outline is rejected. The correct expression is `Promise.all + step.invoke()` in
the adapter, abstracted behind a `kitFanOut(items, childFn)` helper shipped in
`@idriszade/adapter-inngest`. Kit-core stays agnostic to fan-out execution shape. This is
runtime-specific: Inngest uses `step.invoke()`, Temporal uses `workflow.executeChild()`, local uses
`Promise.allSettled()`. Kit does not abstract over runtimes (see ADR-v1-I-7 non-goals).

**Alternatives considered:**
- *`Fan<I,Branches>` as Tier-2 primitive.* Rejected — would require kit-core to know about parallel
  execution topology. Spike #1 O6 confirms no new kit-core primitive is needed: fan-out is Composer +
  adapter. A `Fan` type would add surface for zero gain at the personal-toolkit scale.
- *Documented pattern only (no helper).* Rejected — spike #1 O2 and O7 show that the correct fan-out
  shape (Result.err not throw, per-invoke catch, source memoization) has enough non-obvious constraints
  to warrant an encapsulating helper. The `kitFanOut()` helper is the load-bearing boundary.
- *Kit-core `parallelCompose()` utility.* Rejected — leaks runtime-specific concerns (step.invoke
  pre-registration requirement) into kit-core. Adapter concern.

**Reference:** Spike #1 O6 (no new kit primitive; fan-out = Promise.all + step.invoke in adapter),
O7 (local-prod seam thin; Result<T,E> contract identical across paths), O8 (Inngest imperative model
fits kit Composer better than Step Functions declarative Map state).

**Consequences:**
- `kitFanOut()` helper ships in `@idriszade/adapter-inngest` alongside `kitStep()` (ADR-v1-I-2).
- No Tier-2 `Fan<I,Branches>` type in kit-core or packs. Packs outline entry rejected.
- Child functions must be pre-registered on the Inngest client before fan-out (Inngest constraint);
  adapter documents this requirement.
- Resolves: Cat I cf #10 (parallel fan-out lifted to Cat IV).

### ADR-v1-IV-2 — Trigger&lt;O&gt; rejected; TriggerConfig at Tier 1

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** The v1 outline proposed `Trigger<O>` as a possible fifth stage type alongside Source,
Process, Serve, and Store. Spike #2 probed three implementation ways: Way A (Trigger<O> wraps Source),
Way B (Source + TriggerConfig), and Way C (pure Source + runtime config). The question was whether
the extra type parameter and stage boundary in Way A yield any net gain.

**Decision:** `Trigger<O>` is NOT a new kit stage primitive. Triggering is config (discriminated union),
not a type. `TriggerConfig` ships at Tier 1 core as a discriminated union with kinds: `cron`,
`webhook`, `event`, `manual`, `mcp`. This is the correct pattern for a library that sits beneath
workflow engines — consistent with how Inngest, Temporal, and GitHub Actions all treat triggers as config,
not types.

**Alternatives considered:**
- *Way A: `Trigger<O>` wraps Source (+13 LOC, +1 type param).* Rejected — spike #2 O1 and O3 confirm
  no net gain for the personal-toolkit use case. Switching cron→webhook requires changing 2 generic
  params in Way A vs 1 field change in Way B. The extra type param is only justified if multiple
  downstream stages need access to the typed payload — not the case here.
- *Visual-builder pattern (n8n / Zapier Trigger-as-type).* Rejected — spike #2 O6 confirms those
  platforms need Trigger as a type for UI rendering, not execution semantics. Kit has no UI rendering
  requirement.
- *Way C: pure Source + entirely external runtime config.* Rejected — co-locating TriggerConfig with
  the Source it feeds (Way B) provides better discoverability and enables dev/prod seam consistency
  without the type overhead of Way A.

**Reference:** Spike #2 O1 (Way A overkill; all 3 ways converge structurally), O3 (LOC comparison
35/22/12; cron→webhook generic changes: 2/0/0), O6 (industry: workflow engines = config, visual
platforms = type). F-TRIGGER-1: gatewerk's `callback_url` vs webhook shape friction resolved by
`TriggerConfig` union.

**Consequences:**
- No `Trigger<O>` at Tier 2. Outline Q1 resolved: NEITHER stage specialisation nor separate layer —
  config.
- `TriggerConfig` discriminated union in kit-core. Kinds: `cron`, `webhook`, `event`, `manual`, `mcp`.
- Inngest collapse: all 5 kinds map to 2 Inngest primitives (`{ cron }` or `{ event }`) — the adapter
  handles the translation, not kit-core.
- Resolves: outline Q1 (Trigger<O> Source specialisation or separate layer).

### ADR-v1-IV-3 — KitTriggerEnvelope&lt;T&gt; with CloudEvents projection

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Kit needs a runtime-agnostic event envelope that can carry trigger payloads from adapter
to pipeline handler. CloudEvents v1.0.2 is the CNCF standard for this purpose. Spike #2 probed whether
kit should adopt CloudEvents fully, adopt a subset, or define its own minimal envelope with a
CloudEvents projection path.

**Decision:** Kit defines `KitTriggerEnvelope<T>` with minimal fields `{ id, type, source, time, data }`.
CloudEvents compliance is an adapter concern: adapters add `specversion: "1.0"` and URI-formatted
`source` on serialize. Kit stays minimal. No `specversion`, `dataschema`, or `datacontenttype` in
kit-core.

All 5 trigger shapes converge to this same envelope structure — the `.data` payload differs per
trigger type (it is generic), but the top-level envelope is identical across cron, webhook, event,
manual, and MCP triggers.

**Alternatives considered:**
- *Full CloudEvents adoption (378B envelope).* Rejected — spike #2 O2 shows +102% overhead vs kit
  envelope. `specversion`, `dataschema`, `datacontenttype` are overkill for personal automations.
  `source` as URI is verbose vs kit's prefixed ID (`pk_src_*`).
- *Inngest native event format (116B).* Rejected — Inngest-specific; not portable. Kit must not leak
  runtime-specific envelope shapes into the handler interface.
- *No envelope (raw payload).* Rejected — without `id`, `type`, and `source`, trigger handlers cannot
  route by trigger type or correlate events to pipeline runs.

**Reference:** Spike #2 O2 (CE=378B vs kit=187B; lossless projection confirmed; CE projection
reversible), O4 (all 5 shapes converge to `{ id, type, source, time, data }`).

**Consequences:**
- `KitTriggerEnvelope<T>` at Tier 1 core. Fields: `id` (prefixed `pk_tev_*`), `type` (TriggerType),
  `source` (string), `time` (ISO 8601), `data: T`.
- Adapters that publish to CloudEvents-compatible buses add `specversion: "1.0"` on serialize.
  Extension attributes (`traceparent`, `sequence`) are adapter-tier.
- Resolves: outline Q3 (CloudEvents-compatible envelope).

### ADR-v1-IV-4 — TriggerAdapter as local-prod seam

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Kit's local-prod seam pattern (established by MemoryAdapter in Cat V and SecretsAdapter
in Cat VIII) provides a `DevAdapter` that runs locally and a `ProdAdapter` that wires to the real
runtime. Spike #2 probed whether TriggerAdapter can follow the same pattern.

**Decision:** `TriggerAdapter.register(config, handler)` is the adapter interface. Dev mode:
`setInterval` (cron) or `express.post(path, handler)` (webhook). Prod mode: Inngest function config
(`{ cron: expr }` or `{ event: name }`). The pipeline handler receives `KitTriggerEnvelope<T>` in
both modes and is runtime-agnostic. Trigger swap (cron → webhook) requires only: (1) a 1-field
`TriggerConfig` change; (2) adapter registration method change; (3) handler unchanged unless
`ctx.payload` is needed.

This is the third confirmation of the seam pattern (Cat V MemoryAdapter, Cat VIII SecretsAdapter,
Cat IV TriggerAdapter). The pattern is now stable enough to document as a kit convention.

**Alternatives considered:**
- *Trigger config as pure Inngest config (no dev seam).* Rejected — spike #2 O5 confirms the seam
  runs end-to-end: `[DEV] Registered cron trigger` then `[PROD] Would register Inngest trigger`.
  Without the seam, local development requires a live Inngest Dev Server binary for every trigger type.
- *Kit-core owns the seam switching.* Rejected — kit-core is runtime-agnostic. The dev/prod
  distinction is an adapter concern. Kit-core defines `TriggerAdapter` as an interface; the two
  mode implementations live in adapter packages.

**Reference:** Spike #2 O5 (end-to-end seam confirmed; real probe output showed handler execution
with 2 atoms processed). Cross-ref Cat V/VIII seam patterns (same `register(config, handler)` shape).

**Consequences:**
- `TriggerAdapter` interface at Tier 3 (adapter tier). Methods: `register(config: TriggerConfig, handler: (envelope: KitTriggerEnvelope<T>) => Promise<void>): void`.
- Seam pattern joins MemoryAdapter + SecretsAdapter as a documented kit convention in v1 spec.
- Resolves: outline Q2 (webhook/cron unification via TriggerConfig), packs §5.2 (local-prod seam).

### ADR-v1-IV-5 — RunGuard type (5 shapes), declaration only

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Three related concerns are routinely conflated in trigger implementations: concurrency
control (how many runs execute simultaneously), deduplication (drop identical events), and singleton
enforcement (at-most-one-active semantics). Spike #3 probed the ownership boundary and minimum viable
type surface.

**Decision:** Kit-core defines the `RunGuard` type with 5 shapes covering the minimum viable set.
Zero enforcement code in kit-core — `RunGuard` is a declaration passed through to the adapter.
The adapter (adapter-inngest) translates RunGuard → Inngest `concurrency[]` + `idempotency`
expression. The runtime enforces.

5 shapes (v1 minimum viable):
1. `{}` — unbounded parallelism (default; ALLOW_DUPLICATE)
2. `{ concurrency: { limit: N } }` — bounded parallelism
3. `{ concurrency: { limit: 1, overflow: "queue" } }` — sequential singleton (never skip)
4. `{ concurrency: { limit: 1, overflow: "reject" } }` — true singleton (skip overlapping)
5. `{ dedup: { period: "24h" } }` — event dedup window (webhook / event triggers)

TERMINATE and ALLOW_DUPLICATE_FAILED_ONLY policies (from Temporal's WorkflowIdReusePolicy): expressible
in the type system but enforcement deferred to v1.x (require management API / Store adapter respectively).

**Alternatives considered:**
- *Kit-core enforces concurrency limits (lock acquisition).* Rejected — kit-core is not a scheduler.
  Spike #3 O4 boundary map confirms: enforcement belongs to runtime. Kit-core acquiring locks would
  duplicate Inngest's concurrency system and break the "library not runtime" principle.
- *Conflate concurrency + dedup in one config field.* Rejected — spike #3 O1 confirms the three
  concerns are genuinely orthogonal: `concurrency=1+overflow:queue` is NOT dedup; they produce
  different second-trigger behaviors (queue vs drop). Conflation is the root of existing friction.
- *Expose only Inngest's native config surface.* Rejected — RunGuard must be portable across runtimes
  (Temporal, Trigger.dev). Inngest-specific config in ComposerOptions would couple kit-core to a
  single runtime.

**Reference:** Spike #3 O1 (three-concern separation confirmed — distinct second-trigger behaviors),
O3 (Temporal policy mapping; 5 shapes minimum viable), O4 (kit boundary = declaration only; no
enforcement code in kit-core), O5 (5 modern runtimes all own enforcement; kit declares intent).

**Consequences:**
- `ComposerOptions.runGuard?: RunGuard` added to kit-core. Declaration only — passed to adapter.
- adapter-inngest translates: `ConcurrencyConfig` → Inngest `concurrency[]`; `DedupWindow.period` →
  Inngest `idempotency` expression string.
- Resolves: outline Q4 (trigger dedup), Cat IV Q3 (concurrent-run protection).

### ADR-v1-IV-6 — Full pipeline idempotency: input-side + output-side

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** v0 Serve adapters already implement output-side idempotency (HMAC-SHA256 + timestamp
tolerance — see v0 spec). Spike #3 probed the complementary input-side question: does the trigger
layer need its own dedup mechanism, and if so, who computes and enforces it?

**Decision:** Full pipeline idempotency is achieved by two composing layers:
- **Input-side (trigger layer):** `TriggerEvent<T>.dedupKey` — computed by the trigger adapter at the
  trigger boundary before the pipeline runs. Inngest's `idempotency` expression enforces it.
- **Output-side (Serve adapter):** HMAC-signed idempotency key — computed at the Serve boundary
  before the mutation executes. Serve adapter enforces it.

Both layers are independently sufficient for their responsibility. Neither requires coordination with
the other. Together they provide defense in depth: input-side prevents wasted runs; output-side
prevents duplicate mutations even if the input-side dedup window has expired.

The dedup key is ALWAYS computable before the pipeline runs — for all trigger types:
- Webhook: `hash(stable_payload_fields)` (NOT timestamp-derived)
- Cron: `pipelineId + ":" + scheduledAt`
- CloudEvent: `event.id` (spec-mandated unique per source)

**Alternatives considered:**
- *Composer checks dedupKey inside the pipeline (Option B).* Rejected — spike #3 O2 confirms this is
  structurally wrong. By the time the Composer executes, the run has already started. An inside-pipeline
  check is output-side dedup (same role as Serve idempotency), not input-side prevention.
- *Kit-core owns a dedup store.* Rejected — kit-core does not own storage (see ADR-v1-I-7 non-goals).
  Inngest's 24h `idempotency` window is the runtime's responsibility, not kit's.
- *Output-side only (v0 pattern, no trigger-level dedup).* Noted as a viable minimum but weaker —
  wasted compute on duplicate runs is observable. Input-side dedup prevents the run from starting.

**Reference:** Spike #3 O2 (dedup key always computable at boundary; input-side ownership confirmed),
O6 (symmetric design: both layers boundary-computed; v0 Serve idempotency composes cleanly; no
coordination needed between layers).

**Consequences:**
- `TriggerEvent<T>` gains `dedupKey?: string` (optional — not all trigger types warrant dedup).
- Trigger adapter fills `dedupKey` per the per-type hash strategy; runtime enforces via Inngest
  `idempotency` expression.
- Inngest 24h dedup window limitation (non-configurable): for sources needing dedup > 24h, a Store
  adapter (MemoryAdapter + TTL) is required at the trigger layer — see lifted carry-forward.
- Resolves: Cat IV Q3 dedup ownership; cf #22 (spike #2) TriggerEvent shape (jointly with ADR-v1-IV-3).

### ADR-v1-IV-7 — kitFanOut() helper in adapter-inngest

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** ADR-v1-IV-1 establishes fan-out as adapter pattern. The practical question is what the
`kitFanOut()` helper must encapsulate to be safe and composable — specifically, how it handles the
non-obvious constraints (memoized source, per-invoke catch, Result<T,E> aggregation) from spike #1.

**Decision:** `kitFanOut(items, childFn)` ships in `@idriszade/adapter-inngest`. It wraps:
1. Source memoization via `step.run("validate-source", ...)` (replay-safety constraint from ADR-v1-I-6)
2. `Promise.all(items.map(item => step.invoke(...)))` with per-invoke try/catch
3. Per-invoke catch that maps Inngest-level child failure to `Result.err(...)` (not rethrow)
4. `Result<T,E>` aggregation — returns `Array<Result<T,E>>`

The load-bearing composition constraint: **children MUST return `Result.err(...)`, not throw, for
allSettled-equivalent behavior.** If a child throws at the Inngest function level (after exhausting
retries), `step.invoke()` rejects and `Promise.all` short-circuits. The `kitFanOut` helper's
per-invoke catch converts this into `Result.err(...)` so the parent receives a complete result array.

**Alternatives considered:**
- *Let callers write `Promise.all(items.map(step.invoke(...)))` directly.* Rejected — spike #1 O2
  shows the per-invoke catch shape and Result.err discipline are non-obvious. Without the helper,
  callers will write `Promise.all` without per-invoke catch and get short-circuit behavior on any
  child max-retry exhaustion. The helper enforces the correct pattern.
- *Return `PromiseSettledResult[]` instead of `Result<T,E>[]`.* Rejected — violates kit's Result<T,E>
  contract at the fan-in boundary. Callers would need to convert `PromiseSettledResult` to
  `Result<T,E>` themselves, defeating the helper's purpose.
- *Ship in kit-core.* Rejected — `step.invoke()` is Inngest-specific. The helper belongs in the
  adapter package, not kit-core (same reasoning as ADR-v1-IV-1).

**Reference:** Spike #1 O1 (type flows through step.invoke — minor cast required), O2 (error isolation:
Result.err vs function-level throw are distinct failure modes), O5 (replay safety: memoize source
before dynamic step IDs).

**Consequences:**
- Ships in `@idriszade/adapter-inngest` alongside `kitStep()` (Cat I ADR-v1-I-2). Same module,
  consistent helper naming convention.
- `kitFanOut` requires child functions to follow Result.err discipline (not throw at function level).
  Adapter docs must state this prominently.
- Resolves: spike #1 cf #15 (per-invoke catch shape), cf #16 (kitFanOut helper design).

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)
- **spike #1 cf #15** (per-invoke catch shape) → RESOLVED by ADR-v1-IV-7
- **spike #1 cf #16** (kitFanOut helper) → RESOLVED by ADR-v1-IV-7
- **spike #1 cf #18** (local equivalent of kitFanOut) → RESOLVED by ADR-v1-IV-1 (local = `Promise.allSettled`; no separate helper needed)
- **spike #2 cf #19** (Trigger<O> rejected) → RESOLVED by ADR-v1-IV-2
- **spike #2 cf #20** (KitTriggerEnvelope design) → RESOLVED by ADR-v1-IV-3
- **spike #2 cf #21** (TriggerAdapter interface) → RESOLVED by ADR-v1-IV-4
- **spike #2 cf #22** (trigger dedup) → RESOLVED by ADR-v1-IV-6
- **spike #3 cf #19** (RunGuard type) → RESOLVED by ADR-v1-IV-5
- **spike #3 cf #20** (RunGuard shapes ADR) → RESOLVED by ADR-v1-IV-5
- **spike #3 cf #22** (TriggerEvent shape) → RESOLVED by ADR-v1-IV-3 + ADR-v1-IV-6
- **Cat I cf #10** (parallel fan-out) → RESOLVED by ADR-v1-IV-1 + ADR-v1-IV-7

### Lifted to future milestones or categories
- **spike #1 cf #17** (event routing collision risk at high N) → LIFTED to M2 perf (Inngest routes by function + event name; collision risk at N > 100 requires empirical probe under Dev Server)
- **spike #2 cf #23** (webhook HMAC placement) → LIFTED to Cat VI (adapter composition; HMAC verification belongs in TriggerAdapter HTTP handler layer, cross-cuts Cat VI lifecycle)
- **spike #3 cf #21** (Inngest 24h dedup window limit) → LIFTED to M2 (for dedup windows > 24h, a Store adapter with TTL is required at trigger layer; intersects Cat VI adapter composition)

---

*End of v1 Cat IV research notes. 7 ADR candidates locked direction; 14 carry-forwards resolved (11 by ADRs, 3 lifted). Reframe: Trigger<O> stage type rejected in favour of TriggerConfig (Tier 1 config). Fan-out confirmed as adapter pattern not kit primitive. Three-concern separation (concurrency / dedup / singleton) is the central finding; conflating them is the root of F-TRIGGER friction. kitFanOut() + RunGuard declaration are the two load-bearing additions to the adapter and core tiers respectively.*

*Author: Brain — 2026-05-10. Inputs: spike #1 `856d918` / spike #2 `856d918` / spike #3 `c04b994`. Branch: `master`. Master tip at synthesis: `c04b994`.*
