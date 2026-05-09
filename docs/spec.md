# pipeline-kit — Phase 2 Spec (v0)

> **Status:** Draft, in progress. Brain authority. Locks all 23 v0 ADRs +
> API surface + reference adapter list + test plan + v0/v1/v2 roadmap.
> Phase 3 (build) inherits this doc as its sole architectural input.
>
> **Author:** Brain — 2026-05-06.
> **Phase 1 input:** [research-notes.md](research-notes.md) (synthesis;
> 23 v0 ADRs scoped, 8 open questions answered, 5 net-new ADR candidates
> partitioned), [research-outline.md](research-outline.md) (Phase 1
> input doc; outline §7 = original 20 ADRs, §8 = integration milestones,
> §9 = portfolio commercial spec, §11 = adapter list, §12 = test plan).
> **Family conventions:** [gatewerk/docs/research/ideas-to-steal.md](../../gatewerk/docs/research/ideas-to-steal.md) — pipeline-kit
> inherits Stripe-style API conventions, HMAC webhook signing, Result<T,E>,
> Zod boundaries, prefixed IDs, response envelope.

---

## Reading order

This file (`spec.md`): scope (Section 0) + ADRs 1-23 + drilldown reading map.

Drilldowns (separate files; each < 500 lines, mirroring Phase 1
`research-notes-cat-*` per-category discipline):

| File | Lines | Contents |
|---|---:|---|
| [spec-api-surface.md](spec-api-surface.md) | ~225 | §1 API surface — exported types + `createPipelineKit()` factory shape + stage interfaces + `Reviewable<I>` + `EditableField<T>` + webhook helpers + error envelope |
| [spec-adapters.md](spec-adapters.md) | ~210 | §2 Reference adapter list — 16 v0 adapters (4 Source, 3 Store, 5 Process, 4 Serve) per outline §11; per-adapter signature spec |
| [spec-build-plan.md](spec-build-plan.md) | ~290 | §3 Test plan — property tests + invariants + PIV-Loop 5-layer pyramid; §4 Roadmap — v0/v1/v2 milestones (M0-M5) + portfolio sequencing; §5 Deferred — open questions for v1/v2 spec authoring + Phase 3 executor notes |

This split is required because the consolidated v0 spec exceeds 1500 lines
(brain authority discipline; per Phase 1 brief). 23 ADRs + Section 0 fit in
this entry doc; concrete API + adapter detail + roadmap live in drilldowns.

---

## Section 0 — Scope and conventions

### What pipeline-kit IS (v0)

A thin TypeScript library naming the four stages of any automation as typed
interfaces — `Source<O>`, `Store<T>`, `Process<I,O>`, `Serve<I>` — plus a
Composer that wires stages with retry, rate-limit, idempotency, observability,
and HRP review checkpoints built in. Ships 16 reference adapters per outline §11
v0. Ships `Reviewable<I>` as a first-class primitive (not a bolt-on) with
`GatewerkReviewable` reference impl + alternatives (Slack-emoji, email-link,
console).

The library is the abstraction layer **beneath the workflow engine, above the
tool aggregator**: workflow engines (n8n, Activepieces, Inngest) call
pipeline-kit composers; pipeline-kit calls tool aggregators (Composio MCPs,
Apify actors); HITL stations (Gatewerk, gotoHuman) implement HRP and plug into
`Reviewable<I>`.

### What pipeline-kit is NOT (v0)

