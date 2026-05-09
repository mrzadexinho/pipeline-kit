# pipeline-kit — v1 Research Outline

> **Purpose:** scope v1 Phase 1 research before spec or code. Feeds
> `research-notes-v1-cat-*.md` per category, then brain synthesis into
> `docs/spec-v1.md`.
> **Author:** Brain — 2026-05-08 (merged from 7-cat draft + 10-cat
> friction-first + Phase 0 catalog).
> **Predecessor:** Phase 1 v0 (10 cats → 23 ADRs → M0 + M0.5 shipped at
> 1c340bc); v0 ADRs locked inputs, not re-deliberated.
> **Phase 0 input:** `docs/research-friction-catalog.md` (9 projects, top-15).
> **Companions:** `research-outline-v1-constellation.md`,
> `research-outline-v1-packs.md`.
> **Status:** LOCKED 2026-05-08; Phase 1 may begin.

---

## What changed since v0

v0 synthesised 23 ADRs + 17 reference adapters; M0 + M0.5 shipped both. v1
extends without re-deliberating v0. Five concerns inherit:

1. **Protocol stack gaps** — durable execution, triggers, agent protocols, memory/feedback (Brain).
2. **Stage model extension** — DAGs, new stage types, two-plane semantics.
3. **Empirical validation** — spike-driven, not document synthesis.
4. **Cross-runtime reach** *(new)* — kit is TS-only; half the example automations (Python) cannot reach kit until this is solved.
5. **Identity / secrets / cost** *(new)* — every adapter quietly re-solves credentials and rate-budgets; no shared pattern exists.

---

## What v1 is NOT

- Not a product launch or reference project (no Trades Outbound).
- Not a re-deliberation of v0 ADRs.
- Not a framework or runtime — kit stays a library beneath workflow engines.
- Constellation projects are example use cases, not customers — kit must not bake in any project-specific assumption (per `feedback_pipeline_kit_4tier_no_customer.md`).

---

## The reframe: friction-first, not category-first

Brain's original outline named 7 categories from inside the kit looking out.
This locked outline rebases on **friction common to all automation** —
surfaced first in `Claude-Workspace/` because we have direct read access, but
kit treats those projects as *example use cases*, no different from any
n8n flow / Apify actor / Python script. Kit stays product- and
use-case-agnostic; the constellation is convenient evidence, not the
customer base. Friction-first asks what hurts in real automations, not what
feels architecturally incomplete inside the kit.

---

## Phase 0 prerequisite — DONE

Phase 0 ended 2026-05-08 with all 9 projects catalogued. Output:
`docs/research-friction-catalog.md`. Top-3 evidence findings:

- **Cat IX (F-INTEROP)** — top-rank; 5/9 projects; gates kit's reach to half the constellation (TS-only otherwise).
- **Cat VIII (F-AUTH)** — most ubiquitous; 9/9 projects re-roll credentials.
- **Cat V (F-MEMORY)** — highest per-incidence severity; 4 incompatible memory shapes (gatewerk / orchestr8 / pursuit / cole-obsidian).

**Two locked downstream calls from Phase 0:** orchestr8 IS the
`MemoryAdapter` reference impl (Cat V spike is wiring, not selection);
devshield IS the pack pattern (lift bundling discipline).

---

## Phase 1 spike order — LOCKED 2026-05-08

| # | Cat | Friction | Rationale |
|---|-----|----------|-----------|
| 1 | IX Cross-Runtime | F-INTEROP | top-rank; gates half the constellation |
| 2 | VIII Identity/Secrets | F-AUTH | 9/9 ubiquity; redaction is v1 must-have (`-packs.md` §5.3) |
| 3 | V Memory/Feedback | F-MEMORY | orchestr8 wiring; highest per-incidence severity |
| 4 | I Durable Execution | F-DURABILITY | pg-boss spike on VPS noesis |
| 5 | IV Trigger/Schedule | F-TRIGGER | overlaps Cat I infra (pg-boss) |
| 6 | VI Stage Model Extension | F-PRIMITIVE | Gate / Aggregate / two-plane |
| 7 | III DAG Composition | F-LINEAR | only 2/9 projects today; deferable if I+IV land |
| 8 | II Agent Protocols | F-AGENT | depends on Cat VI primitives |
| 9 | VII Config/DX | F-CONFIG | depends on stable stage primitives |
| 10 | X Cost/Usage | F-COST | depends on observability + redaction (Cat VIII) |

---

## Research approach (empirical — spikes required)

Each category follows this sequence:

