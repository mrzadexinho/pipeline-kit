# pipeline-kit — v1 Research Outline

> **Purpose:** scope what gets researched in the v1 Phase 1 cycle before any
> spec or code is written. Feeds `research-notes-v1-cat-*.md` per category,
> then a brain synthesis into `docs/spec-v1.md`.
>
> **Author:** Brain — 2026-05-07.
> **Predecessor:** Phase 1 v0 research (10 categories → 23 ADRs → M0 + M0.5
> shipped). The v0 model and ADRs are locked inputs — this research extends
> them, not re-deliberates them.
> **Status:** Draft — open for iteration before research begins.

---

## What changed since v0

v0 research established the typed-stage model (Source/Store/Process/Serve),
the Composer, Result<T,E>, Zod boundaries, OTel, HRP/Reviewable, 23 ADRs,
and 17 reference packages. All shipped and green.

v1 research addresses three things v0 deliberately deferred:

1. **Protocol stack gaps** — durable execution, trigger/scheduling, agent
   communication, memory/feedback. These are the missing layers between the
   typed-stage primitives and a production-grade personal automation toolkit.

2. **Stage model extension** — the 4-stage linear model needs to handle DAGs,
   new primitive types (Agent, Gate, Aggregate, Trigger), and richer semantics
   per stage. Real automations are graphs, not chains.

3. **Empirical validation** — v0 research was read → synthesise. v1 adds a
   mandatory spike per category: a small working proof-of-concept that answers
   questions docs cannot. Findings from spikes feed the ADR candidates.

**What v1 is NOT:**
- Not a product launch or reference project (no Trades Outbound).
- Not a re-deliberation of v0 ADRs.
- Not a framework or runtime — kit stays a library beneath workflow engines.

---

## Research approach (empirical — spikes required)

Each category follows this sequence:

```
1. SOURCE READING   — 4-8 targeted sources (docs, repos, papers, talks)
2. SPIKE            — a small working proof-of-concept (throwaway quality)
3. FINDINGS         — what the spike revealed that reading alone cannot
4. SYNTHESIS        — ADR candidate(s) for the v1 spec
```

Spikes live in `research/spikes/<category-slug>/`. Each spike is a minimal
runnable TypeScript (or Python) program — not a package, not a test suite.
It exists to surface friction, edge cases, and missing primitives.

Output per category: one `research-notes-v1-cat-<N>.md` file.

---

## Category I — Durable Execution & Runtime Protocols

**The gap:** `pipeline.run()` is fire-and-forget. If the VPS reboots mid-run,
state is lost. Retry policy exists but is in-process only. For long-running,
multi-step automations (LLM chains, multi-source enrichment) durability is
non-negotiable.

**The question:** What is the right durable execution primitive for a
self-hosted, TypeScript-primary, library-not-runtime kit on a VPS with
Postgres (Supabase) already available?

**Sources to mine:**
1. Inngest — step functions, event-driven, hosted + self-hostable
2. Trigger.dev — background jobs, scheduled tasks, retries, self-hostable
3. Hatchet — DAG workflows, worker management, self-hosted Postgres-backed
4. Temporal — deterministic workflows, activity/workflow split, heavy ops overhead
5. BullMQ — Redis-backed job queue; lightweight; widely used
6. pg-boss — Postgres-backed job queue; zero extra infra for Supabase users
7. Effect Workflow (`@effect/workflow`) — revisit ADR1 cascade impact
8. Cloudflare Durable Objects — edge-native durable state (alternative deployment target)

**Spike:** Wire `Pipeline.from(source).through(process).to(serve)` inside a
pg-boss job. Does the kit's `Result<T,E>` + retry semantics compose cleanly
with pg-boss's retry/backoff? What does checkpoint/resume look like per atom?

**Questions to answer:**
- Which durable runtime has the lowest ops overhead on a self-hosted VPS
  with Postgres already running?
- How does `PipelineContext` need to change to carry a durable step reference?
- Is the right answer a thin wrapper package (`@pipeline-kit/composer-pgboss`)
  or a documented integration pattern?
- What is the checkpoint granularity — per pipeline run, per atom, per stage?

---

## Category II — Agent Protocols & Multi-Agent Composition