- Not a workflow engine (calls one, doesn't compete).
- Not an agent runtime (Process<I,O> is consumed by agent runtimes as a tool).
- Not a data warehouse ETL tool.
- Not a tool aggregator.
- Not a HITL station (composes one).
- Not a monitoring dashboard.
- Not a runtime (library called BY user's durable function — see ADR22).

### What's in v0 vs deferred

**v0 ships (this spec):** 23 ADRs locked + 16 reference adapters + Composer
with retry/rate-limit/idempotency/OTel/Reviewable/Audited/EditableField +
Trades Outbound (outline §9 Project A) as first reference project validating
loops α + γ.

**v1 deferred** (future spec): durable adapter to Inngest (ADR3 v1), `enrich-process`,
`dedup-process`, `summarize-process`, CRM serves (HubSpot/Pipedrive/GHL/Attio),
Saga orchestration, route-policy unification (ADR-C deferred), CloudEvents
emission mode (ADR-D deferred), Multi-CRM Operational Sync as second reference
project validating loop β.

**v2 deferred** (future spec): Effect.ts re-evaluation (ADR1 trigger), durable
Composer adapter, Saga-pattern multi-system writes, marketplace, Cloud-managed
hosting, dashboard-serve, gatewerk-audit-source.

### Conventions glossary (kit-wide)

- **Stage:** Source, Store, Process, or Serve. Building block of a pipeline.
- **Atom<T>:** the unit of data flowing through a pipeline at a stage boundary.
  Always carries a stable ID; addressable for observability.
- **Pipeline:** a typed composition of stages owned by Composer.
- **Run:** an instance of a pipeline executing for a specific input.
- **Composer:** the orchestrator; wires stages, applies kit-level concerns
  (retry, rate-limit, idempotency, OTel, Reviewable). Library; not a runtime.
- **Reviewable<I>:** HRP gate primitive. Takes `I`, awaits a reviewer
  decision, returns approved (possibly edited) `I` or halt.
- **EditableField<T>:** type carrying `{ suggested, approved, wasEdited }` —
  flows through pipeline so downstream Process knows what was edited.
- **Result<T, E>:** `{ data: T; error: null } | { data: null; error: E }`
  — kit-wide error contract; no thrown errors crossing public stage boundary.
- **Prefixed IDs:** `pk_pipe_`, `pk_run_`, `pk_atom_`, `pk_src_`, `pk_proc_`,
  `pk_serve_`, `pk_review_`, `pk_evt_`.
- **Response envelope:** every emitted resource carries `id`, `object`,
  `created_at`, `metadata`.
- **Idempotency:** mandatory on Serve adapters mutating external state;
  24h default cache window (configurable per ADR9).
- **Webhook signing:** HMAC-SHA256 + 5-min timestamp tolerance + constant-time
  compare; v2-style header default (ADR21).

---

## Architectural Decisions (ADRs 1-23)

ADR template (per section): `Status` / `Context` / `Decision` /
`Alternatives considered` / `Reference signal` / `Consequences`.

ADRs 1-20 inherit numbering from `research-outline.md` §7. ADRs 21-23 are
net-new from Phase 1 synthesis (research-notes.md §"5 new ADR candidates":
A=21, B=22, E=23). C and D defer to v1 spec.

---

## ADR1 — Decline Effect.ts adoption for v0 (vanilla TypeScript)

**Status:** Accepted (v0). v1 re-evaluation triggered by ADR1-cascade impact
analysis after first 2-3 portfolio projects ship.

**Context:** Effect.ts ships a cohesive ecosystem (`@effect/workflow`,
`@effect/sql-drizzle`, `@effect/opentelemetry`, `@effect/vitest`,
`@effect/schema`, `@effect/ai-*`) that would unify pipeline-kit's runtime
under a single typed-effect system. Adopting Effect cascades through ADR3
(durable execution), ADR8 (observability), ADR11 (ORM), ADR15 (test framework),
ADR6 (schema validation). The question is whether v0 commits to Effect or
ships vanilla TypeScript with the option to revisit later.

**Decision:** **v0 ships vanilla TypeScript.** Effect adoption is deferred to a
v2 re-evaluation triggered by explicit cascade-impact analysis after the first
2-3 portfolio projects validate user-facing APIs. v0's choices align with
Phase 1 synthesis: ship-velocity, lower user learning curve, cleaner
composition with external libraries (Inngest, Drizzle, OTel JS) which all have
strong vanilla-TS APIs.

**Alternatives considered:**
- *Adopt Effect fully in v0.* Rejected — learning curve is real ("similar to
  learning TypeScript"); cascade locks 5 other ADRs around Effect's ecosystem;
  users unfamiliar with FP pay productivity tax; pipeline-kit is library, not
  framework, so adopting a framework-shaped runtime layer fights the
  positioning.
- *Mix vanilla TS + selected Effect primitives (Layer DI only, or Schema only).*
  Rejected — wrapper hell; Effect's value is ecosystem cohesion, not
  individual primitives.

**Reference signal:** research-notes-cat-I.md sources 1-2 (Effect.ts docs +
monorepo) — "ADR1 cascade means adopting Effect changes ADR3 (use
@effect/workflow), ADR8 (@effect/opentelemetry), ADR11 (@effect/sql-drizzle),
ADR15 (@effect/vitest). Either commit or stay vanilla." research-notes.md
"Brain adjudication" section locks DECLINE for v0.

**Consequences:** Cascade-positive specifications required for ADR3, ADR6,
ADR8, ADR11, ADR15 (each picks a specific vanilla library; see those ADRs).
v1 re-evaluation trigger is an explicit ADR1-revision after 2-3 portfolio
projects ship, NOT a calendar deadline. If users hit Result-handling
boilerplate or DI fragility in real projects, the case for Effect strengthens;
if vanilla holds up cleanly, defer to v2 or skip entirely. ADR1's decision is
revisited only at that explicit gate.

---

## ADR2 — Source semantic: pull (Singer-compatible) by default; webhook-source as exception

**Status:** Accepted (v0).

**Context:** Source<O> can pull (caller invokes; Source returns data — Singer
tap pattern) or push (Source pushes events; CDC pattern). Webhook-source is
inherently push at the HTTP boundary but is exposed to the kit as a pull-style
adapter (registered handler invoked when HTTP arrives). Streaming and batch
are orthogonal (see ADR7).

**Decision:** **Pull by default; webhook-source is the documented push
exception.** All v0 Source adapters expose `iter(query, cursor): AsyncIterable<O>`
(streaming) and `fetch(query, cursor): Result<O[], SourceError>` (batch). The
caller invokes Source; Source returns. Webhook-source registers a request
handler that translates HTTP push into kit's pull semantic at dispatch time.

**Alternatives considered:**
- *Push-by-default (CDC-style).* Rejected — most automations are
  request/response or scheduled-pull; push-by-default fights the dominant
  pattern, complicates rate-limit semantics, and locks Source adapters into
  long-running connections.
- *Streaming-only or batch-only.* Rejected — see ADR7.

**Reference signal:** research-notes-cat-III.md (Singer protocol, Airbyte CDK,
Apify SDK) — pull-style cursor + state checkpoint is industry default for
connector ecosystems. Cat-VII (Hono + webhook source) confirms push-on-HTTP
is wrapped to pull at dispatch.

**Consequences:** Schedule primitive deferred to v2 (kit doesn't own scheduling;
caller — workflow engine, cron, or durable executor — owns it). Source
adapters expose state checkpointing via cursor parameter in `iter`/`fetch`;
caller persists cursor between runs. Webhook-source is a special-case adapter
(documented carefully) and is the kit's only push-shaped intake.

---

## ADR3 — Sync execution v0; durable execution v1 via Inngest reference adapter

**Status:** Accepted (v0).

**Context:** Pipeline orchestration can run sync (in-process, blocking the
caller) or durable (checkpoint between stages, survive restarts). Durable
execution requires significant infra (event store, replay, dead-letter,
schedule). Inngest, Trigger.dev, Hatchet, and Temporal offer this; `@effect/workflow`
would be in scope IF ADR1 adopted Effect (which it didn't).

**Decision:** **v0 ships sync (in-process) Composer.** v1 ships a reference
durable composition pattern targeting **Inngest as primary reference**,
documented as integration pattern (not a custom adapter; pipeline-kit is a
library that runs INSIDE the user's Inngest function — see ADR22). Trigger.dev
listed as second reference; Hatchet third; Temporal as architectural
reference only (deterministic-workflow constraint is too heavy for general
pipeline-kit users). Durable execution semantics follow Inngest's
step-as-boundary pattern: each Source/Process/Serve invocation is a logical
durable step.

**Alternatives considered:**
- *Durable from v0.* Rejected — kit is library, not runtime; building durable
  infra is months of work; users who want durability already have Inngest /
  Trigger.dev / Temporal in their stack.
- *@effect/workflow as v0 durable layer.* Rejected per ADR1 cascade.
- *Temporal as primary v1 reference.* Rejected — deterministic-workflow
  constraint forces users to refactor Process functions; pipeline-kit's
  "functional core, imperative shell" allows side effects in Process where
  pragmatic; Inngest's relaxed durability fits the kit's audience better.

**Reference signal:** research-notes-cat-I.md sources 3-6 (Inngest, Trigger.dev,
Hatchet, Temporal) + Cat-V sources 28-29 (Outbox + Saga). "Step-as-durable-
boundary" pattern converges across all 4. Cat-I synthesis open question 1
explicitly recommends "library called BY user's durable function" architecture
— which becomes ADR22.

**Consequences:** v0 Composer is a synchronous orchestrator wrapping
async stages. Cancellation flows via AbortSignal. Retry budget and idempotency
keys flow through Composer (per ADR9, ADR13). v1 docs ship a "running
pipeline-kit inside Inngest" reference pattern — not a new adapter, just the
recommended composition pattern for users who need durability. Saga
orchestration deferred to v2 (Cat-V Q3).

---

## ADR4 — Result<T, E> kit-wide; no thrown errors across public stage boundary

**Status:** Accepted (v0).

**Context:** TypeScript supports both throwing and Result-style error
returning. Effect.ts and Gatewerk-sdk-ts use discriminated-union Result;
stripe-node and most older SDKs throw. Mixing styles in a single kit creates
inconsistent error semantics for callers and breaks compositional pipelines
(`if (error) return early` patterns).

**Decision:** **All public stage boundaries return `Result<T, E>` =
`{ data: T; error: null } | { data: null; error: E }`.** No thrown errors
crossing public stage boundaries. Kit-internal helpers may throw (caught by
Composer wrapper); kit's public surface is Result-only. Errors are typed
discriminated unions per stage:
- `SourceError` — `network`, `rate_limited`, `auth`, `schema`, `parse`,
  `cursor_invalid`, `unavailable`.
- `StoreError` — `idempotency_conflict`, `migration_pending`, `connection`,
  `constraint`, `not_found`.
- `ProcessError` — `validation`, `llm`, `timeout`, `dependency`, `unknown`.
- `ServeError` — `idempotency_required`, `auth`, `rate_limited`,
  `permanent`, `transient`.

Each error carries `type` (kind discriminator), `code` (Stripe-shape), `message`,
`param?`, `doc_url?` per Sentry-shape error envelope inherited from Gatewerk
catalog §1.

**Alternatives considered:**
- *Thrown errors.* Rejected — breaks compositional `(input) => Result<output>`
  pipelines; loses static type-narrowing on error code at consumer.
- *Effect.ts `Effect<A, E, R>`.* Rejected per ADR1 cascade.
- *Mixed (throw for kit-internal, Result at boundary).* Same conclusion in
  practice — kit-internal helpers throw; only public surface is Result.

**Reference signal:** research-notes-cat-II.md source 9 (Resend
`{ data, error }`), source 11 (Knock typed exceptions), source 13
(Gatewerk-sdk-ts canonical local reference). research-notes.md "Top 10 lift
patterns" #2.

**Consequences:** Constrains every Source/Store/Process/Serve impl signature
to return Result. Composer's retry policy reads `error.type` to decide
retryable vs not (e.g., `rate_limited` retries with backoff, `permanent`
short-circuits). SDK adopts same Result shape (createPipelineKit returns
methods that return Result — see ADR23 + §1). Constrains ADR16 to use
Sentry-shape error envelope.

---

## ADR5 — Pass-through Context for state/DI; orchestr8 backend for cross-run memory

**Status:** Accepted (v0).

**Context:** Stages need access to runtime state: run ID, pipeline ID, OTel
trace context, AbortSignal for cancellation, idempotency key, user-provided
metadata, reviewer callback registry. Effect.ts uses Layer DI; Hatchet uses
implicit context per worker; Temporal uses explicit context-per-activity.
Vanilla TS needs a concrete shape that threads through every stage and
composes with retry/observability/Reviewable.

**Decision:** **`PipelineContext` is the kit-managed, read-mostly object
threaded through every stage invocation.** Composer creates a fresh Context
per `Pipeline.run(input, options)` call. Stages receive Context as the second
argument: `(input: I, ctx: PipelineContext) => Promise<Result<O, E>>`. Cross-run
memory (e.g., feedback corpus, vector store cache) is exposed via a separate
**memory adapter** backed by orchestr8 (kit ships `MemoryAdapter` interface;
v0 reference impl is `OrchestratorMemoryAdapter` calling out to orchestr8 MCP).

**Concrete `PipelineContext` shape:**

```typescript
interface PipelineContext {
  readonly runId: string;        // pk_run_<ulid>
  readonly pipelineId: string;   // pk_pipe_<id>
  readonly attempt: number;      // 1-based; bumped by retry wrapper
  readonly metadata: Readonly<Record<string, unknown>>;  // user pass-through
  readonly signal: AbortSignal;  // cancellation
  readonly trace: TraceContext;  // OTel context (for child span creation)
  readonly idempotencyKey?: string;  // set by Composer for Serve adapters
  readonly memory?: MemoryAdapter;   // optional cross-run memory backend
  attachMetadata(key: string, value: unknown): void;  // mutation via helper
}
```

Composes with:
- **Retry**: Composer's retry wrapper bumps `attempt`, refreshes
  `idempotencyKey` consistency, propagates `signal`.
- **Observability**: each stage call creates a child OTel span via `ctx.trace`;
  span attributes auto-populated from `runId`, `pipelineId`, `attempt`.
- **Reviewable<I>**: Reviewable adapters receive Context; can write reviewer
  decision metadata into `ctx.attachMetadata("review.<reviewableId>", ...)` for
  downstream stages.

**Alternatives considered:**
- *Effect Layer DI.* Rejected per ADR1 cascade.
- *Global registry / module-scoped state.* Rejected — breaks composability;
  multiple concurrent Pipeline runs in the same process collide.
- *Implicit context (AsyncLocalStorage).* Rejected — kit must work in edge
  runtimes (Cloudflare Workers, Vercel Edge) where AsyncLocalStorage is
  unsupported or has caveats; explicit Context argument is universal.

**Reference signal:** research-notes-cat-I.md source 1 (Effect Layer DI
inspiration), source 4 (Trigger.dev `ctx`), source 6 (Temporal Activity
context). research-notes.md MED-confidence ADR5 ("Phase 2 needs to define
Context shape concretely") — this ADR delivers the concrete shape.

**Consequences:** Every stage signature is `(input: I, ctx: PipelineContext)
=> Promise<Result<O, E>>`. Composer is responsible for instantiating Context
per run. orchestr8 backend is opt-in via `createPipelineKit({ memory:
orchestr8Adapter })`; kit works without memory (cross-run learning is a
v0 reference feature, not a baseline). v1 may add `Inngest`-aware Context that
threads Inngest's `step` parameter through Context — designed as a v1
interface but not a v0 commitment. **`child(overrides)` for sub-pipeline
context cloning was considered but cut from v0** — no v0 reference adapter
needs it, and library-side norm (Inngest/Trigger.dev/Hatchet) doesn't
pre-ship; add when concrete use case lands.

---

## ADR6 — Zod at every Source/Serve boundary; optional inside Process

**Status:** Accepted (v0). Cascade specification from ADR1 (vanilla → Zod, not
Effect Schema).

**Context:** Boundary validation is mandatory (untrusted input from external
systems must be schema-validated). Inside Process (kit-internal data
transformations), validation is optional — adds latency for low marginal
benefit if input is already validated upstream. Effect Schema would be
preferable IF ADR1 adopted Effect; ArkType offers performance gains at
ecosystem-maturity cost.

**Decision:** **Zod at every Source `iter`/`fetch` boundary and every Serve
`emit` boundary; optional inside Process.** Use `safeParse` (returns Result
shape) at boundaries; never `parse` (throws). For LLM-output boundaries inside
Process (extract-process, classify-process), use `.catch()` for boundary
coercion (TS analog of pursuit's `feedback_pydantic_boundary_coercion.md`
pattern: coerce malformed-but-recoverable input rather than rejecting the
entire response). Auto-derive JSON schemas for LLM structured output via
`zod-to-json-schema`. Drizzle table → Zod schema bridging via `drizzle-orm/zod`
(bundled, not separate package).

**Alternatives considered:**
- *Effect Schema.* Rejected per ADR1 cascade.
- *ArkType.* Rejected for v0 — ecosystem cohesion (drizzle-zod, hono-zod, tRPC,
  zod-to-json-schema, OpenAI structured outputs SDK) materially deeper. ArkType
  perf advantage is real (20x object validation per source 36) but irrelevant
  for v0; v1 reconsiders if production hot path bottlenecks on validation.
- *No boundary validation (trust callers).* Rejected — kit is consumed by
  agents emitting unstructured/semi-structured output; LLM outputs need
  schema enforcement.

**Reference signal:** research-notes-cat-VI.md source 33 (Zod), 35 (Effect
Schema cross-ref), 36 (ArkType perf signal), 37 (Drizzle drizzle-zod).
Pursuit's `feedback_pydantic_boundary_coercion.md` lesson — coerce, don't
reject, at LLM-output boundaries.

**Consequences:** Zod 4 is a hard dependency. TypeScript 5.5+ is required
(Zod 4 + `strict: true`). Source/Serve adapter signatures include Zod schemas
as a required parameter. ADR11 inherits Zod via drizzle-zod for Store
schemas. ArkType escape hatch deferred to v1; no profiling work in v0.

---

## ADR7 — Both streaming (`iter`) and batch (`fetch`) primary on Source

**Status:** Accepted (v0).

**Context:** Source adapters can expose streaming (AsyncIterable, push-style
emission as data arrives), batch (return whole result set as array), or both.
Singer protocol uses streaming; many REST APIs are batch-natural; Apify
actors return both depending on adapter design. Picking only one forces
unnatural patterns for the other.

**Decision:** **Both primary; same Source adapter MUST expose both
methods.**
- `iter(query, cursor): AsyncIterable<Atom<O>>` — streaming, lazy, supports
  early termination.
- `fetch(query, cursor): Promise<Result<Atom<O>[], SourceError>>` — batch,
  returns whole result. Cursor advance is included in result.

Property test (per outline §12): for any Source<O>, `iter` and `fetch` produce
the same data (when iter completes) given equivalent params. This invariant
holds for all v0 reference Source adapters.

**Alternatives considered:**
- *Streaming only (AsyncIterable).* Rejected — batch consumers (`Promise.all`
  callers, simple sync flow) pay an unnecessary `for await` loop for tiny
  result sets.
- *Batch only.* Rejected — large result sets (Apify with 50K+ items) need
  back-pressured streaming.
- *Effect Stream.* Rejected per ADR1 cascade.

**Reference signal:** research-notes-cat-III.md sources 14-19 (Airbyte +
Singer + Apify SDK + n8n + Activepieces). Cat-I source 1 (Effect Stream)
referenced as architectural inspiration only.

**Consequences:** Every Source adapter implements both. Composer's Pipeline
runtime chooses streaming when downstream Process is back-pressure-aware;
otherwise batch. Property test in §3 enforces equivalence. Cancellation via
AbortSignal interrupts both.

---

## ADR8 — OpenTelemetry native; peerDep SDK; OTLP exporter for prod, ConsoleSpan for dev

**Status:** Accepted (v0). Cascade specification from ADR1 (vanilla OTel JS,
not `@effect/opentelemetry`).

**Context:** Observability is a reliability primitive (per Cat-V Fail at
Scale + AWS Builder's Library), not an add-on. The kit must emit
trace/metric/log signals at every stage boundary. The question is which
library, what's bundled vs peerDep, and what's the recommended
prod-vs-dev exporter pattern.

**Decision:** **OpenTelemetry JS native at every stage boundary.**
- `@opentelemetry/api` is a **peerDep** — kit's tracing API is OTel-shaped;
  the SDK is initialized by users (avoids bundle bloat for users who don't
  need traces or already have OTel set up).
- `@opentelemetry/sdk-node` is a **peerDep** for Node-runtime users; kit
  documents standard initialization in README + reference projects.
- Default exporters documented: **`ConsoleSpanExporter`** for dev (no
  collector required), **OTLP-HTTP** (`@opentelemetry/exporter-trace-otlp-http`)
  for prod (default OTel format; aligned with Langfuse, Honeycomb, Datadog,
  Grafana).
- Langfuse-specific cost-tracking attributes (`gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.system`, `gen_ai.request.model`)
  emitted on Generation spans by `extract-process` adapter — follows OTel
  Semantic Conventions for Gen AI; Langfuse auto-ingests via standard OTel.
- `SpanStatusCode.OK` / `SpanStatusCode.ERROR` mapped from Result<T,E>: any
  stage returning `error: null` sets OK; any error sets ERROR with
  `error.type` + `error.code` as span attributes; `recordException(err)` for
  stack traces.

**Alternatives considered:**
- *Bundled OTel SDK as hard dep.* Rejected — bundle bloat, inflexibility for
  users with existing OTel setup.
- *Custom logging/tracing API.* Rejected — fragments observability ecosystem;
  forces users to wire kit-specific exporters.
- *`@effect/opentelemetry`.* Rejected per ADR1 cascade.

**Reference signal:** research-notes-cat-VIII.md sources 43-44 (OpenTelemetry
JS + Langfuse). research-notes.md "Top 10 lift patterns" #8 (emit-but-don't-
bundle).

**Consequences:** Kit's package.json declares `@opentelemetry/api`,
`@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http` as
peerDeps. README ships dev + prod init snippets. Reference projects (Trades
Outbound) use OTLP-HTTP → Langfuse self-hosted by default. Cost-tracking
attributes documented in ADR section §1 + §2 adapter spec for `extract-process`.

---

## ADR9 — Idempotency mandatory on Serve mutating; auto-generated keys; 24h default cache window

**Status:** Accepted (v0).

**Context:** Serve adapters that mutate external state (send-email,
create-CRM-deal, fire-webhook) MUST be safely retryable. Idempotency keys
solve the dual-write / retry problem; Stripe canon (cache 24h, header-level)
is industry default. The question is who generates the key (caller or kit),
how long to cache, and how scope is documented.

**Decision:** **Idempotency keys mandatory on Serve adapters mutating external
state. Kit auto-generates keys at SDK layer (Knock pattern) — users don't
have to manage them; opaque keys override accepted.**
- Default key derivation: `pk_evt_<ulid>` per `Composer.run()` invocation;
  per-Serve scope = `<runId>:<serveAdapterId>:<atomId>`.
- Cache window: **24h default; configurable per Serve adapter**. Regulated
  verticals (healthcare, finance) extend; documented in spec.
- Scope: kit's idempotency is **request-fingerprint hybrid** — header-level
  key plus a body fingerprint check (catches reused keys against changed
  inputs; warns but doesn't block).
- Pairs with exponential backoff + jitter on retry (per ADR13 + AWS canon);
  retry only proceeds if Serve adapter declares idempotency support.

**Alternatives considered:**
- *Caller-managed keys only.* Rejected — most users don't generate keys
  correctly (collision via non-unique input hashing).
- *Body-fingerprint only.* Rejected — request body can change between retries
  legitimately (e.g., timestamp field); body-only fingerprint causes false
  cache misses.
- *Header-only.* Rejected — silent stale-replay risk if key reused with
  different body.

**Reference signal:** research-notes-cat-V.md source 30 (Stripe idempotency
engineering), source 31 (AWS Builder's Library — token-bucket + idempotency
together). research-notes-cat-II.md sources 8, 11 (Stripe SDK + Knock
auto-generated keys). research-notes.md Q4 (24h default locked).

**Consequences:** Serve interface declares `idempotencySupport: 'required' |
'optional' | 'unsupported'`. Composer rejects retries on `unsupported`
adapters with a descriptive error. **Storage of cached responses is
per-Serve-adapter responsibility, not kit-core** (industry standard: Stripe
+ Knock SDKs don't ship local idempotency caches; server-side dedup is the
canonical pattern). Serve adapters that need persistence wire a Store
adapter as their cache backing (e.g., `postgres-store` or `sqlite-store`
table for the cache window). Kit core only propagates keys via Context.
Documented in spec §1.

---

## ADR10 — Token-bucket backpressure at Source/Serve boundary

**Status:** Accepted (v0).

**Context:** Backpressure prevents Source/Serve adapters from overwhelming
external systems (rate limits, throughput caps, fairness). RxJS-style
buffer/drop is one option; token-bucket (AWS canonical) is another. Inngest
uses token-bucket equivalent (`throttle: { limit, period }`); Hatchet uses
worker-level slots.

**Decision:** **Token-bucket at Source AND Serve boundary.** Same primitive
serves rate-limit (proactive) and retry-budget (reactive after failure).
Configuration:
```typescript
interface TokenBucketConfig {
  capacity: number;       // max tokens
  refillRate: number;     // tokens per period
  refillPeriod: number;   // ms
  initialTokens?: number; // default = capacity
}
```
Per-stage config; applied by Composer wrapper. Default: capacity=10,
refillRate=10, refillPeriod=1000 (10 req/sec); user overrides per adapter
or globally per Pipeline.

Token-bucket also serves as the "circuit breaker" primitive (per outline §11
v0): when bucket exhausted under sustained failure, Composer halts further
attempts at the stage and surfaces a `rate_limited` error. Explicit hard-trip
circuit breaker available as opt-in for users who want modal semantics.

**Alternatives considered:**
- *RxJS-style buffer/drop.* Rejected — couples kit to RxJS conceptually;
  token-bucket simpler and matches AWS / Inngest / Hatchet pattern.
- *No backpressure (callers manage).* Rejected — most users don't set up
  rate limits correctly; kit-level default catches real-world abuse cases.
- *Modal circuit breaker primary.* Rejected — token-bucket subsumes circuit
  breaker for most cases per AWS canonical guidance; modal CB available as
  opt-in.

**Reference signal:** research-notes-cat-V.md sources 31-32 (AWS Builder's
Library + Fail at Scale — retries-without-budget = thundering herd /
metastable failure). research-notes-cat-I.md sources 3, 5 (Inngest throttle,
Hatchet RateLimit/Concurrency).

**Consequences:** Composer applies token-bucket wrapper per stage based on
stage config. Same primitive used for Source rate-limiting and Serve retry
budget. Property test verifies bucket-exhaustion produces `rate_limited`
error rather than blocking indefinitely.

---

## ADR11 — Drizzle ORM directly; native multi-runtime; drizzle-zod for schema bridging

**Status:** Accepted (v0). Cascade specification from ADR1 (vanilla Drizzle,
not `@effect/sql-drizzle`).

**Context:** Store adapters need an ORM. Prisma (mature but heavyweight,
generates code), Drizzle (schema-first, type-safe, edge-friendly), TypeORM
(legacy active-record), Knex (query builder only) are options. Bun
compatibility is mandatory (CLAUDE.md). drizzle-zod auto-derives Zod schemas
from table definitions, which aligns with ADR6.

**Decision:** **Drizzle ORM directly for `postgres-store` + `sqlite-store` +
`pgvector-store`.**
- `drizzle-orm/pg-core` for Postgres (`postgres-store`, `pgvector-store`).
- `drizzle-orm/better-sqlite3` for local-dev SQLite (`sqlite-store`).
- `drizzle-orm/bun-sqlite` for Bun-runtime SQLite (CI compatibility).
- `pgvector` extension via Drizzle's custom-type pattern (kit ships
  `pgvectorColumn` helper exporting custom type).
- Migrations: `drizzle-kit generate` → SQL in `migrations/` → committed →
  `drizzle-kit migrate` in CI/prod. **Never `drizzle-kit push` in prod.**
- `drizzle-orm/zod` (now bundled in drizzle-orm) for auto-deriving Zod
  schemas from Drizzle tables. Removes duplicate schema definitions for
  Store types.

**Alternatives considered:**
- *Prisma.* Rejected — heavyweight runtime (separate query engine), code-gen
  step in build, opinionated schema syntax. Drizzle is "SQL-shaped TypeScript"
  which fits kit's functional-core philosophy better.
- *@effect/sql-drizzle.* Rejected per ADR1 cascade.
- *Raw SQL only.* Rejected — type inference is critical for Store<T> generic
  parameter to flow correctly.
- *Multi-ORM support (caller picks).* Rejected for v0 — adds maintenance
  surface; v0 ships Drizzle as default; v1 may add adapter for users with
  Prisma stack.

**Reference signal:** research-notes-cat-VI.md source 37 (Drizzle ORM).
research-notes-cat-I.md source 2 (`@effect/sql-drizzle` referenced for
ADR1-cascade alignment). pursuit's `~/Claude-Workspace/pursuit/agents/tools/
storage/relational/supabase.py` uses Postgres directly; pipeline-kit's
TS twin uses Drizzle.

**Consequences:** Hard deps: `drizzle-orm`, `drizzle-kit` (devDep), database
drivers (`postgres`, `better-sqlite3`, `bun:sqlite` per runtime). Migrations
ship alongside Store adapter packages (e.g.,
`@idriszade/store-postgres/migrations/`). Auto-derived Zod schemas in
Store interface signatures (see §1, §2).

---

## ADR12 — Chainable Pipeline composition: `Pipeline.from(s).through(p).store(st).to(srv)`

**Status:** Accepted (v0).

**Context:** Composition syntax must be type-narrowing (each step refines
output type), readable for the typed-stage thesis (Source → Process → Store →
Serve), and consistent with LCEL-style chainable patterns familiar to users
of LangChain. Effect uses `pipe()`; Inngest uses flat function-with-steps;
Trigger.dev uses task definitions. Branching/parallel primitives can land in
v1 (per Phase 1 brain "single-priority for v0").

**Decision:** **Chainable Pipeline factory with type-narrowing through
`through`/`store`/`review`/`to` methods.**

Concrete signatures:
```typescript
// Pipeline factory
const Pipeline = {
  from<O>(source: Source<O>): SourcePipeline<O>,
};

// SourcePipeline: pre-terminal, can chain
interface SourcePipeline<O> {
  through<Out>(process: Process<O, Out>): SourcePipeline<Out>;
  store(store: Store<O>): SourcePipeline<O>;       // side-effect, doesn't transform
  review(reviewable: Reviewable<O>): SourcePipeline<O>;  // HRP gate, doesn't transform
  to(serve: Serve<O>): TerminalPipeline<O>;        // closes the pipeline
}

// TerminalPipeline: ready to execute
interface TerminalPipeline<O> {
  run(input?: unknown, options?: RunOptions): Promise<Result<RunResult<O>, RunError>>;
  describe(): PipelineDefinition;  // serializable; ID = pk_pipe_<id>
}

interface RunOptions {
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  context?: Partial<PipelineContext>;
}

interface RunResult<O> {
  runId: string;        // pk_run_<ulid>
  pipelineId: string;
  output: O;
  atomCount: number;
  duration: number;     // ms
  metadata: Record<string, unknown>;
}
```

Type-narrowing flow: `Pipeline.from(apiSource: Source<RawData>)` →
`SourcePipeline<RawData>` → `.through(extract: Process<RawData, ExtractedData>)`
→ `SourcePipeline<ExtractedData>` → `.through(reviewWrapper)` →
`SourcePipeline<ApprovedData>` → `.to(slackServe: Serve<ApprovedData>)` →
`TerminalPipeline<ApprovedData>` → `.run()`.

**Alternatives considered:**
- *Effect `pipe()` style.* Rejected per ADR1 cascade.
- *Function composition (`compose(...stages)`).* Rejected — loses
  type-narrowing readability; kit's typed-stage thesis is best expressed by
  named methods (`from`, `through`, `to`).
- *Builder pattern with `build()` finalizer.* Rejected — `to(serve)` is the
  natural finalizer; adding `build()` is redundant ceremony.
- *DAG/branching primitives in v0 (`split`, `when`, `parallel`).* Rejected
  for v0 — Phase 1 brain locked single-priority for v0; complex DAG support
  lands in v1 once two reference projects ship and real branching needs are
  observed.

**Reference signal:** research-notes-cat-I.md source 7 (LangChain LCEL
inspiration). research-notes-cat-II.md source 12 (tRPC procedure-builder
chaining as TypeScript precedent). research-notes.md MED-confidence ADR12
("chainable choice closer to LCEL"). Q1-Q2 lock library-not-runtime
(reinforces single-priority chainable design).

**Consequences:** v0 chainable API is stable; v1 may add `branch()` or
`parallel()` methods for DAG support without breaking existing chainable
calls. `describe()` returns a serializable definition (JSON-serializable;
ADR16 envelope) — useful for auto-MCP exposure (deferred to v1) and
remote-Composer use cases (v2). Property test verifies type-narrowing:
`Pipeline.from(s: Source<A>).through(p: Process<A, B>).to(srv: Serve<B>)`
type-checks; mismatched generics fail at compile time.

**Primitive + sugar relationship with `reviewable-wrapper`:** `.review(rev)`
is syntactic sugar over `Pipeline.through(reviewableWrapper(rev))`. The
underlying primitive is the `reviewable-wrapper` Process<I,I> adapter (per
§2 #12); `.review()` is a chainable shortcut that composes through it. Same
relationship as Drizzle's `db.select().from()` over `db.execute(buildQuery())`
— one is the engine, the other is the convenience. Users wanting explicit
imperative control reach for `reviewable-wrapper`; users in chainable flow
use `.review()`. Both ship; both call into the same Reviewable execution.

**Pipeline input typing (executor-brief detail):** `Pipeline<Input, Output>`
is generic over both. Pipelines starting from a Source whose `iter`/`fetch`
takes no external query infer `Input = void` and call `pipeline.run()`;
pipelines starting from a Source taking external query infer `Input = SourceQuery`
and call `pipeline.run(query)`. The executor brief locks the precise generic
inference; v0 spec locks the principle. `unknown` is not the final type.

---

## ADR13 — Per-stage retry policy with kit defaults; AWS canonical defaults

**Status:** Accepted (v0). Cascade specification from ADR1 (vanilla retry,
not `Effect.Schedule`).

**Context:** Retry policy must balance recovery from transient failures
against thundering-herd / metastable-failure risk. AWS Builder's Library
canonicalizes the params; Inngest, Trigger.dev, Hatchet all expose per-stage
config. Kit needs to pick concrete defaults plus the underlying library.

**Decision:** **Per-stage retry policy with kit-level defaults; thin
kit-built retry wrapper around `p-retry` library for vanilla TS; per-stage
overrides documented in stage config.**

Concrete defaults (AWS canonical):
```typescript
interface RetryPolicy {
  maxAttempts: number;     // default 3
  baseDelayMs: number;     // default 100
  maxDelayMs: number;      // default 30_000  (30s; AWS canon 10-32s)
  jitter: 'none' | 'full' | 'equal';  // default 'full'  (random(0, backoff))
  respectRetryAfter: boolean;  // default true
  retryableErrors: string[];   // error.code values that trigger retry
}
```

Default `retryableErrors`: `['rate_limited', 'transient', 'network',
'timeout', 'unavailable']`. Default non-retryable (short-circuits via
`NonRetriableError` pattern from Inngest): `['auth', 'permanent', 'validation',
'idempotency_conflict']`.

Both layers (per Phase 1 brain Q3): **global per-Pipeline budget** (Composer
enforces aggregate retry count) + **per-Stage policy** (each adapter ships
default).

**Alternatives considered:**
- *p-retry directly with no kit wrapper.* Rejected — kit's policy schema
  (with `retryableErrors`) needs an adapter layer.
- *Custom retry from scratch.* Rejected — `p-retry` is small, well-tested,
  matches AWS canon out of box.
- *`Effect.Schedule`.* Rejected per ADR1 cascade.
- *No global budget (per-stage only).* Rejected per Q3 lock — global budget
  prevents one runaway stage from exhausting kit's retry tokens.

**Reference signal:** research-notes-cat-V.md source 31 (AWS Builder's Library
canonical defaults table). research-notes-cat-I.md sources 3-5 (Inngest /
Trigger.dev / Hatchet per-stage policy). Q3 (both layers locked).

**Consequences:** Hard dep: `p-retry`. Composer wraps every stage in retry
adapter. Property test: stage emitting `rate_limited` retries with
exp-backoff; stage emitting `auth` short-circuits without retry. Bottleneck
library NOT used in v0 (token-bucket is enough for rate-limit; Bottleneck
adds redundant complexity).

---

## ADR14 — `Reviewable<I>` first-class HRP primitive; protocol-based, not Gatewerk-coupled

**Status:** Accepted (v0).

**Context:** HITL gates in pipeline-kit are mandatory for any flow that ships
external action. Gatewerk is the canonical HITL station, but pipeline-kit
must remain HITL-station-agnostic — the kit speaks HRP natively, not just
Gatewerk's API. Permission flags + descriptor pattern from LangChain Agent
Inbox (`HumanInterruptConfig`) + gotoHuman + Gatewerk converges.

**Decision:** **`Reviewable<I>` is a first-class kit primitive**. Interface:

```typescript
interface ReviewableConfig {
  allowApprove: boolean;
  allowReject: boolean;
  allowEdit: boolean;
  allowRetry: boolean;
  allowIgnore: boolean;
}

type ReviewResponse<I> =
  | { decision: 'approved'; value: I; wasEdited: boolean; reviewer?: string }
  | { decision: 'rejected'; reason?: string; reviewer?: string }
  | { decision: 'retry'; feedback?: string; reviewer?: string }
  | { decision: 'ignored'; reason?: string };

interface Reviewable<I> {
  readonly id: string;            // pk_review_<id>
  readonly config: ReviewableConfig;
  describe(input: I): string;     // human-readable summary for reviewer UI
  review(input: I, ctx: PipelineContext): Promise<Result<ReviewResponse<I>[], ReviewError>>;
}
```

Return shape is **list-of-responses from day one** (per Phase 1 synthesis Top
5 ADR resolutions): supports multi-reviewer scenarios, escalation chains, and
multi-stage reviews without breaking change in v1+.

**Reference impl: `GatewerkReviewable`** (calls Gatewerk via Gatewerk SDK).
**Alternatives in v0**: `SlackEmojiReviewable` (uses Slack reaction-emoji as
gate), `EmailLinkReviewable` (signed-URL approve/reject), `ConsoleReviewable`
(dev-only; CLI prompt). All four ship in v0; users pick or implement custom.

**Composer integration:** `Pipeline.review(reviewable)` chains into the flow
between stages. Composer awaits Reviewable, applies first response (or first
non-`ignored` response if multi-reviewer), threads `EditableField<T>` (per
ADR19) when `wasEdited === true`, halts on `rejected`/`retry`.

**Alternatives considered:**
- *Gatewerk-only gate primitive.* Rejected — locks kit to Gatewerk; HRP is the
  contract, Gatewerk is one impl.
- *Single-response shape (no list).* Rejected — multi-reviewer / escalation
  needs list-of-responses; deferring to v1 = breaking change.
- *Bolt-on plugin.* Rejected — Reviewable is load-bearing for kit's
  positioning; first-class primitive only.

**Reference signal:** research-notes-cat-IV.md sources 20-27 (Gatewerk +
gotoHuman + HumanLayer + LangChain Agent Inbox + LangGraph interrupt).
research-notes.md "Top 5 ADR resolution candidates" #14 — direct verbatim
spec lift.

**Consequences:** `Pipeline.review(reviewable)` is part of v0 chainable API.
HRP spec compliance is non-negotiable; kit pins HRP v1 (per outline §17 Q2).
v0 ships 4 reference Reviewable adapters; users can implement custom by
satisfying interface. Composer's resume semantics integrate with
Reviewable's async response (sync in v0; durable-aware in v1 — `step.waitForEvent`-
shape interface is forward-compatible).

---

## ADR15 — Vitest + fast-check; tstyche for type-level tests (optional v0)

**Status:** Accepted (v0). Cascade specification from ADR1 (vanilla Vitest,
not `@effect/vitest`).

**Context:** Test framework choice determines DX, CI speed, and ecosystem
fit. Vitest is dominant for modern TS; Bun's built-in `bun test` is faster
but fragments ecosystem. fast-check is the property-based testing standard
(used by all Phase 1 references). tstyche provides type-level testing (used
by Effect-TS monorepo).

**Decision:** **Vitest + fast-check for all unit + property + integration
tests**. tstyche optional in v0 for type-level tests on critical generic
signatures (`Pipeline.from().through().to()` type-narrowing).

Concrete `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
    pool: 'threads',
    testTimeout: 10_000,
  },
});
```

Property test patterns (per outline §12) live in `tests/property/` mirroring
`src/` structure. Each adapter has matching `.spec.ts` (unit) + `.property.ts`
(property) tests.

Tooling: ruff equivalent in TS = ESLint or Biome — **Biome chosen** for v0
(ruff-style speed in TS land; one-tool lint+format). Type-check via
`tsc --noEmit`.

**Alternatives considered:**
- *Bun test.* Rejected — fragments tooling; Vitest's fast-check integration
  is more polished; CI runs Bun-native test for compatibility but Vitest is
  primary.
- *Jest.* Rejected — slower; older API; Vitest is the modern path.
- *@effect/vitest.* Rejected per ADR1 cascade.
- *ESLint primary.* Rejected for v0 — Biome's speed and one-tool ergonomics
  outweigh ESLint's plugin ecosystem for kit's narrow scope.

**Reference signal:** research-notes-cat-I.md source 2 (Effect-TS monorepo
uses tstyche). research-notes-cat-II.md source 13 (Gatewerk-sdk-ts uses
Vitest, 18 tests). research-notes-cat-VI.md source 33 (Zod tests with Vitest).

**Consequences:** Hard devDeps: `vitest`, `fast-check`, `@biomejs/biome`,
`typescript`. Optional: `tstyche` for v0 type-level tests on Pipeline
chainable API. CI runs `vitest run --coverage` + `tsc --noEmit` + `biome check`
+ optionally `bun test` for runtime compat. Coverage thresholds enforced in
CI; falls below = red build.

---

## ADR16 — Stripe-style API conventions: prefixed IDs, response envelope, factory client

**Status:** Accepted (v0).

**Context:** Naming and envelope conventions are hard to change post-v1
without breaking semver. Stripe's prefixed IDs + response envelope +
idempotency keys + cursor pagination + actionable errors are industry-canonical.
Gatewerk already adopted this; pipeline-kit inherits.

**Decision:** **Stripe-style + Gatewerk-conventions inherited verbatim.**

Prefixed IDs (per CLAUDE.md):
- `pk_pipe_<id>` — Pipeline definition.
- `pk_run_<ulid>` — Pipeline run instance.
- `pk_atom_<ulid>` — Atom (data unit at stage boundary).
- `pk_src_<id>` — Source adapter instance.
- `pk_proc_<id>` — Process adapter instance.
- `pk_serve_<id>` — Serve adapter instance.
- `pk_review_<id>` — Reviewable adapter instance.
- `pk_evt_<ulid>` — Webhook event ID (also serves as idempotency key).

Response envelope on every emitted resource:
```typescript
interface ResourceEnvelope {
  id: string;                     // pk_*_<id>
  object: string;                 // 'pipeline' | 'run' | 'atom' | ...
  created_at: string;             // ISO 8601 UTC
  metadata: Record<string, unknown>;  // user pass-through
  // resource-specific fields below
}
```

Factory client: `createPipelineKit({ apiKey?, url? })` (Supabase pattern;
ADR23 details resource methods). Env-var fallback: `PIPELINE_KIT_API_KEY`,
`PIPELINE_KIT_URL`.

Cursor-based pagination on list endpoints:
```typescript
interface ListResult<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: string;  // pass to subsequent request as starting_after
}
```

Actionable error envelope (Sentry/Stripe pattern, inherited from Gatewerk
catalog §1):
```typescript
interface ErrorEnvelope {
  type: string;                   // 'invalid_request' | 'auth' | 'rate_limited' | ...
  code: string;                   // specific code, e.g., 'pipeline_not_found'
  message: string;                // human-readable
  param?: string;                 // which field caused the error
  doc_url?: string;               // https://docs.pipelinekit.dev/errors/<code>
  request_id?: string;            // for support correlation; pk_run_<id> if applicable
}
```

ULID > UUID for time-orderable IDs (run, atom, evt). Plain alphanumeric for
definition IDs (pipe, src, proc, serve, review, key).

**Alternatives considered:**
- *Custom naming.* Rejected — Gatewerk family convention is established;
  cross-product DX consistency is load-bearing.
- *UUID for all IDs.* Rejected — ULID gives time-orderable + better debug
  ergonomics (see Stripe canon).

**Reference signal:** gatewerk/docs/research/ideas-to-steal.md §1, §2
(verbatim catalog). research-notes.md "Top 10 lift patterns" #1.

**Consequences:** ID generation utility ships in kit core (`pk.ids.run()`,
`pk.ids.atom()`, etc.). Resource envelope helper standardizes emission.
Error envelope is the only error shape allowed in Result<T, E>'s `error`
channel. Documented prefix list locks future resource additions to the same
naming scheme.

---

## ADR17 — Webhook signing: HMAC-SHA256 + 5-min tolerance + constant-time + multi-auth + SDK-bundled verify

**Status:** Accepted (v0).

**Context:** Webhook security requires HMAC-SHA256 + timestamp tolerance
(replay protection) + constant-time comparison (timing attack prevention).
Hatchet adds multi-auth flexibility (HMAC, Basic, Bearer, API Key).
Resend/Stripe SDKs bundle verification. Gatewerk-sdk-ts ships dual v1/v2
header transition pattern.

**Decision:** **HMAC-SHA256 + 5-minute timestamp tolerance + constant-time
comparison + multi-auth support + SDK-bundled verification.**

Verification API:
```typescript
// Inbound (webhook-source intake)
const event = pk.webhooks.verify(rawBody, signatureHeader, secret);
// returns Result<PipelineKitEvent, WebhookError>; PipelineKitEvent is
// discriminated union over event types

// Outbound (webhook-serve emission)
const signedHeader = pk.webhooks.sign(payload, secret, { timestamp?: Date });
// returns 'X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>' string  (Stripe canon per ADR21)
```

Multi-auth support (Hatchet pattern):
- Default: HMAC-SHA256 v2-style header.
- Alternative: Basic / Bearer / API Key — selected at adapter registration;
  documented per webhook-source/webhook-serve config.
- Constant-time comparison via `crypto.timingSafeEqual` (Node native).

Versioning: see ADR21 (locks v2 default + future migration policy).

**Alternatives considered:**
- *Bearer-only.* Rejected — no replay protection; not industry-standard for
  webhooks.
- *No SDK-bundled verify.* Rejected — every user re-implementing HMAC verify
  is the most common security bug class.
- *V1 hash-only as default.* Rejected per ADR21.

**Reference signal:** research-notes-cat-VII.md sources 38-42 (Hono + Stripe
+ Hatchet + CloudEvents + Resend). gatewerk/docs/research/ideas-to-steal.md
§3 (verbatim pattern catalog). research-notes.md "Top 10 lift patterns" #9.

**Consequences:** kit's `pk.webhooks.verify` and `pk.webhooks.sign` are
documented in §1 as part of `createPipelineKit()` SDK surface. Multi-auth
configuration documented per webhook-source / webhook-serve adapter spec
(§2). Constant-time comparison is mandatory; lint rule (Biome custom) flags
`===` against HMAC strings.

---

## ADR18 — `Audited<I,O>` wrapper writing to Gatewerk-shaped audit log; opt-in per stage

**Status:** Accepted (v0).

**Context:** Audit-as-compliance is a real value-add for regulated verticals
(HVAC EPA-cert, plumbing licensing, healthcare HIPAA). Gatewerk's
HMAC-signed audit log is the reference impl. The question is whether
pipeline-kit ships its own audit log or wraps any HMAC-signed audit
backend; and whether Audited is mandatory or opt-in.

**Decision:** **`Audited<I,O>` is an opt-in wrapper that writes
input/output pairs to a configurable audit backend.** Reference backend in
v0: Gatewerk audit log (via `GatewerkAuditAdapter`). Outline § 11 v1 lists
`audit-process` as a reference adapter; v0 ships the wrapper interface +
Gatewerk impl. Other backends (S3, Postgres-direct, syslog) implementable
in userland; kit ships `AuditAdapter` interface.

```typescript
interface AuditAdapter {
  emit(entry: AuditEntry): Promise<Result<void, AuditError>>;
}

interface AuditEntry {
  id: string;                     // pk_evt_<ulid>
  pipeline_id: string;
  run_id: string;
  stage_id: string;               // pk_src_/proc_/serve_<id>
  input: unknown;                 // structured; JSON-serializable
  output: unknown;                // structured; JSON-serializable
  decision?: ReviewResponse<unknown>;  // if Reviewable wrapped
  signature: string;              // HMAC-SHA256 of canonical(entry minus signature)
  created_at: string;
  metadata: Record<string, unknown>;
}

// Wrap any stage:
const auditedExtract = Audited(extractProcess, { backend: gatewerkAuditAdapter });
```

**Alternatives considered:**
- *Mandatory audit on every stage.* Rejected — performance + storage cost;
  most users don't need it.
- *Custom audit log impl in kit.* Rejected — Gatewerk already ships HMAC-signed
  audit; wrapping is cleaner and validates Gatewerk dogfood loop α.

**Reference signal:** research-notes-cat-V.md source 28 (Outbox pattern,
audit-table shape). research-notes-cat-IV.md sources 20-22 (Gatewerk's
`philosophy.md`, `blueprint.md`, `ideas-to-steal.md` catalog of audit
patterns). outline §8 milestone M2.

**Consequences:** v0 ships `Audited(stage, config)` wrapper + `AuditAdapter`
interface + `GatewerkAuditAdapter` reference impl. v1 ships `audit-process`
adapter (per outline §11 v1) for stand-alone audit-only Process stages.
Compliance-tier pricing (per OperatorOS pricing strategy) becomes available
when v0 wraps real customer-facing flows.

---

## ADR19 — `EditableField<T>` carries suggested + approved + wasEdited through pipeline

**Status:** Accepted (v0).

**Context:** When a Reviewable approves but edits an Atom, downstream Process
stages need to know what changed (for retraining, learning loops,
cross-pipeline feedback memory). Single-value Result<T, E> loses this
information. gotoHuman + Agent Inbox + Gatewerk converge on a pair-shape:
`suggested` + `approved` + `wasEdited` flag.

**Decision:** **`EditableField<T>` is a kit-shipped type carrying the edit
trace through the pipeline.**

```typescript
interface EditableField<T> {
  readonly suggested: T;
  readonly approved: T | null;
  readonly wasEdited: boolean;
}

const Field = {
  unedited<T>(value: T): EditableField<T>,    // approved = suggested, wasEdited = false
  edited<T>(suggested: T, approved: T): EditableField<T>,  // wasEdited = (suggested !== approved)
  rejected<T>(suggested: T): EditableField<T>,  // approved = null
};
```

Reviewable's `ReviewResponse<I>` of `decision: 'approved'` produces
`EditableField<T>` for any field marked editable in the Reviewable schema.
Property test (per outline §12):
- `Field.unedited(x).approved === x && wasEdited === false`.
- `Field.edited(s, a)` where `s !== a` → `wasEdited === true`.
- `Field.rejected(x).approved === null`.

Process<I, O> can match on `EditableField<T>.wasEdited` to gate learning
behavior (e.g., write to feedback memory only when wasEdited).

**Alternatives considered:**
- *Single-value `T | null`.* Rejected — loses edit signal; downstream Process
  can't distinguish "approved unchanged" from "approved with edits."
- *Diff-only (`Diff<T>`).* Rejected — over-engineered for v0; pair-shape is
  the simplest representation that preserves both suggested and approved.

**Reference signal:** research-notes-cat-IV.md sources 20-27 (gotoHuman +
Agent Inbox + Gatewerk converge on pair-shape).
gatewerk/docs/research/ideas-to-steal.md §5 (verbatim suggestedValue /
approvedValue pattern). research-notes.md "Top 5 ADR resolution candidates"
#19.

**Consequences:** Reviewable adapters that allow editing emit
`EditableField<T>` for editable Atom fields. Composer threads `EditableField<T>`
through downstream stages (preserves edit trace). Cross-pipeline feedback
memory (v1, per outline §8 M3) consumes edited fields as training signal.
TypeScript helper `Field.unedited/edited/rejected` documented in §1.

---

## ADR20 — Pursuit interop: MCP bridge with prefixed tools; apify-* > pgvector > demand-mining priority

**Status:** Accepted (v0).

**Context:** Pursuit's Python codebase has substantial investment in apify
adapters (with credentials), pgvector embeddings, and demand-mining SQL
views. Re-implementing in TypeScript would duplicate work and lose
operational maturity. The bridge needs to expose pursuit's adapters to
pipeline-kit while respecting the Python investment. Phase 1 brain Q8
locks priority order: apify-* catalog → pgvector embeddings → demand-mining
SQL views → other adapters defer.

**Decision:** **MCP bridge with no tool-name prefix convention; pursuit's
MCP server name acts as the namespace. pipeline-kit consumes via
`mcp-tool-source` adapter (v0 reference).**

Bridge interface design:
- **Pursuit-Python exposes MCP server** at known endpoint with bare tool
  names: `apify_run`, `apify_dataset`, `pgvector_search`, `pgvector_upsert`,
  `demand_views_*`. The MCP spec namespaces tools by server name implicitly
  (`<server>:<tool>` resolution at the protocol layer); explicit string
  prefixing inside the tool name itself would be double-namespacing — an
  anti-pattern not used by Anthropic's MCP catalog or Composio.
- **pipeline-kit's `mcp-tool-source` adapter** is generic — wraps any tool
  from any MCP server with auto-derived Zod schema from the MCP tool's
  input/output schema. No pursuit-specific knowledge in kit.
- **Version skew policy**: users pin pursuit-mcp version in their own
  package.json via standard npm semver range (e.g., `pursuit-mcp@^1.2.0`).
  Pursuit ships at its own velocity, independently versioned (industry
  standard for cross-package coordination — Drizzle dialects, LangChain
  integrations, every npm-ecosystem opt-in helper). Kit's adapter is
  version-agnostic.

v0 prioritized adapters (per Q8):
1. `apify-*` catalog (highest priority — credentials + actor catalog
   non-trivially-portable).
2. `pgvector` embeddings (high value; embedding model + index management
   non-trivially-portable).
3. Demand-mining SQL views (medium value; SQL is portable but pursuit's
   archetype-mapping config is the non-trivial bit).

Other pursuit adapters (extraction LLM, qualifier funnel) defer to v1+ on
demand-driven need.

**Alternatives considered:**
- *Direct TypeScript port of pursuit adapters.* Rejected — duplicates
  operational work; loses Python-side maintenance momentum; pursuit's data
  pipeline (Datasette + Supabase + Apify config) is not natively TypeScript
  shape.
- *gRPC / JSON-RPC bridge.* Rejected — MCP is pursuit's existing pattern (per
  outline §17 Q3); reusing avoids new infra.
- *No bridge (kit re-implements).* Rejected — wastes pursuit investment;
  doesn't align with co-evolution pattern in outline §10.

**Reference signal:** research-notes-cat-X.md source 52
(`pursuit/docs/strategy/essentials-kit.md` — pursuit's `tools/` folder maps
1:1 to pipeline-kit reference adapter list). research-notes.md MED-confidence
ADR20 + Q8 lock.

**Consequences:** v0 ships `mcp-tool-source` as a generic MCP-tool wrapper;
no pursuit-specific code in kit core. Pursuit-side ships `pursuit-mcp`
package on its own velocity; users pin via standard npm semver. Bridge is
bidirectional in spirit but v0 only flows pursuit → pipeline-kit; v1+ may
add pipeline-kit → pursuit (e.g., Reviewable propagating to pursuit's
Stage-2 `/prep` flow per outline §10). v1 `pursuit-demand-source` adapter
(outline §11 v1) wraps pursuit-mcp's demand-mining tools with kit-side
caching as an optional convenience layer.

---

## ADR21 — Webhook signature versioning policy: v2 default, deprecation policy locked

**Status:** Accepted (v0). NEW v0 ADR (Phase 1 candidate A).

**Context:** Phase 1 surfaced (Cat-VII + Cat-II + Gatewerk-sdk-ts) that
real-world webhook signing migrations require dual-header transition windows
+ explicit deprecation policy. Gatewerk runs v1 (legacy hash-only) + v2
(replay-safe `t=...,v1=...`) headers concurrently during a transition window.
pipeline-kit is greenfield (no legacy users) but must lock policy now to
prevent v1.x breakage when v3 inevitably ships.

**Decision:** **Single signature header following Stripe canon: algorithm
version inside header value, not header name.**

Header format:
```
X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>      # v0 default
X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>,v2=<hex>   # transition window
X-Pipeline-Kit-Signature: t=<unix>,v2=<hex>      # post-deprecation
```

The `v1=` / `v2=` fragment is the *signature algorithm* version. The header
name is stable across the kit's lifetime; algorithm migrations bump the
inner version. This matches Stripe's `Stripe-Signature: t=<unix>,v1=<hex>`
canon (industry-dominant since 2017) and Slack's `X-Slack-Signature: v0=<hex>`
pattern. No header-name versioning (rejected — confused header-version with
algorithm-version, fights consumer parsing).

**Migration policy (locked for the kit's lifetime):**
1. **Producer-side**: when a new algorithm version (v2+) lands, producers
   emit BOTH versions in the same header for at least 12 months (Stripe's
   actual transition pattern). Comma-separated key=value pairs allow any
   number of concurrent algorithm versions.
2. **Consumer-side**: kit's `pk.webhooks.verify()` accepts ANY valid version
   present; prefers the highest algorithm version. Older versions are
   rejected only after their deprecation window closes.
3. **Deprecation timeline**: minimum 12 months from new-version GA; clear
   warnings logged via OTel for the previous 6 months; hard removal after
   timeline closes.
4. **Versioning trigger**: a new algorithm version is authored when (a)
   cryptographic primitive must change (e.g., SHA-256 → SHA-3), (b) replay
   protection scheme changes (e.g., add nonce field), or (c) header
   key-value structure needs new fields. Cosmetic changes do NOT trigger
   a new version.

**Alternatives considered:**
- *Ship v1 (hash-only) for backward compat with hypothetical legacy users.*
  Rejected — kit is greenfield; no legacy debt; v2 default avoids known
  replay-attack surface.
- *No formal versioning policy (cross that bridge later).* Rejected —
  documenting now is cheap; surprise migrations are expensive.
- *Single-header-forever (avoid version churn).* Rejected — crypto evolves
  on decade timescales; locking out future migration creates long-tail risk.

**Reference signal:** research-notes-cat-VII.md source 40 (Stripe webhook
canon — `Stripe-Signature: t=<unix>,v1=<hex>` since 2017, dominant industry
pattern). research-notes-cat-II.md source 13 (Gatewerk-sdk-ts; family adopts
same pattern). Slack's `X-Slack-Signature: v0=<hex>` independently confirms
algorithm-version-inside-header-value as canonical. GitHub's
`X-Hub-Signature-256` uses different scheme (per-algorithm header) but is
narrower-scoped; Stripe canon dominates greenfield kit conventions.

**Consequences:** kit's webhook adapters (webhook-source intake +
webhook-serve outbound) emit single `X-Pipeline-Kit-Signature` header with
algorithm version in value. Documentation locks 12-month dual-emission window
for future migrations; deprecation warnings emitted via OTel logs (per ADR8).
Future v2 algorithm ships as additive change (no breaking change to existing
v0 v1 users) until deprecation window closes. SDK methods `pk.webhooks.sign`
and `pk.webhooks.verify` accept `version` option for explicit selection;
default emits highest available algorithm version.

---

## ADR22 — Composer ownership = LIBRARY (not durable runtime); user owns durability

**Status:** Accepted (v0). NEW v0 ADR (Phase 1 candidate B).

**Context:** Phase 1 brain locked (Q1 in research-notes.md "Brain
adjudication"): pipeline-kit is library called BY user's durable function,
NOT a durable runtime. This is load-bearing for kit's positioning beneath the
workflow engine + ADR3's deferral of durable execution to v1. The decision
needs to be a first-class ADR (not just a synthesis open question) because it
constrains every other ADR's runtime assumptions.

**Decision:** **Composer is a library. The user's host program owns the
durability boundary** (be it a sync caller, a cron job, an Inngest function,
a Trigger.dev task, a Temporal Activity, or a custom durable function). kit's
Composer.run() is a synchronous-async function the user calls inside their
durability boundary.

Concrete implications:
- **No durable infra ships in kit core**: no event queue, no checkpointer,
  no scheduler, no dead-letter, no replay engine. Pure helper utilities
  (Result, retry wrapper, token-bucket, ID generation, OTel hooks) are fine
  — they're stateless or per-process-ephemeral. Stateful durable
  infrastructure stays out.
- **Composer.run(input, options) signature is sync from kit's perspective**:
  returns `Promise<Result<RunResult<O>, RunError>>`. User's caller decides
  what to do with the result — including persisting state, scheduling next
  run, fanning out events. kit doesn't.
- **Cancellation via AbortSignal**: `RunOptions.signal: AbortSignal` (per
  ADR12) is the only cancellation primitive. Web Standards canon (fetch,
  ReadableStream, Node 16+ stable AbortSignal). User's host signals abort;
  kit propagates to all in-flight stages.
- **Idempotency keys flow through Composer** (per ADR9): kit auto-generates
  if not provided; user can override for cross-call dedup. **Idempotency
  cache storage is per-Serve-adapter responsibility**, not kit-core
  (industry standard: Stripe SDK + Knock SDK don't ship local idempotency
  caches; server-side dedup is the canonical pattern). Serve adapters that
  need persistence wire a Store adapter as their cache backing; kit core
  only propagates keys.
- **Stage-boundary-only resume granularity** (per Phase 1 Q2): if a stage
  fails mid-execution, kit reports failure to caller; caller decides retry
  semantics (within kit's retry policy, ADR13). No intra-stage interrupt;
  no LangGraph-style checkpoint inside Process functions.
- **v1 reference integration: opt-in `@idriszade/composer-inngest`
  package** (~30-line thin wrapper). Industry standard for cross-package
  integrations is opt-in helper packages, not docs-only patterns: Drizzle
  ships per-provider packages (`drizzle-orm/postgres`, `drizzle-orm/bun-sqlite`,
  `drizzle-orm/d1`, etc.); LangChain ships per-integration packages. Kit
  ships a thin Inngest helper exporting `inngestPipeline(pipeline, options)`
  that wraps `pipeline.run()` inside `step.run()` with idiomatic Inngest
  retry/idempotency config. Trigger.dev gets `@idriszade/composer-trigger`
  in v1 too. Users can still bypass and write their own; the helper just
  ships the canonical pattern.

**Alternatives considered:**
- *Composer as durable runtime.* Rejected — months of infra work; kit grows
  into a workflow engine, fights its positioning beneath workflow engines.
- *Composer with optional durable mode.* Rejected — split complexity
  surface; users get half-and-half durability that's hard to reason about.
- *Composer as Inngest plugin only.* Rejected — locks kit to Inngest;
  pursuit's pursuit-Python lives outside Inngest; OperatorOS may use
  Trigger.dev or self-hosted Hatchet.

**Reference signal:** research-notes.md "Brain adjudication" Q1 lock.
research-notes-cat-I.md synthesis open question 1 ("library called BY user's
durable function"). outline §1 ("not a runtime; not a framework").

**Consequences:** kit's package size + dep count stays minimal (no event
infra); v0 ships with `p-retry`, `zod`, `drizzle-orm`, OTel peerDeps, and
adapter-specific deps only. v1 ships opt-in `@idriszade/composer-inngest`
+ `@idriszade/composer-trigger` thin wrapper packages (industry-standard
integration-package pattern), each with peerDep on the target durable
runtime. v2 may add a `pipeline-kit-cloud` companion product (separate
package) that hosts Composer for users who don't want to run their own —
but that's a hosted-product concern, not kit-core. ADR3 + ADR22 together
lock the positioning: kit ships sync + library; durability is user-owned.

---

## ADR23 — SDK resource taxonomy: 4 resources (`pipelines`, `runs`, `atoms`, `webhooks`)

**Status:** Accepted (v0). NEW v0 ADR (Phase 1 candidate E).

**Context:** Phase 1 surfaced (Cat-II synthesis Q1) that Gatewerk-sdk-ts has
8 resources (`reviews`, `templates`, `feedback`, `audit`, `stats`, `chains`,
`notes`, `webhooks`); pipeline-kit's resources are different. Naming locks
early; renaming is breaking change. The candidate set: pipelines, runs,
atoms, adapters (or `sources`/`stores`/`processes`/`serves` separately),
webhooks.

**Decision:** **4 resources, mounted on the SDK client returned from
`createPipelineKit()`:**

```typescript
const pk = createPipelineKit({ apiKey, url });

// Resources:
pk.pipelines  // CRUD on pipeline definitions
pk.runs       // start/get/list/cancel pipeline run instances
pk.atoms      // get/list atoms emitted across runs
pk.webhooks   // verify/sign helpers (no CRUD; just utilities)
```

Per-resource methods (representative; full surface in §1):

```typescript
pk.pipelines.create(input): Promise<Result<Pipeline, ApiError>>
pk.pipelines.get(id): Promise<Result<Pipeline, ApiError>>
pk.pipelines.list(filters): Promise<Result<ListResult<Pipeline>, ApiError>>
pk.pipelines.delete(id): Promise<Result<void, ApiError>>

pk.runs.start(pipelineId, input, options): Promise<Result<RunResult<O>, RunError>>
pk.runs.get(runId): Promise<Result<RunDetail, ApiError>>
pk.runs.list(filters): Promise<Result<ListResult<RunSummary>, ApiError>>
pk.runs.cancel(runId): Promise<Result<void, ApiError>>

pk.atoms.get(atomId): Promise<Result<Atom<unknown>, ApiError>>
pk.atoms.list(runId, filters): Promise<Result<ListResult<Atom<unknown>>, ApiError>>

pk.webhooks.verify(rawBody, sigHeader, secret): Result<PipelineKitEvent, WebhookError>
pk.webhooks.sign(payload, secret, options?): string
```

**Adapter registration is construction-time, not a runtime resource.** v0
users register adapters via stage factory functions (e.g., `createApiSource(config)`)
and pass instances to `Pipeline.from(source)` — industry standard across
typed-primitive libraries (Drizzle dialects, tRPC procedures, Inngest
functions, Pydantic AI agents all configure adapters at construction time,
not via runtime SDK). A `pk.adapters` resource was considered for v0 but
deferred to v1 — no marketplace or dynamic-registration use case in v0
warrants the surface.

**Alternatives considered:**
- *5 resources including `pk.adapters` (runtime adapter registration).*
  Rejected for v0 — industry standard is construction-time configuration;
  Drizzle/tRPC/Inngest/Pydantic AI all do it this way. v1 may add `pk.adapters`
  if marketplace or dynamic registration emerges.
- *Separate `pk.sources`, `pk.stores`, `pk.processes`, `pk.serves`.* Rejected —
  4 nearly-identical method shapes for stage variants; redundant surface.
- *3 resources (drop `atoms`).* Rejected — atoms are the per-stage data unit;
  observability + replay needs first-class atom access.
- *Effects-style Layer DI instead of resource-based client.* Rejected per ADR1.
- *6+ resources adding `reviewables`, `audit`, etc.* Rejected — these are
  primitives accessed via the Reviewable/Audited adapter APIs, not top-level
  SDK resources. Flat resource surface keeps API ergonomic.

**Reference signal:** research-notes-cat-II.md source 13
(Gatewerk-sdk-ts 8 resources as canonical local reference; pipeline-kit
adapts to its own domain). Cat-II synthesis Q1. Industry construction-time
adapter pattern: Drizzle ORM, tRPC, Inngest, Pydantic AI.

**Consequences:** v0 SDK exports 4 resource namespaces; each ships
per-resource typed input/output (`CreateRunInput`, `RunDetail`, etc.). v1
may add nested resources (e.g., `pk.pipelines.runs(pipelineId).list()`) and
`pk.adapters` for dynamic registration without breaking flat resource
surface. Locked names: `pipelines`, `runs`, `atoms`, `webhooks` — renaming
is breaking; future additions are net-new resources.

---

## Phase 2 spec drilldowns

The remaining content of the v0 spec lives in three sibling files (split per
the brain-discipline ceiling of < 500 lines per file; the consolidated v0 spec
exceeded 1500 lines). Read in this order:

| # | File | Contents | Anchors back to |
|---:|---|---|---|
| 1 | [spec-api-surface.md](spec-api-surface.md) | §1 — `createPipelineKit()` factory (4 resources: `pipelines`/`runs`/`atoms`/`webhooks`), `Result<T,E>`, stage interfaces (Source/Store/Process/Serve), `Atom<T>`, `PipelineContext`, `Pipeline.from(...).through(...).to(...)` chainable shape with `.review()` sugar over `reviewable-wrapper`, `Reviewable<I>`, `EditableField<T>`, `Audited<I,O>`, webhook helpers (single-header Stripe-canon signature format), error envelope | ADR4, ADR5, ADR12, ADR14, ADR16, ADR17, ADR18, ADR19, ADR21, ADR23 |
| 2 | [spec-adapters.md](spec-adapters.md) | §2 — 16 v0 reference adapters: 4 Source (api / webhook / apify / mcp-tool), 3 Store (postgres / sqlite / pgvector), 5 Process (extract / classify / validate / route / reviewable-wrapper), 4 Serve (email / slack / webhook / mcp-tool); package names + config shapes + dependencies | ADR2, ADR6, ADR7, ADR9, ADR11, ADR14, ADR17, ADR20, ADR21 |
| 3 | [spec-build-plan.md](spec-build-plan.md) | §3 Test plan (Vitest + fast-check + tstyche; 250+ tests; 10 property-based invariants; PIV Loop 5-layer pyramid) + §4 Roadmap (M0-M5; portfolio sequencing) + §5 Deferred (ADR-C, ADR-D, ArkType escape hatch, Saga, Effect re-eval, Phase 3 executor notes) | ADR3, ADR15, ADR22, ADR1 trigger |

Phase 3 (v0 build) begins with these four files as its sole architectural
input. Brain reviews executor PRs against this spec; deviations require an
ADR amendment before merge.

---

*End of Phase 2 spec entry doc. 23 ADRs locked + drilldowns reference for
API surface, adapter list, test plan, roadmap, deferred questions.*

*Author: Brain — 2026-05-06.*
*Phase 1 input: research-notes.md (synthesis) + research-outline.md +
gatewerk/docs/research/ideas-to-steal.md.*
*Phase 3 v0 build queues from this spec + drilldowns.*
