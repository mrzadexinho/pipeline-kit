> Phase 1 research notes — Category I (Architecture references). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category I — Architecture references

Why SECOND: durable execution patterns inform ADR1 (Effect.ts), ADR3 (sync vs durable), ADR5 (state/context), ADR9 (idempotency), ADR10 (backpressure), ADR12 (composition syntax), ADR13 (retry).

### 1. Effect.ts docs — https://effect.website
- **Purpose:** TypeScript runtime + standard library — type-safe effect system, structured concurrency, Layer-based DI, full standard library JS lacks. Positions itself as the way to "build production-ready applications in TypeScript."
- **Core abstractions (verbatim):**
  - `Effect<A, E, R>` — primary computation primitive: success channel `A`, typed error channel `E`, dependency channel `R`.
  - `Layer<RIn, E, ROut>` — DI primitive; composes service/configuration wiring.
  - `Context.Tag<T>` — environment carrier; resolves dependencies via Layer.
  - `Schema` — data validation + serialization with type alignment (alternative to Zod).
  - `Stream` — async iteration with backpressure (alternative to AsyncIterable).
  - `Fiber` — lightweight concurrency unit; deterministic cancellation.
  - `Scope` — resource lifecycle; cleanup on exit.
  - `Schedule` — retry/repetition policies (exponential backoff, jitter, etc).
  - `Cause`, `Exit`, `Either`, `Option` — structured error/result types.
- **API surface (representative):**
  ```typescript
  // Effect.gen for imperative-style composition
  const getTodo = (id: number): Effect.Effect<Todo, HttpError, HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient;
      const response = yield* client.get(`/todos/${id}`);
      return yield* response.json;
    });

  // Layer DI
  const HttpClientLive = Layer.succeed(HttpClient, makeClient());

  // Schema
  const Todo = Schema.Struct({ id: Schema.Number, title: Schema.String });

  // Stream
  Stream.fromIterable([1, 2, 3]).pipe(Stream.map(x => x * 2));

  // Run
  Effect.runPromise(program.pipe(Effect.provide(HttpClientLive)));
  ```
- **What to lift:**
  - **Layer DI pattern** as architectural reference for **ADR5** state/context — Layer.succeed/Layer.effect/Layer.merge for composition. **Vanilla TS v0 doesn't need to adopt Layer literally; can use simple constructor injection that *resembles* Layer's compositional shape.**
  - **Schedule** for retry policies → **ADR13** reference: exponential backoff + jitter as default; userland can override.
  - **Cause** for actionable errors → **ADR4 + ADR16** reinforcement: errors carry structured context (not just messages).
  - **Schema** as alternative to Zod for **ADR6** — outline locked Zod; document Schema as ADR1-cascading alternative.
  - **Effect.gen + yield\*** — readable async composition. Userland pattern; not a kit primitive.
- **What to avoid:**
  - All-or-nothing adoption. Learning curve real ("similar to learning TypeScript"); team unfamiliar with FP will pay productivity tax.
  - Bundle size scales with usage. Core ~15KB but quickly grows when pulling Layer/Stream/Schema/Schedule.
  - Don't backfill Effect into v0 just because individual primitives are attractive — **ADR1 cascade** means adopting Effect changes ADR3 (use @effect/workflow), ADR8 (@effect/opentelemetry), ADR11 (@effect/sql-drizzle), ADR15 (@effect/vitest). Either commit or stay vanilla.
- **Stated non-goals:** Doesn't position as a workflow engine, but the monorepo ships `@effect/workflow` as a separate package (see source 2). Doesn't position as an HTTP framework, but `@effect/platform` covers HTTP servers.
- **License + community:** MIT. ~8.5k stars on Effect-TS/effect. 2k+ Discord members. Production adoption (Vercel, PolyCam testimonials). Mature core; clustering/workflows still alpha.