**The gap:** MCP adapters (`source-mcp`, `serve-mcp`) exist but treat MCP as
a dumb tool-call boundary. The emerging landscape is agents that compose other
agents, pipelines that invoke other pipelines, and inter-agent protocols that
go beyond tool-call/response. A2A (Google), Anthropic's Agent SDK, and OpenAI
Agents all make different bets.

**The question:** What is the right `Agent<I,O>` primitive for pipeline-kit,
and how do autonomous agents compose with typed stages?

**Sources to mine:**
1. Anthropic Agent SDK — subagent dispatch, tool use, multi-turn
2. OpenAI Agents SDK — handoffs, tool schemas, guardrails
3. Google A2A protocol — agent-to-agent communication spec
4. LangGraph — graph-based agent orchestration, node/edge model
5. CrewAI — multi-agent teams, role-based agents
6. Pydantic AI — type-safe Python agent model (lift patterns, not code)
7. smolagents (HuggingFace) — minimal agent primitives
8. MCP spec deep-dive — resources + prompts + tools (not just tools)

**Spike:** Build a pipeline where `process-extract` is replaced by a
multi-turn Claude agent that uses MCP tools mid-extraction. Does
`Process<I,O>` hold, or does agent async back-and-forth break the interface?

**Questions to answer:**
- Is `Agent<I,O>` a new stage type or a special case of `Process<I,O>`?
- How does `PipelineContext.signal` (AbortSignal) thread through a multi-turn agent?
- What does A2A look like as a Serve adapter? (pipeline emitting to another agent)
- How do agent handoffs compose with Reviewable<I> gates?
- What is the MCP resource/prompt pattern that `source-mcp` currently ignores?

---

## Category III — DAG Composition & Graph Model

**The gap:** The current composition model is linear:
`Pipeline.from(s).through(p).to(srv)`. Real automations need fan-out (one atom
→ multiple branches), fan-in (multiple atoms → one aggregate), parallel
execution, conditional branching, and loops. These require a graph model.

**The question:** How do you extend the typed-stage chain into a typed DAG
without losing type safety or breaking the existing linear API?

**Sources to mine:**
1. LangGraph — StateGraph model; nodes, edges, conditional edges, cycles
2. Prefect 3.0 — Python DAG with type hints; `.submit()` / `.result()` pattern
3. Temporal — workflow-as-code DAG; deterministic execution constraint
4. Apache Beam — PCollection / PTransform composition model
5. Dagster — asset-based DAG; software-defined assets
6. RxJS — observable pipelines; operators as graph edges; back-pressure
7. Effect.ts — `Effect.all`, `Effect.race`, `Effect.fork` parallel semantics
8. n8n node graph — visual DAG → JSON representation; what the schema looks like

**Spike:** Try to express a fan-out (one source → two parallel process branches
→ merge → one serve) using current pipeline-kit. Document exactly where the
type system breaks, where the Composer has no answer, and what the minimum
API addition would need to be.

**Questions to answer:**
- What is the right TypeScript representation of a typed DAG? (Class-based?
  Builder-pattern? Functional composition?)
- Does fan-out require a new `Fan<I, Branches>` primitive, or can `Pipeline`
  grow `.branch()` / `.merge()` methods?
- How does OTel span hierarchy extend to a DAG? (Currently parent → child
  per stage; DAG needs sibling spans + join points)
- How does retry policy apply in a DAG? (Per node? Per edge? Per subgraph?)
- Is a DAG-pipeline backward-compatible with the linear API, or a new
  `Workflow` abstraction alongside `Pipeline`?

---

## Category IV — Trigger, Scheduling & Event Protocols

**The gap:** pipeline-kit has no trigger model. Every automation needs a
trigger — cron schedule, webhook arrival, event emission, manual invocation.
These should be first-class kit primitives, not bespoke runners per project.
The VPS context makes a self-hosted scheduler viable.

**The question:** What is the unified trigger model for pipeline-kit, and how
does it compose with the Source stage?

**Sources to mine:**
1. CloudEvents spec (CNCF) — standard event envelope; what a "trigger event" is
2. Inngest events — `inngest.send()` / `trigger` / `cron` unified model
3. pg-boss — scheduled jobs + cron expressions in Postgres
4. BullMQ — repeatable jobs, cron patterns, delayed jobs, priorities
5. Zapier trigger schema — what makes a good user-facing trigger definition
6. n8n trigger nodes — poll vs webhook vs interval; how they differ
7. GitHub Actions workflow triggers — `on: schedule / push / workflow_dispatch`
8. Resend webhook events — event taxonomy; how event types are namespaced