```
1. SOURCE READING   — 4-8 targeted sources (docs, repos, papers, talks)
2. SPIKE            — a small working proof-of-concept (throwaway quality)
3. FINDINGS         — what the spike revealed that reading alone cannot
4. SYNTHESIS        — ADR candidate(s) for the v1 spec
```

Spikes live in `research/spikes/<category-slug>/` — minimal runnable TS (or
Python) programs, not packages or test suites. Surface friction, edge cases,
missing primitives. Output per category: one `research-notes-v1-cat-<N>.md`.

---

## Category I — Durable Execution & Runtime Protocols

**Friction anchor:** F-DURABILITY (catalog top-15 #7) + F-RETRY (#9).

**Gap:** `pipeline.run()` is fire-and-forget; VPS reboot loses state; retry
is in-process only. Long-running LLM chains and multi-source enrichment
need durability.

**Question:** Right durable-execution primitive for a self-hosted,
TS-primary, library-not-runtime kit on a VPS with Postgres (Supabase)?

**Sources to mine:** Inngest (step functions, event-driven, self-hostable);
Trigger.dev (background jobs, scheduled tasks, retries); Hatchet (DAG
workflows, Postgres-backed); Temporal (deterministic workflows,
activity/workflow split, heavy ops); BullMQ (Redis queue, lightweight);
pg-boss (Postgres queue, zero extra infra for Supabase); Effect Workflow
(`@effect/workflow` — revisit ADR1 cascade); Cloudflare Durable Objects
(edge-native durable state alternative).

**Spike:** Wire `Pipeline.from(s).through(p).to(srv)` inside a pg-boss job.
Does kit's `Result<T,E>` + retry compose with pg-boss retry/backoff?
Checkpoint/resume per atom?

**Questions to answer:**
- Lowest ops overhead durable runtime on self-hosted VPS w/ Postgres?
- How must `PipelineContext` change to carry a durable step reference?
- Thin wrapper (`@idriszade/composer-pgboss`) or documented pattern?
- Checkpoint granularity — per run / atom / stage?

---

## Category II — Agent Protocols & Multi-Agent Composition

**Friction anchor:** F-AGENT (catalog top-15 #12).

**Gap:** MCP adapters treat MCP as a dumb tool-call boundary. Real landscape
is agents composing agents, pipelines invoking pipelines, and inter-agent
protocols beyond tool-call/response (A2A, Anthropic Agent SDK, OpenAI Agents
each bet differently).

**Question:** Right `Agent<I,O>` primitive for pipeline-kit; how do
autonomous agents compose with typed stages?

**Sources to mine:** Anthropic Agent SDK (subagent dispatch, tool use,
multi-turn); OpenAI Agents SDK (handoffs, tool schemas, guardrails);
Google A2A protocol (agent-to-agent comm spec); LangGraph (graph-based
agent orchestration, node/edge); CrewAI (role-based multi-agent teams);
Pydantic AI (type-safe Python agent model — lift patterns); smolagents
(HuggingFace, minimal agent primitives); MCP spec deep-dive (resources +
prompts + tools, not just tools).

**Spike:** Replace `process-extract` with a multi-turn Claude agent using
MCP tools mid-extraction. Does `Process<I,O>` hold, or does async
back-and-forth break it?

**Questions to answer:**
- `Agent<I,O>` — new stage type or special case of `Process<I,O>`?
- How does `ctx.signal` (AbortSignal) thread through a multi-turn agent?
- A2A as a Serve adapter (pipeline emitting to another agent)?
- How do agent handoffs compose with `Reviewable<I>` gates?
- The MCP resource/prompt pattern `source-mcp` currently ignores?

---

## Category III — DAG Composition & Graph Model

**Friction anchor:** F-LINEAR (catalog top-15 #11).

**Gap:** Current composition is linear (`from(s).through(p).to(srv)`). Real
automations need fan-out, fan-in, parallel exec, conditional branching, and
loops — graph model required.

**Question:** Extend the typed-stage chain into a typed DAG without losing
type safety or breaking the linear API?

**Sources to mine:** LangGraph StateGraph (nodes, edges, conditional edges,
cycles); Prefect 3.0 (Python DAG with type hints, `.submit()` / `.result()`);
Temporal (workflow-as-code DAG, deterministic constraint); Apache Beam
(PCollection / PTransform composition); Dagster (asset-based DAG,
software-defined assets); RxJS (observable pipelines, operators as edges,
back-pressure); Effect.ts (`Effect.all` / `.race` / `.fork`); n8n node graph
(visual DAG → JSON schema).

**Spike:** Express a fan-out (one source → two parallel process branches →
merge → one serve) in current pipeline-kit. Document where types break,
where Composer has no answer, the minimum API addition needed.

**Questions to answer:**
- Right TS representation of a typed DAG? (Class / builder / functional?)
- New `Fan<I, Branches>` primitive, or `Pipeline.branch()` / `.merge()`?
- OTel span hierarchy in a DAG — sibling spans + join points?
- Retry policy in a DAG — per node / edge / subgraph?
- DAG backward-compatible with linear API, or new `Workflow` abstraction?

---

## Category IV — Trigger, Scheduling & Event Protocols

**Friction anchor:** F-TRIGGER (catalog top-15 #10).

**Gap:** No trigger model. Every automation needs one — cron / webhook /
event / manual. Should be first-class, not bespoke per project; VPS context
makes a self-hosted scheduler viable.

**Question:** Unified trigger model for pipeline-kit; how does it compose
with the Source stage?

**Sources to mine:** CloudEvents spec (CNCF — standard event envelope);
Inngest events (`inngest.send()` / trigger / cron unified); pg-boss
(scheduled jobs + cron in Postgres); BullMQ (repeatable jobs, cron, delayed,
priorities); Zapier trigger schema (user-facing trigger definition);
n8n trigger nodes (poll vs webhook vs interval); GitHub Actions workflow
triggers (`on: schedule / push / workflow_dispatch`); Resend webhook events
(event taxonomy + namespacing).

**Spike:** Deploy a cron-triggered pipeline run on VPS via pg-boss. Run
`pipeline.run()` on schedule; test concurrent-run protection when two
fires overlap.

**Questions to answer:**
- `Trigger<O>` — Source specialisation or separate layer?
- How does webhook trigger unify with cron trigger?
- CloudEvents-compatible event envelope wrapping a trigger?
- Trigger deduplication — two webhooks delivering same event?
- `@idriszade/trigger-pgboss` package, or trigger-in-Composer-options?

---

## Category V — Memory, State & Feedback Protocols

**Friction anchor:** F-MEMORY (catalog top-15 #4) + F-X-mem (#13).

**Gap:** Automations run statelessly; each run starts fresh. Cross-run
learning is high-leverage (LLM extraction sees past failures; routing
improves with feedback; agents recall context). v0 `MemoryAdapter` stub has
no reference impl.

**Question:** Right memory primitives — short-term (run context),
medium-term (cursor/checkpoint), long-term (cross-run learning)?

**Sources to mine:** orchestr8 MCP (confirmed Phase 0 reference impl;
already in kit orbit); Zep (structured memory + temporal context); LangMem
(LangChain memory abstraction); pgvector patterns (semantic search + memory
composition); Mastra memory (TS-native agent memory — review current state);
Anthropic extended thinking (reasoning traces as memory signals); Pursuit
feedback corpus pattern (Python-side reference); mem0 (multi-level memory
comparison — user / session / agent, self-hostable).

**Spike:** Wire orchestr8 (TypeScript MCP) as the `MemoryAdapter` impl.
Run `process-extract` twice on same input — second run consults memory of
first run's `EditableField<T>` deltas. Does `wasEdited` flow back?

**Questions to answer:**
- Concrete `MemoryAdapter` interface beyond stub — methods (read/write/search/forget)?
- Memory scope — pipeline / stage / atom / user?
- Feedback loop: `EditableField<T>` → memory → next run?
- pgvector-store ↔ MemoryAdapter — semantic vs structured composition?
- Memory as Context concern (`ctx.memory`) or stage type (`Memory<T>`)?

---

## Category VI — Stage Model Extension

**Friction anchor:** F-PRIMITIVE (catalog top-15 #3).

**Gap:** 4-stage model handles linear; three classes missing: (A) new
stage types — Agent / Gate / Aggregate / Trigger / Fan / Signal; (B)
richer stage semantics — should `Source<O>` grow `checkpoint` / `health` /
`schemaIntrospect`? Is `Process<I,O>` too broad (extract vs route vs filter)?
(C) two-plane — data plane (atoms) vs control plane (signals, health,
cancellation, metadata) currently conflated.

**Sources to mine:** Apache Beam (PCollection / PTransform; DoFn / CombineFn
/ CoGroupByKey); Kafka Streams (topology DSL; KStream / KTable /
GlobalKTable); Flink DataStream API (map / filter / keyBy / window /
aggregate); Temporal activity/workflow split; Pursuit Python stage model
(local reference); tRPC procedure builder (method chaining carries type
context); Effect.ts typed effects (`Effect<S, E, R>`); LangGraph StateGraph
(state schema flow through graph).

**Spike A (new types):** Implement `Gate<I>` as generalised `Reviewable<I>`
— pass/hold/reject/transform on any predicate. Express without core
interface changes. What's missing?

**Spike B (two-plane):** Trace `ctx.signal` abort through the Composer —
where do data and control planes get confused?

**Questions to answer:**
- `Agent<I,O>` — Process with multi-turn semantics, or distinct stage type?
- `Gate<I>` — generalised Reviewable, or distinct primitive Reviewable implements?
- `Aggregate<I[],O>` — fan-in for DAG; where does it live?
- Should `Source<O>` grow `checkpoint()` / `health()`? Or Context concerns?
- Two-plane split — ADR-level decision or implementation detail?

---

## Category VII — Configuration, Templates & Developer Experience

**Friction anchor:** F-CONFIG (catalog top-15 #6).

**Gap:** Using pipeline-kit requires TS. Common patterns (scheduled API
pull → LLM extract → store) should be config, not code. No templates,
no CLI, no pipeline-as-data format yet.

**Question:** Minimum DX layer that makes pipeline-kit efficient without
becoming a no-code product?

**Sources to mine:** Inngest function definition (TS config object → hosted
function); n8n node spec (JSON-based pipeline definition); Zapier
action/trigger schema (non-dev-friendly automation spec); GitHub Actions
YAML (declarative workflow — triggers + steps + env); Pulumi (TS-native
infra-as-code, no YAML, resource model); Temporal SDK (workflow as regular
TS function); Hatchet `createWorkflow()` (config factory); existing
`pipeline.describe()` (gap to runnable config format).

**Spike:** Take a real pipeline (apify-source → extract-process →
email-serve), express as JSON config + 50-line runner. What type info is
lost? What must remain code?

**Questions to answer:**
- `PipelineDefinition` v1 — serialisable config or runtime-only descriptor?
- Config (adapter / retry / schedule) vs code (predicates / schemas /
  prompt fns)?
- Minimum CLI — `pk run` / `inspect` / `trace`?
- Templates as TS factory functions, JSON files, or both?
- `@idriszade/cli` package, or separate tool?

---

## Category VIII — Identity, Secrets & Auth Protocols

**Friction anchor:** F-AUTH (catalog top-15 #2 — 9/9 projects).

**Gap:** Every adapter needs credentials (Apify / Slack / SMTP / Supabase /
Anthropic / OAuth / HMAC). v0 punted; every reference package re-invents
`process.env.X`. No rotation, no scoping, no audit — invisible debt.

**Question:** Right secrets/identity protocol for kit, scaling from solo
laptop to multi-tenant VPS without becoming a vault product?

**Sources to mine:** Doppler / Infisical (developer secret mgmt); SOPS / age
(encrypted-in-git); HashiCorp Vault (dynamic secrets + lease); AWS / GCP IAM
(scoping precedent); OAuth 2.1 + DPoP (token binding); SSH agent forwarding
(secret-without-storage); Supabase service-role / anon-key (pursuit usage);
Apify credential scoping (agent-forge usage).

**Spike:** `SecretsAdapter` resolving Source/Serve creds from SOPS-encrypted
YAML on VPS noesis with rotation semantics; test agent-forge Apify token +
pursuit Supabase keys.

**Questions to answer:**
- `SecretsAdapter` — Context concern, adapter dependency, or stage type?
- Right scoping unit — pipeline / atom / adapter / per-call?
- Rotation semantics kit guarantees — pre / mid / post-rotation?
- Does kit ship a concrete adapter, or only a contract?
- HMAC signing for webhooks (already in v0) — extend to general envelope auth?

---

## Category IX — Cross-Runtime & Cross-Language Interop

**Friction anchor:** F-INTEROP (catalog top-15 #1) + F-X-langbridge (#15).

**Gap:** Kit is TypeScript. Pursuit / agent-forge / cole-obsidian are
Python; gatewerk is dual-SDK. A TS-only "shovel" leaves half the
constellation unreachable — kit becomes a TS-tribe artefact, not
infrastructure.

**Question:** Right cross-runtime interop protocol — Python bindings,
HTTP/MCP/A2A wire, or shared schema any runtime can implement?

**Sources to mine:** gRPC + Protobuf (language-neutral RPC); JSON Schema +
OpenAPI (wire-format precedent); CloudEvents (runtime-neutral event spec);
MCP (JSON-RPC-based); A2A (agent-to-agent, language-neutral); ts-pattern +
zod-to-json-schema (TS schema → wire); Pydantic ↔ JSON Schema (Python
bridge); Bun / Deno / Node compat constraints.

**Spike:** Express `Source<O> → Process<I,O> → Serve<I>` as JSON-RPC;
implement minimal Python `pipeline_kit_py` shim; run a pipeline with
Python Source (pursuit-style API pull) and TS Process (kit extract).

**Questions to answer:**
- Cross-runtime answer — wire protocol, binding, or both?
- How does `Result<T,E>` translate? (Python has no discriminated unions.)
- How do Zod schemas reach Python — codegen or JSON Schema bridge?
- Cross-runtime OTel context propagation?
- Does kit own the cross-runtime spec, or delegate to MCP / A2A?

---

## Category X — Cost, Usage & Resource Accounting

**Friction anchor:** F-COST (catalog top-15 #8).

**Gap:** LLM-heavy automations have non-trivial per-run cost; kit has no
cost model. Per-run / per-atom / per-adapter cost is invisible; budget caps
($X-per-run) impossible. Local-AI-stack (Ollama) is partly a cost response;
kit has no opinion at the budget boundary.

**Question:** Right cost-accounting primitive — cross-cutting Context
concern, Serve-level meter, or Composer-level budget?

**Sources to mine:** Anthropic / OpenAI usage APIs (token counts, per-call
cost); LangSmith (LLM trace + cost); Helicone / Langfuse (open-source LLM
obs + cost); Stripe Billing meters (usage-based metering); Vercel AI SDK
middleware (instrumentation); OpenTelemetry GenAI semantic conventions
(span attrs for LLM cost); Orb / Metronome (usage-billing patterns); Ollama
telemetry (local: latency / energy / compute).

**Spike:** Add `ctx.usage` to PipelineContext; wire to Anthropic SDK usage
events; emit per-atom cost from extract-process; test budget cap (abort at
$0.10 spent); repeat with Ollama backend — cost surface differs.

**Questions to answer:**
- Cost as `ctx.usage` (Context attribute) or `MeterAdapter` (adapter)?
- Cost taxonomy — token / request / time / data-volume / energy?
- Cost composition with retry — per attempt or per success?
- Does kit ship a `CostBudget` gate primitive, or is it adapter responsibility?
- How does cost-cap interact with `Reviewable<I>` (ask human before spending)?

---

## Synthesis target

After all 10 categories are researched and spiked, the brain produces:

**v1 ADR candidates** — ~25-30 ADRs (10 cats × ~2-3 each), following v0 ADR
template (Status / Context / Decision / Alternatives / Reference / Consequences).

**Stage model v1 spec** — extension of `spec-api-surface.md` with new
primitives (Trigger, Agent, Gate, Aggregate, Fan), revised stage interfaces,
DAG composition model, three v1 cross-cuts (replay / dry-run / MCP-expose).

**Adapter additions** — concrete reference adapters for `SecretsAdapter`,
`MemoryAdapter`, `MeterAdapter`, `TriggerAdapter` (per Cat IV/V/VIII/X).

**Pack inventory** — see `research-outline-v1-packs.md`: ~10 launch / ~7
expand / ~9 domain.

**Roadmap revision** — `spec-build-plan.md §4` updated with v1 milestones
(M2-M5) reflecting research findings + pack-tier rollout.

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

- **Friction-anchor every category.** No category without a Phase 0 top-15 cross-ref to `docs/research-friction-catalog.md` — if you can't anchor, the category isn't ready.
- **No v0 ADR amendments during v1.** Conflicts with v0 surface as open questions for brain to adjudicate in v1 spec.
- **No spec resolution during research.** Surface findings; lock ADRs only at brain synthesis.
- **Spike before synthesis.** No ADR candidate without spike evidence.
- **Per-category files only.** Mirror v0 `research-notes-cat-*.md` discipline; no single notes file.
- **Line limit:** each notes file ≤500 lines. Split if needed.
- **No project is a kit customer.** Constellation projects are example use cases. Kit must not bake in project-specific assumptions — design for "anyone, anywhere."

---

## Companion files

- `research-outline-v1-constellation.md` — per-project seed observations, friction tag taxonomy, frequency-table seed.
- `research-outline-v1-packs.md` — 4-tier architecture, ~30-pack roster (3 tiers), 5 vision additions, 3 v1 must-haves, explicit non-scope.
- `research-friction-catalog.md` — Phase 0 output (DONE 2026-05-08; 9 projects; top-15 friction items ranked).

---

*End of v1 research outline. 10 categories; spike-first empirical approach;
25-30 ADR candidates expected from synthesis.*

*Author: Brain — 2026-05-08 (merged from 7-cat draft 0175af6 + 10-cat
friction-first + Phase 0 catalog).*
*v0 inputs: spec.md (23 ADRs) + spec-api-surface.md + spec-adapters.md +
spec-build-plan.md. v1 research branches from M0.5 ship tip 1c340bc.*