### 2. Effect-TS/effect repo — `Effect-TS/effect` (monorepo, 32+ packages)
- **Purpose:** Source of the Effect ecosystem. **Critical insight: adopting Effect cascades through every other ADR because Effect ships cohesive packages for durable workflow, SQL/ORM, OpenTelemetry, RPC, vitest integration.**
- **Core packages (selected, relevant to pipeline-kit ADRs):**
  - `effect` — core (Effect, Layer, Context, Schema, Stream, Fiber, Schedule).
  - `@effect/workflow` — **durable workflows for Effect.** Direct ADR3 alternative.
  - `@effect/sql` + `@effect/sql-drizzle` + `@effect/sql-pg` + `@effect/sql-sqlite-bun` etc. — **ADR11 alignment** (Drizzle interop available out of the box).
  - `@effect/opentelemetry` — **ADR8 alignment** (OTel native).
  - `@effect/rpc` — RPC primitives (relevant for cross-process Composer adapters in v2).
  - `@effect/cluster` — distributed compute (alpha; possibly v2 reference).
  - `@effect/platform` + `-node` / `-bun` / `-browser` — cross-runtime support (ADR runtime targets: Node 20+, Bun-tested CI per CLAUDE.md).
  - `@effect/vitest` — **ADR15 alignment**.
  - `@effect/ai`, `@effect/ai-anthropic`, `@effect/ai-openai`, `@effect/ai-google`, `@effect/ai-amazon-bedrock` — LLM provider abstractions (relevant for `extract-process` v0 adapter).
- **API surface:** see source 1.
- **What to lift:**
  - **`@effect/workflow`** → ADR3 v1 alternatives list — alongside Inngest, Trigger.dev, Hatchet. Especially compelling IF Effect adopted (ADR1).
  - **`@effect/sql-drizzle`** → ADR11 confirmation that Drizzle is the right ORM choice. If Effect adopted, the bridge is free.
  - **`@effect/opentelemetry`** → ADR8 confirmation; OTel-native.
  - **`@effect/ai-*`** → reference for `extract-process` LLM adapter design (provider-pluggable).
- **What to avoid:**
  - Don't pull Effect's whole ecosystem incrementally if not committing to Effect. Mixing vanilla + Effect packages creates wrapper hell.
  - Don't conflate "Effect ecosystem exists" with "must adopt Effect" — vanilla TS pipeline-kit can still cite Effect's package list as architectural reference.
- **Stated non-goals:** Not a workflow engine; not a scheduler; not an HTTP framework — but ships packages for all three. The monorepo strategy is "if it composes with Effect, it lives here."
- **License + community:** MIT. ~8.5k stars (parent), individual packages have npm install activity. pnpm@10.4.0 monorepo. tstyche for type-level testing — pattern worth noting for ADR15 alignment.

### 3. Inngest — https://www.inngest.com/docs
- **Purpose:** Event-driven durable execution platform for TypeScript/JavaScript. Background jobs, scheduled tasks, workflow orchestration "without managing queues, infra, or state." Cloud + open-source self-host.
- **Core abstractions (verbatim):**
  - `Function` — unit of work registered via `inngest.createFunction`.
  - `Step` — durable, retriable boundary inside a function.
  - `Event` — trigger payload; functions match on event names.
  - `Trigger` — `event: "..."` | `cron: "..."` | webhook configurations.
  - **Flow control config:** `concurrency`, `throttle`, `rateLimit`, `batchEvents`, `idempotency`, `priority`, `cancelOn`, `debounce`.
  - **Step methods:** `step.run`, `step.sleep`, `step.sleepUntil`, `step.waitForEvent`, `step.invoke`, `step.sendEvent`.
- **API surface (canonical):**
  ```typescript
  inngest.createFunction(
    {
      id: "sync-systems",
      idempotency: "{{ event.data.userId }}",
      throttle: { limit: 3, period: "1min" },
      retries: 3,
    },
    { event: "auto/sync.request" },
    async ({ event, step }) => {
      const data = await step.run("get-data", async () => fetchExternal());
      await step.sleep("debounce", "10s");
      const decision = await step.waitForEvent("user-decision", {
        event: "user/approval",
        match: "data.requestId",
        timeout: "1h",
      });
      return await step.run("apply", async () => apply(data, decision));
    }
  );
  ```