**Spike:** Deploy a cron-triggered pipeline run on the VPS using pg-boss
(already has Supabase/Postgres). Run `pipeline.run()` on schedule; test what
happens when two cron fires overlap (concurrent run protection).

**Questions to answer:**
- What is `Trigger<O>` as a kit primitive? Is it a Source specialisation or
  a separate layer?
- How does a webhook trigger (push event → pipeline start) unify with a
  cron trigger (schedule → pipeline start)?
- What is the CloudEvents-compatible event envelope that wraps a trigger?
- How does trigger deduplication work? (Two webhooks delivering the same event)
- Is the right answer a `@pipeline-kit/trigger-pgboss` package, or does
  trigger belong inside the Composer options?

---

## Category V — Memory, State & Feedback Protocols

**The gap:** Automations currently run statelessly — each run starts fresh.
For a personal automation toolkit, cross-run learning is high-leverage: LLM
extraction improves when it sees past failures; routing improves with feedback;
agents recall prior context. The orchestr8 `MemoryAdapter` stub exists but
has no v0 reference implementation.

**The question:** What are the right memory primitives for pipeline-kit —
short-term (run context), medium-term (cursor/checkpoint), long-term
(cross-run learning)?

**Sources to mine:**
1. mem0 — multi-level memory (user, session, agent); self-hostable
2. orchestr8 MCP — already in pipeline-kit orbit; what it actually provides
3. Zep — structured memory with temporal context
4. LangMem — LangChain's memory abstraction
5. pgvector patterns — already in kit; how semantic search composes with memory
6. Mastra memory — TypeScript-native agent memory (review current state)
7. Anthropic extended thinking — reasoning traces as memory signals
8. Pursuit's feedback corpus pattern — Python-side reference (lift pattern)

**Spike:** Wire mem0 (self-hosted) as the `MemoryAdapter` implementation.
Run `extract-process` twice on the same input — second run consults memory
of first run's failures. Does `wasEdited` / `EditableField<T>` flow back
into memory correctly?

**Questions to answer:**
- What is the concrete `MemoryAdapter` interface beyond the current stub?
  (read, write, search, forget — what methods?)
- How does memory scope work? Per-pipeline? Per-stage? Per-atom? Per-user?
- What is the feedback loop from `EditableField<T>` → memory → next run?
- How does pgvector-store compose with MemoryAdapter? (Semantic memory vs
  structured memory)
- Is memory a Context concern (`ctx.memory`) or a stage concern
  (`Memory<T>` as a new stage type)?

---

## Category VI — Stage Model Extension

**The gap:** The 4-stage model (Source/Store/Process/Serve) handles linear
automations well. But three classes of primitive are missing or underspecified:

A. **New stage types** — Agent, Gate, Aggregate, Trigger, Fan, Signal
B. **Richer stage semantics** — Source has 2 methods; should it have more?
   (checkpoint, health, schema-introspect) Process is too broad — does
   extraction and routing and filtering feel meaningfully different?
C. **Two-plane model** — data plane (atoms flowing) vs control plane
   (signals, health checks, cancellation, metadata). Currently conflated.

**Sources to mine:**
1. Apache Beam — PCollection / PTransform; DoFn, CombineFn, CoGroupByKey
2. Kafka Streams — topology DSL; KStream, KTable, GlobalKTable
3. Flink DataStream API — map, filter, keyBy, window, aggregate
4. Temporal activity/workflow split — what belongs in activity vs workflow
5. Pursuit's Python stage model — local reference; what patterns emerged
6. tRPC procedure builder — how method chaining carries type context
7. Effect.ts typed effects — `Effect<Success, Error, Requirements>`
8. LangGraph StateGraph — how state schema flows through a graph

**Spike A (new types):** Implement `Gate<I>` as a generalised
`Reviewable<I>` — a stage that can pass, hold, reject, or transform input
based on any predicate (not just human decision). Express it without
changing the core interfaces. What's missing?

**Spike B (two-plane):** Trace what happens when `ctx.signal` aborts —
how does the cancellation signal flow through the current Composer? Where
does the data plane and control plane get confused?

**Questions to answer:**
- What is `Agent<I,O>` — a Process with multi-turn semantics? A new
  stage type? How does it differ from `Process<I,O>` in the type system?
