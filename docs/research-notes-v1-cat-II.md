# pipeline-kit — v1 Cat II Research Notes: Agent Protocols & MCP Composition

> Phase 1 v1 synthesis. Author: Brain — 2026-05-14.
> Inputs: 1 spike FINDINGS file (`research/spikes/cat-ii-agent-protocols/`).
> Friction anchor: F-AGENT (catalog top-15 #12; 3/9 projects).
> Status: synthesis complete; 5 ADR candidates locked direction; 5 carry-forwards dispositioned.

---

## Sources reviewed

### Spike evidence (1 spike)

**agent-as-process-composition** — commit [leave blank — brain fills post-merge].
3 cells: A (agent-as-process, 5 observations), B (mcp-composition, 5 observations),
C (multi-agent-handoff, 6 observations). 16/16 PASS. Probed: multi-turn loop
placement, MCP Source/Serve fit, handoff-as-through-chain, protocol-internal
containment, session state via MemoryAdapter.

### External sources (industry grounding from spike)

- **Anthropic Claude SDK** — agentic loop pattern: multi-turn `tool_use → execute → re-send → end_turn` as single async function.
- **Vercel AI SDK** — `generateText` (structured final) vs `streamText` (incremental observer); both produce same output shape.
- **OpenAI Agents SDK** — `Runner.run()`: tool execution internal to runner; handoff modeled as typed output → next agent input.
- **Google A2A protocol** — Task intake / output + Agent Card discovery (pre-pipeline HTTP metadata, not a stage).
- **MCP spec (Anthropic)** — Resources (pull-based URIs), Prompts (template → message array), Tools (handler registration).
- **LangGraph** — fan-out as typed edge from one node to N parallel nodes; structural parallel to `kitFanOut`.

---

## Reframe note

Four of Cat II's five research questions were pre-answered by prior cats:
Q1 by Cat VI ADR-VI-1 (named pattern on Process), Q2 by Cat IX ADR-IX-5
(adapter-tier), Q3 by Cat IV ADR-IV-1+7 (through-chain + kitFanOut), Q5 by
Cat V ADR-V-1 (MemoryAdapter + sessionId). Q4 (protocol interop) collapsed
into Cat IX ADR-IX-5 at spike time. One spike sufficed because the only
genuine open items were carry-forward dispositions — principally maxTurns
placement (cf #1), StreamingProcess scope (cf #4), and A2A Agent Card
boundary (cf #5). Cat II synthesis ADRs are confirmations, not novel decisions.

---

## Spike — agent-as-process-composition

### What was built

- **Cell A**: Anthropic-style multi-turn loop inside `Process<AgentInput, ExtractOutput>`;
  AbortSignal threading; streaming-vs-final separation; `AgentProcess<I,O>` type alias.
- **Cell B**: `Source<MCPResource>` → `Process<MCPResource, StructuredResult>` →
  `Serve<StructuredResult>` end-to-end; MCP Prompts as Source variant; compile-time chain proof.
- **Cell C**: Two-agent handoff via `.through(agentA).through(agentB)`; A2A as
  Source + Serve pair; session state via `ctx.deps.memory` keyed by `sessionId`;
  `kitFanOut([agentP1, agentP2, agentP3])` fan-out; `.review(hrpConfig)` between agents.

### What it revealed

1. **Process boundary is opaque to Composer.** Composer sees one `Promise<Result<O,E>>`.
   Turns, message history growth, and tool execution are internal — invisible at stage boundary. VERDICT: PASS.

2. **Streaming is an observer side effect, not a stage type change.** Token
   callbacks via `ctx.deps.observer?.onToken(chunk)` do not mutate the Process
   signature. `StreamingProcess<I,O>` as `AsyncIterable<O>` belongs at Serve/Source-tier,
   not Process core. VERDICT: PASS.

3. **MCP Resources, Prompts, and Tools map to Source/Process/Serve without new primitives.**
   Resources = Source pull, Prompts = Source variant, Tool handler = Serve registration.
   Cat IX ADR-IX-5 adapter-tier rule holds cleanly. VERDICT: PASS.

4. **Handoff = through-chain; type constraint is compile-time.** Agent A output
   type IS Agent B input type. `.through(agentA).through(agentB)` IS the handoff.
   OpenAI Agents SDK Handoff pattern maps identically. VERDICT: PASS.

5. **A2A exposure = Source + Serve pair; Agent Card is pre-pipeline HTTP metadata.**
   Agent Card discovery is not a stage — it is static HTTP metadata served before
   the pipeline runs. `Source<A2ATask>` + `Serve<FinalResult>` = A2A-compliant agent. VERDICT: PASS.

6. **Session state via MemoryAdapter behaviorally confirmed.** Run 1: `priorContext: null`.
   Run 2: prior run data present. `ctx.deps.memory` keyed by `sessionId`. No new primitive. VERDICT: PASS.

---

## Modern-direction framing

The 2024-26 agent protocol landscape has converged on one structural fact:
**the agent loop is an async function.** Anthropic SDK's agentic loop,
Vercel AI SDK's `generateText({ maxSteps })`, and OpenAI Agents SDK's
`Runner.run()` all wrap multi-turn execution in a single async call that
returns structured output. This is not coincidence — it reflects that the
orchestrator has no use for intermediate turns. Kit's `Process<I,O>` IS this
pattern. Protocol proliferation (MCP, A2A, OpenAI handoffs, LangGraph edges)
has not converged; the correct kit response is protocol-agnosticism — push
choice into adapter-tier and expose only typed `Process<I,O>` at kit-core.
Stateful agents confirm the same: no modern SDK bakes session state into the
agent primitive. Memory is always external (Anthropic: no session concept;
OpenAI Agents SDK: stateless per run; A2A: optional sessionId). Kit's
MemoryAdapter is the right structural match.

---

## ADR candidates

### ADR-v1-II-1 — Agent = named pattern on `Process<I,O>`; no new stage type

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Multi-turn agentic loops (Anthropic SDK), tool-calling agents (OpenAI
Agents SDK `Runner.run()`), and structured-extraction agents all wrap their
execution in a single async function returning typed output. Cat VI ADR-VI-1
established that Gate and Aggregate are named patterns on Process, not new stage
types.

**Decision:** `AgentProcess<I,O>` is a type alias on `Process<I & AgentInput, O &
ExtractOutput>` — naming convention, not a new type. Assignable to `Process<I,O>`
with zero coercion. No new stage primitive added to kit-core.

**Alternatives considered:** Dedicated `AgentStage<I,O>` type (rejected — adds
stage-type proliferation without new capability; Cat VI ADR-VI-1 precedent is definitive).

**Reference:** Cat VI ADR-VI-1; Anthropic Claude SDK agentic loop; OpenAI Agents SDK `Runner.run()`.

**Consequences:** Agent pipelines compose identically with non-agent stages.
Kit remains stage-count stable (4 types). Naming convention documented at adapter tier.

---

### ADR-v1-II-2 — MCP composition via existing Source/Serve adapters; no new primitives

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** MCP Resources (read-only URIs), MCP Prompts (template → message array),
and MCP Tools (handler registration) each map to an existing kit stage type.
Cat IX ADR-IX-5 delegated MCP to adapter-tier.

**Decision:** MCP Resources = `Source<MCPResource>`. MCP Prompts = `Source<MCPPromptOutput>`
variant. MCP Tool handler = `Serve<StructuredResult>` registration. Agent Process
consumes `ctx.deps.mcpClient` as a dep (Cat VIII deps-shape). No new stage type.

**Alternatives considered:** `MCPSource<T>` as distinct stage (rejected — unnecessary
subtype; plain Source suffices; Cat IX ADR-IX-5 governs).

**Reference:** Cat IX ADR-IX-5; MCP spec Resources + Prompts + Tools sections.

**Consequences:** MCP pipelines compose with non-MCP stages transparently. Blob
content decoding is an adapter-tier utility (cf #2, lifted).

---

### ADR-v1-II-3 — Multi-agent handoff = Composer through-chain; protocol interop = Process-internal

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** OpenAI Agents SDK models handoff as typed output → next agent input.
Google A2A defines Task + Result envelope over HTTP. LangGraph models fan-out as
typed edges. All require routing structured output from one agent to the next.

**Decision:** Agent handoff = `.through(agentA).through(agentB)` — Composer through-chain
enforces type constraint at compile time. Fan-out = `kitFanOut([agentP1, agentP2])` per
Cat IV ADR-IV-7. Protocol choice (Anthropic, OpenAI, A2A) is an implementation
detail inside the async Process body — invisible at the stage boundary.

**Alternatives considered:** Agent-aware Composer routing primitive (rejected — Cat IV
ADR-IV-1 governs; fan-out is already solved; protocol containment is the correct boundary).

**Reference:** Cat IV ADR-IV-1, ADR-IV-7; Cat IX ADR-IX-5; OpenAI Agents SDK Handoff pattern.

**Consequences:** Multi-agent pipelines are plain Composer chains. Protocol migrations
(e.g., Anthropic → A2A) are Process body swaps — zero Composer changes.

---

### ADR-v1-II-4 — Agent session state = MemoryAdapter (`deps.memory` + sessionId key); A2A Agent Card = pre-pipeline HTTP metadata

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** No modern SDK bakes session state into the agent primitive (Anthropic:
no session concept; OpenAI Agents SDK: stateless per run; A2A: optional sessionId
in Task envelope). Cat V ADR-V-1 established MemoryAdapter as the session pattern.
A2A Agent Card is static HTTP metadata served before pipeline execution.

**Decision:** Within-turn state = local variable inside Process body. Cross-turn
session state = `ctx.deps.memory.get(sessionId)` / `.set(sessionId, state)`.
A2A Agent Card = pre-pipeline HTTP metadata, not a stage. Confirmed: cf #5 CLOSED.

**Alternatives considered:** Session object threaded through Atom metadata (rejected —
Atom is data, not session carrier; Cat V ADR-V-1 governs).

**Reference:** Cat V ADR-V-1; A2A protocol Task envelope spec; Anthropic SDK stateless-per-call design.

**Consequences:** Stateful agent pipelines require MemoryAdapter in deps. Agent Card
serving is user-space setup — outside kit scope.

---

### ADR-v1-II-5 — `maxTurns` = per-Process config option; StreamingProcess = v2 scope

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** cf #1: should `maxTurns` live per-Process or at Composer level? cf #4:
is `StreamingProcess<I,O>` v1 or v2? Streaming tokens are already covered as
observer callbacks; the question is whether a named `AsyncIterable<O>` variant
is needed in v1.

**Decision:** `maxTurns` = per-Process constructor option with optional Composer-level
override guard (Composer guard = safety ceiling, not primary config). Rationale:
per-agent limits reflect agent-specific contracts; Composer-level is a global
safety rail only. `StreamingProcess<I,O>` = v2 scope — `streamText` / SSE streaming
is a UX concern; v1 orchestration is final-result only. Confirmed: cf #1 CLOSED, cf #4 CLOSED.

**Alternatives considered:** `maxTurns` at Composer only (rejected — too coarse; different
agents have different turn budgets). StreamingProcess in v1 (deferred — no reference
project drives the need; observer callback covers monitoring use cases).

**Reference:** Vercel AI SDK `generateText` vs `streamText` distinction; Anthropic SDK per-request limits.

**Consequences:** v1 agent configs carry `maxTurns` locally. Streaming output variant
is explicitly deferred — prevents premature API surface lock.

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)

| cf | Resolution | ADR |
|---|---|---|
| #1 maxTurns placement | Per-Process option + Composer ceiling guard | ADR-II-5 |
| #4 StreamingProcess scope | Deferred to v2; observer callback covers v1 | ADR-II-5 |
| #5 A2A Agent Card boundary | Pre-pipeline HTTP metadata; not a stage | ADR-II-4 |

### Lifted to future milestones

| cf | Disposition |
|---|---|
| #2 MCP blob content utility | `decodeMCPContent` helper — implementation detail, adapter-tier; lift to v1 spec (MCP adapter package) |
| #3 Reviewable gate rendering | Cross-cuts Cat VI HRP + rendering transform; lift to v1 spec (HRP section) |

---

*End of v1 Cat II research notes. All 5 questions pre-answered by prior cats; 16/16 spike observations PASS; 5 ADRs lock confirmed directions; cf #1/#4/#5 closed, cf #2/#3 lifted to spec. Cat VII NEXT in spike order.*

*Author: Brain — 2026-05-14. Inputs: spike `[commit placeholder]`. Branch: `master`.*