- **Durability model:** **`step.run` is the durable boundary.** On retry/restart, completed steps are memoized via Inngest's persistent state and re-skipped; only the failing/in-progress step executes. Function code re-executes top-to-bottom but completed steps return cached results.
- **Idempotency:** function-level template (`idempotency: "{{ event.data.userId }}"`) deduplicates within a window. Event-level deduplication via event ID. Both exist; complementary.
- **Retry:** default 3 retries with exponential backoff. Throw `NonRetriableError` to short-circuit. Per-step retry policy override available.
- **What to lift:**
  - **Step-as-durable-boundary** → pipeline-kit's stage IS the durable boundary in v1 ADR3. Each Source/Process/Serve invocation is conceptually a step. **HIGH confidence**.
  - **Idempotency at function + event level** → **ADR9**. pipeline-kit Serve adapters that mutate must accept idempotency key (function-level, e.g., `pk_run_id`) AND deduplicate by Atom ID (event-level).
  - **`step.waitForEvent`** as resume primitive → backs `Reviewable<I>` async impl in v1 durable adapter. Reviewer decision is the awaited event.
  - **Flow-control config block** (concurrency/throttle/rateLimit/batchEvents) → **ADR10** — pipeline-kit Composer accepts per-stage flow-control config in same shape.
  - **`NonRetriableError` pattern** → ADR4 reinforcement: TypeScript discriminated-union errors carry retry semantics.
- **What to avoid:**
  - Inngest's event-broadcast model is heavier than pipeline-kit's stage-pipeline model. Don't lift the global event bus assumption — pipeline-kit stages are explicitly wired by the Composer, not implicitly matched by event name.
  - Don't make `Function` (Inngest's name) collide with pipeline-kit's `Process` — keep nomenclature distinct.
- **Stated non-goals:** not a chat agent runtime; not an HTTP server framework; not a scheduler standalone (but offers cron triggers).
- **License + community:** Open core (Inngest server SDK Apache 2.0); managed cloud at app.inngest.com. ~3k+ stars; YC-backed; TypeScript-first.

### 4. Trigger.dev — https://trigger.dev/docs
- **Purpose:** Open-source background jobs framework for TypeScript. Long-running AI tasks, complex jobs, agent orchestration with built-in queuing, retries, elastic scaling. Self-host or Trigger.dev Cloud.
- **Core abstractions (verbatim):**
  - `Task` — discrete async function with built-in observability; "the core of Trigger.dev."
  - `Run` — instance of task execution; trackable by ID.
  - `Trigger` — invocation mechanism: code-side, schedule, event.
  - `Schedules` — cron-based scheduled tasks.
  - `Wait` — pause primitives (`wait.for`, `wait.until`).
  - `Concurrency & Queues` — per-task concurrency limits, FIFO queues.
  - `Retries` — auto error recovery, configurable policies.
  - `Realtime API` — event-driven task status subscription.
  - `MachinePresets` — compute-tier selection per task.
  - `ctx` — execution context (run ID, attempt, machine, etc).
- **API surface (representative pattern):**
  ```typescript
  // Define
  export const sendEmail = task({
    id: "send-email",
    retry: { maxAttempts: 3 },
    machine: { preset: "small-1x" },
    run: async (payload: { to: string }, { ctx }) => {
      await wait.for({ seconds: 5 });
      // ... email send logic
    },
  });

  // Trigger from app
  await sendEmail.trigger({ to: "user@example.com" });

  // Schedule
  schedules.task({ id: "daily", cron: "0 9 * * *", run: async () => {/*...*/} });
  ```