- What is `Gate<I>` — is it `Reviewable<I>` generalised, or a distinct
  primitive that Reviewable implements?
- What is `Aggregate<I[], O>` — fan-in for a DAG? Where does it live?
- Should `Source<O>` grow `checkpoint()` / `health()` methods? Or are
  these Context concerns?
- Is the data plane / control plane split an ADR-level decision, or
  an implementation detail?

---

## Category VII — Configuration, Templates & Developer Experience

**The gap:** Using pipeline-kit requires writing TypeScript. For a personal
automation toolkit, this is fine for complex pipelines — but common patterns
(scheduled API pull → LLM extract → store) should be expressible as config,
not code. No template system, no CLI, no pipeline-as-data format exists yet.

**The question:** What is the minimum DX layer that makes pipeline-kit
efficient for Idris's own use without becoming a no-code product?

**Sources to mine:**
1. Inngest function definition — TypeScript config object → hosted function
2. n8n node spec — JSON-based pipeline definition; what fields matter
3. Zapier action/trigger schema — what a non-dev-friendly automation spec looks like
4. GitHub Actions YAML — declarative workflow; triggers + steps + env
5. Pulumi — TypeScript-native infra-as-code; config without YAML; resource model
6. Temporal SDK — workflow definition as regular TypeScript function
7. Hatchet workflow definition — `createWorkflow()` config factory pattern
8. `pipeline.describe()` (existing) — what `PipelineDefinition` currently returns;
   gap between current output and a runnable config format

**Spike:** Take a real pipeline (apify-source → extract-process → email-serve)
and express it as a JSON config object. Write a 50-line runner that reads the
config and executes `Pipeline.from(...)`. What type information is lost?
What must remain code?

**Questions to answer:**
- What is `PipelineDefinition` v1 — a serialisable config format or a
  runtime-only descriptor?
- What belongs in config (adapter selection, retry policy, schedule) vs code
  (custom predicates, schema definitions, prompt functions)?
- What is the minimum CLI? (`pk run <config>`, `pk inspect <run-id>`,
  `pk trace <run-id>`) — what commands are needed before a UI makes sense?
- Should pipeline templates be TypeScript factory functions, JSON files,
  or both?
- Is there a `@pipeline-kit/cli` package, or does the CLI ship as a
  separate tool?

---

## Synthesis target

After all 7 categories are researched and spiked, the brain produces:

**v1 ADR candidates** — following the same ADR template as v0 (Status /
Context / Decision / Alternatives / Reference signal / Consequences). Each
category is expected to produce 2-4 ADR candidates. Target: 15-20 new ADRs
covering the gaps above.

**Stage model v1 spec** — extension of `spec-api-surface.md` with new
primitives, revised stage interfaces, and composition model beyond linear.

**Revised roadmap** — `spec-build-plan.md §4` updated with v1 milestones
(M2-M5) reflecting what the research reveals.

---

## Brain synthesis format (per category)

Each `research-notes-v1-cat-<N>.md` should follow this structure:

```markdown
# v1 Research Notes — Cat N: <Title>

## Sources reviewed
- Source 1: <name> — <one-line finding>
- Source 2: ...

## Spike: <spike name>
### What was built
### What it revealed (friction, missing primitives, unexpected constraints)
### Code snippet (the key insight, ≤30 lines)

## Open questions answered
- Q: <question from outline> → A: <finding>

## Open questions unresolved
- <questions that need more research or a second spike>

## ADR candidates
- ADR-vN-X: <title> — <one-line decision direction>
```

---

## Research session discipline

- **No spec resolution during research.** Surface findings; don't lock ADRs
  until brain synthesis.
- **Spike before synthesis.** Don't write ADR candidates from reading alone;
  always have spike evidence.
- **Per-category files only.** No single notes file; one file per category
  (mirrors v0 `research-notes-cat-*.md` discipline).
- **Line limit:** each notes file < 500 lines. Split if needed.
- **No new v0 ADR amendments** during v1 research. Conflicts with v0 surface
  as open questions for brain to adjudicate in v1 spec.

---

*End of v1 research outline. 7 categories; spike-first empirical approach;
15-20 ADR candidates expected from synthesis.*

*Author: Brain — 2026-05-07.*
*v0 inputs: spec.md (23 ADRs) + spec-api-surface.md + spec-adapters.md +
spec-build-plan.md. v1 research branches from M0.5 ship tip 1c340bc.*