- **Durability:** Tasks run on Trigger.dev infrastructure (Cloud or self-hosted). "No timeouts, elastic scaling." State persists; restarts use retry policy. Run-level visibility into execution state.
- **What to lift:**
  - **Task / Run separation** → pipeline-kit's `Pipeline` (definition) / `PipelineRun` (instance) maps cleanly. Aligns with **ADR16** prefixed IDs (`pk_pipe_` definition vs `pk_run_` instance).
  - **`wait.for` / `wait.until` durable primitives** → **ADR14** Reviewable<I> with timeout in v1 durable adapter (any of Inngest's `waitForEvent` / Trigger.dev's `wait.for` / Temporal's `condition` could back the async impl).
  - **`MachinePresets`** as a compute-tier abstraction → reference for v2 if pipeline-kit ever exposes resource hints; not v0.
  - **Realtime API + React hooks** → reference for **ADR8** observability surface (run-status emission). Userland integration; not a kit primitive.
- **What to avoid:**
  - Trigger.dev's frontend-React-hook bias is product-shaped; pipeline-kit is a library, not a full-stack framework. Don't lift their UI integration.
- **Stated non-goals:** Not positioned against Temporal-class durable systems for ultra-heavyweight workflows; deliberately TypeScript-only.
- **License + community:** Apache 2.0 (v3). ~10k+ stars. Active OSS + commercial cloud. Strong AI-task positioning (LLM-friendly).

### 5. Hatchet — https://docs.hatchet.run
- **Purpose:** Distributed task queue + durable workflow engine. Multi-language SDKs (Python, TypeScript, Go, Ruby). Mission-critical AI agents, durable workflows, background tasks.
- **Core abstractions (verbatim):**
  - `Task` — fundamental unit of work wrapping a function.
  - `Worker` — long-running process polling task queues.
  - `Workflow` (durable) — composes multiple tasks with dependencies, retries, checkpointing.
  - `Event` — triggers workflows + inter-service comm.
  - `ScheduledRuns` / `CronRuns` — time-based invocation.
  - `Concurrency` — worker-level slot control + fairness.
  - `RateLimit` — flow control for ingestion.
  - `Priority` — task prioritization across parallel execution.
  - `RetryPolicy` — configurable per-task.
  - `Timeouts` — execution-time boundaries per task.
- **API surface:** Decorator-style task registration + worker registration; multi-language SDKs (Python/TS/Go/Ruby) share concepts. Exact TS signatures not in docs landing — would require deeper fetch for verbatim.
- **Durability model:** "every task and agent invocation persisted in Hatchet's durable event log, allowing for debugging, retries and replays." Long-running agents "automatically checkpoint their current state and pick up where they left off."
- **What to lift:**
  - **Multi-language SDK pattern** → relevant if pipeline-kit ever ships Python alongside TS later. **ADR20** says TS-primary + MCP bridge for pursuit; don't replicate Hatchet's polyglot story unless real demand.
  - **Webhook security** (per Gatewerk's `ideas-to-steal.md` §3 — Hatchet-sourced): multi-auth (Basic / API Key / HMAC), encrypted secrets at rest, constant-time HMAC. Confirms **ADR17**.
  - **Priority + RateLimit + Concurrency at workflow level** → confirms **ADR10** + **ADR13**.
  - **Durable event log** as audit substrate → conceptually similar to **ADR18** `Audited<I,O>` wrapper writing to Gatewerk audit log. Hatchet's event log is per-task; pipeline-kit's is per-pipeline-run.
- **What to avoid:**
  - Hatchet's surface includes infra (dashboard, deployment, multi-tenant cloud). pipeline-kit doesn't replicate infra.
  - Don't lift Hatchet's polyglot SDK story — keeping TS-only reduces complexity surface for v0 (CLAUDE.md alignment).
- **Stated non-goals:** Not stated explicitly.
- **License + community:** 100% MIT. ~4k+ stars. >10k OSS deployments/month claimed. GitHub + Discord active.

### 6. Temporal SDK — https://docs.temporal.io/develop/typescript
- **Purpose:** Heavyweight workflow durability platform; event-sourced replay, deterministic workflows, isolated activities. Used at Netflix, Stripe, Snap. Reference for **patterns**, not adoption.
- **Core abstractions (verbatim):**
  - `Workflow` — deterministic orchestration logic; defines business process.
  - `Activity` — isolated, non-deterministic work unit (API calls, DB ops); executed independently.
  - `Worker` — polls task queues, executes Workflows + Activities.
  - `Signal` — async fire-and-forget message to running workflow.
  - `Query` — sync read-only inspection of workflow state.
  - `Update` — sync request with confirmable response (mutate + ack).
  - `ChildWorkflow` — nested invocation with independent lifecycle.
  - `ContinueAsNew` — restart workflow with new input, no history accumulation.
  - `Heartbeat` — activity progress signal for graceful timeout/cancellation.
  - `Schedule` — temporal trigger primitive.
  - `Saga` — compensation pattern (documented; not a primitive name).
- **API surface (TypeScript, representative):**
  ```typescript
  // Workflow
  export async function paymentWorkflow(req: PaymentRequest): Promise<PaymentResult> {
    const activities = proxyActivities<typeof activityImpl>({
      startToCloseTimeout: '5m',
      retry: { maximumAttempts: 3 },
    });

    let resumeReceived = false;
    setHandler(resumeSignal, () => { resumeReceived = true; });

    setHandler(getStatusQuery, () => currentStatus);

    await activities.charge(req);
    await condition(() => resumeReceived, '10m');
    return await activities.confirm(req);
  }

  // Outside: client.workflow.signal(workflowId, resumeSignal);
  ```
- **Durability model:** Event sourcing with deterministic replay. Workflow re-executes from event history on recovery. Workflows MUST be deterministic (no `Math.random`, no direct I/O, no unbounded concurrency). All side effects routed through Activities. Activities are isolated retryable units.
- **Signal / Query / Update distinction:**
  - Signal — async, fire-and-forget, no return.
  - Query — sync, read-only, returns state.
  - Update — sync, mutating, returns ack.
- **What to lift:**
  - **Workflow vs Activity separation** → maps to pipeline-kit's "functional core, imperative shell" CLAUDE.md style rule. Pure Process functions = Workflow-like; side-effecting Source/Serve = Activity-like. Conceptual confirmation; not a new ADR.
  - **Signal as resume mechanism** → directly maps to **ADR14** `Reviewable<I>` resume semantics. External Signal = reviewer decision; running Pipeline awaits via callback / event.
  - **Saga (compensation) pattern** → relevant for **ADR3** + Serve adapter design when v1 durable adapter spans multiple external systems. Outline already lists Saga in §11 v2 candidates.
  - **Schedule** primitive → cron-like trigger for Source. Outline §11 says Source v0 is pull-by-call; Schedule deferred to v2 (ADR2 confirms pull semantic).
- **What to avoid:**
  - **Deterministic-workflow constraint is heavy.** pipeline-kit MUST NOT enforce determinism on Process functions — userland will reject. Use Temporal patterns conceptually, not literally.
  - Don't adopt event-sourced replay for v0. Massive infrastructure cost; out of scope for a library.
  - Don't replicate `proxyActivities` injection at the v0 layer; it's a Temporal-runtime construct.
- **Stated non-goals:** Doesn't explicitly state, but emphasizes "deterministic workflow constraints" and isolated nondeterminism, implying unsuitable for low-latency event-driven systems with unbounded nondeterminism.
- **License + community:** MIT (TypeScript SDK). Production at Netflix, Stripe, Snap. Considered the gold standard for durable workflow primitives.

### 7. Cole Medin "Principles of Agentic Engineering" — `coleam00/ai-transformation-workshop`
- **Purpose:** Methodology + reference workshop materials for AI-first software development. Frames the AI Layer concept (CLAUDE.md + on-demand context + commands/skills as a portable second codebase), the PIV Loop (Plan/Implement/Validate), and 5 Golden Rules. **Not a runtime architecture — a project-development methodology.**
- **Core abstractions:**
  - **AI Layer** — code + AI-context (CLAUDE.md global rules / on-demand reference docs / commands & skills) checked into source control alongside code. AI improvements work like code improvements — PR'd, reviewed, evolved.
  - **PIV Loop** — `Plan` (`/prime` loads context + `/plan` produces structured plan with validation strategy *before code*); `Implement` (context reset, `/implement` in fresh window); `Validate` (5-layer pyramid).
  - **5-layer validation pyramid:** Layer 1 typecheck/lint (agent), Layer 2 unit tests (agent), Layer 3 integration/E2E (agent + browser automation), Layer 4 code review (human + AI assist), Layer 5 manual testing (human golden-path + edge cases). **Goal: push the line between L3 and L4 as far down as possible.**
  - **5 Golden Rules:** (1) Commandify everything (typed something twice → make it a command); (2) Reduce assumptions (questions → PRD → Jira → plan → execute, never skip checkpoints); (3) Context is king (reset between Plan and Implement; sub-agents for research only); (4) Git log is memory (commit frequently + descriptively); (5) System evolution (every bug → improve the AI layer so it never happens again).
- **API surface (commands shipped, not relevant to pipeline-kit runtime):** `/prime`, `/plan`, `/implement`, `/validate`, `/review`, `/security-review`, `/create-prd`, `/create-stories`, etc.
- **What to lift:**
  - **AI Layer mindset** → pipeline-kit project itself follows this: `research-notes.md` (this doc) is on-demand context; `CLAUDE.md` is global rules; Phase 1/2/3 discipline IS the commandified workflow. Already aligned — **no new ADR**.
  - **PIV validation pyramid** maps cleanly to pipeline-kit test plan (outline §12): **ADR15** (Vitest + fast-check) covers Layers 1-2; integration tests in `src/` mirror Layer 3; brain reviews + Idris dogfood = Layers 4-5. **Encode in CLAUDE.md "Anti-patterns" section** — flag PRs that skip a layer.
  - **"Reduce assumptions"** philosophical alignment with `Reviewable<I>` (**ADR14**): HITL is "every assumption is a question to a human." Reinforces framing.
  - **"Git log is memory"** — pipeline-kit commit-message discipline + CLAUDE.md "no emojis in commit messages." Already aligned.
- **What to avoid:**
  - Don't conflate PIV (development methodology, meta layer) with pipeline-kit's Source/Process/Serve (runtime architecture, object layer). Different abstraction layers.
  - Don't ship PIV-specific commands as kit primitives — they're project-workflow tools, not stage adapters.
- **Stated non-goals:** PIV is a methodology, not a framework. Workshop demo uses Next.js/Drizzle/Zod; demo stack is incidental.
- **License + community:** Workshop materials open (no explicit LICENSE in README excerpt). Cole Medin runs Dynamous community; talks given at YC Aug 2025. Patterns gaining traction in agentic-engineering community.

---

### Category I — Synthesis

**Top 3 patterns to lift across architecture references:**

1. **Step-as-durable-boundary** (Inngest + Trigger.dev + Hatchet + Temporal converge unanimously). Each stage invocation in pipeline-kit's Composer should be a durable boundary (idempotent, checkpointed) when running under v1 durable adapter. **The kit's typed-stage thesis ALIGNS with this** — Source/Process/Serve are natural step boundaries. Maps to **ADR3**. **Confidence HIGH.**

2. **Functional core, imperative shell.** Temporal's Workflow-vs-Activity, Effect's Layer-DI separation, Cole Medin's "context is king + reset between Plan/Implement," Inngest's pure-function-with-step.run-side-effects all converge. Already a CLAUDE.md style rule. Reinforced by all 5 architecture references. **No new ADR needed; cite all 5 in spec.**

3. **Per-stage flow-control config object.** Inngest's `{ throttle, concurrency, rateLimit, batchEvents, idempotency, priority, retries, cancelOn }` block; Hatchet's RateLimit/Concurrency/Priority/RetryPolicy; Trigger.dev's per-task retry/concurrency. Converge on a flat config-object shape. Maps to **ADR9 + ADR10 + ADR13**. **Confidence HIGH** for adopting an Inngest-shaped config block.

**Top 2 pitfalls to avoid:**

1. **Reinventing durable execution in v0.** Temporal-class event-sourced replay is overkill; Inngest/Trigger.dev/Hatchet-class step-checkpointing requires significant infra. v0 stays sync (in-process); v1 adopts an existing platform via adapter (**ADR3**).

2. **Adopting Effect.ts ecosystem wholesale without commitment.** Effect ships `@effect/workflow`, `@effect/sql-drizzle`, `@effect/opentelemetry`, `@effect/rpc`, `@effect/ai-*` — adopting Effect cascades through ADR3, ADR8, ADR11. **ADR1 says "vanilla TS v0, evaluate Effect for v1" — the cascade IS the reason for the deferral.** Don't backfill Effect into v0 just because individual primitives look attractive.

**Implications for ADRs (with confidence):**

- **ADR1 (Effect.ts adoption):** v0 vanilla confirmed (HIGH confidence). v1 re-eval still warranted — Effect's ecosystem cohesion (Layer DI + workflow + sql-drizzle + OTel + AI providers) is materially attractive. **Confidence MED for v1 adoption** (real tradeoff, not a foregone conclusion).
- **ADR3 (sync v0, durable v1):** Strongly supported. Inngest is most pipeline-kit-shape-compatible (event-driven, step-as-boundary, TS-first). Trigger.dev second (TS-only, similar shape). Hatchet third (multi-language adds complexity surface). Temporal too heavyweight; reference only. `@effect/workflow` is a wildcard if Effect adopted. **Confidence HIGH for sync v0; HIGH for Inngest as primary v1 adapter reference.**
- **ADR5 (state/context):** Effect Layer DI is a compelling reference. v0 can use simple Context pass-through (style rule "no class for behavior unless lifecycle requires"). orchestr8 backend hint in outline §7 implies external memory adapter. **Confidence MED — Phase 2 needs to define Context shape concretely.**
- **ADR9 (idempotency):** Inngest's function-level (template) + event-level (event ID) is canonical. **Confidence HIGH.** Direct pattern adoption.
- **ADR10 (backpressure):** Token-bucket at Source/Serve boundary aligns with Inngest's `throttle: { limit, period }`. **Confidence HIGH.**
- **ADR12 (composition syntax):** `Pipeline.from(s).through(p).store(st).to(srv)` chainable. Effect uses pipe(); Inngest uses flat function-with-steps; Trigger.dev uses task definitions. pipeline-kit's chainable choice closer to LCEL. **Confidence MED** — both work; chainable reads better for typed-stage thesis.
- **ADR13 (retry policy):** Hatchet/Inngest/Trigger.dev all have per-stage policy + global default + override. **Confidence HIGH.**
- **ADR14 (Reviewable<I>):** Temporal Signal as conceptual model for resume; Inngest `step.waitForEvent` as alternative durable backing. **Confidence HIGH** that pause/resume is the right shape.
- **ADR15 (test framework):** Vitest + fast-check confirmed; `@effect/vitest` exists if Effect adopted; Effect ecosystem uses tstyche for type-level tests — possibly consider for type-test layer. **Confidence HIGH for Vitest+fast-check core.**

**Open questions for brain adjudication:**

1. **Does pipeline-kit's Composer wrap a durable executor in v1, or does the user's app code call into pipeline-kit's stages from inside an Inngest/Trigger.dev task?** Two architectures: **(A)** pipeline-kit owns the durable layer (heavy — kit grows infra surface); **(B)** pipeline-kit is a library called BY the user's durable function (light — kit stays library, infra is user's choice). *Brain recommend: (B). Document explicitly in ADR3.*
2. **`@effect/workflow` as ADR3 v1 alternative?** Phase 2 should list it alongside Inngest/Trigger.dev/Hatchet in ADR3 alternatives. Becomes natural fit IF ADR1 adopts Effect.
3. **PIV Loop validation pyramid → pipeline-kit's own CI gates.** Layer 1-2 covered (typecheck, lint, vitest). Layer 3 E2E — what's the kit's E2E? **Reference projects (Trades Outbound) ARE the E2E.** Layer 4-5 — manual review = brain. *Encode in CLAUDE.md "Anti-patterns" section.*
4. **Schedule primitive for Source adapters?** Temporal/Hatchet/Trigger.dev all have first-class schedules. pipeline-kit Source v0 is pull-by-call; cron triggers come from outer composer (workflow engine calls pipeline-kit). *Brain recommend: defer Schedule to v2; keep v0 pull-only — confirms ADR2.*
5. **`stakes` (HumanLayer) + `confidence` (Gatewerk) + `priority` (Hatchet/Inngest) → does pipeline-kit ship a unified "route policy" object?** Three orthogonal signals from three sources. *Brain recommend: add a NEW ADR (route-policy shape) to Phase 2 catalog. Outline §7 doesn't currently cover this.*

---

