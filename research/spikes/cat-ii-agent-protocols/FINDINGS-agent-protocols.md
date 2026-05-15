# Cat II Spike — Agent Protocols & MCP Composition

> Spike: agent-as-process-composition
> Commit: 4695053
> Cells: 3 (A: agent-as-process, B: mcp-composition, C: multi-agent-handoff)
> Friction anchor: F-AGENT (catalog #12; 3/9 projects)

## Headline verdict

`Process<I,O>` holds completely for agents. Multi-turn agentic loops, MCP
composition, multi-agent handoffs, A2A protocol exposure, and stateful sessions
all map to existing kit primitives without requiring a new stage type. "Agent"
is a named pattern on `Process<I,O>` — exactly as Gate and Aggregate were
(Cat VI ADR-VI-1).

## Cell A findings (agent-as-process)

### O1 — Anthropic-style agentic loop

The entire multi-turn loop (tool_use → execute → re-send → end_turn) lives
inside the async function body of a `Process<AgentInput, ExtractOutput>`. The
Composer sees exactly one `Promise<Result<O,E>>`. Intermediate turns, message
history growth, and tool execution are all internal state — invisible at the
stage boundary. Ground truth: Anthropic Claude SDK agentic loop pattern.
VERDICT: PASS.

### O2 — Streaming intermediates vs. final result

Kit's `Process<I,O>` maps to Vercel AI SDK's `generateText` (final structured
result), NOT `streamText`. Streaming tokens are observer side effects via
`ctx.deps.observer?.onToken(chunk)` — they do not mutate the Process signature.
If streaming IS the output (live display), `StreamingProcess<I,O> = (atom, ctx)
=> AsyncIterable<O>` is a named variant at Serve/Source-tier. For structured
extraction, final result suffices. VERDICT: PASS.

### O3 — AbortSignal threading

`ctx.signal` threads naturally through the turn loop via early-return check per
turn. Matches Anthropic SDK's per-request AbortSignal pattern. No new
cancellation primitive needed. VERDICT: PASS.

### O4 — Tool calls as internal side effects

MCP tool calls mid-agent-loop consume `ctx.deps.mcpClient` — deps, not stage
composition. Composer does not see them. Mirrors OpenAI Agents SDK `Runner.run()`
where tool execution is internal to the runner. Cat VIII deps-shape composes
cleanly here. VERDICT: PASS.

### O5 — Agent-as-Process named pattern

`AgentProcess<I,O>` is a type alias on `Process<I & AgentInput, O &
ExtractOutput>` — naming convention, not a new type. Assignable to core Process
with zero coercion. Gate/Aggregate precedent from Cat VI ADR-VI-1 applies.
VERDICT: PASS.

### Unexpected friction

None structural. One open question: should `maxTurns` be a per-Process
constructor option or a Composer-level guard? (carry-forward #1)

## Cell B findings (mcp-composition)

### O1 — Source-MCP reads resource

`Source<MCPResource>` wraps `mcpClient.readResource(uri)` and emits
`Atom<MCPResource>`. MCP Resources (read-only URIs) map cleanly to Source —
both pull-based, stateless, typed. No new primitive. VERDICT: PASS.

### O2 — Agent-Process transforms MCP resource

`Process<MCPResource, StructuredResult>` receives resource content, runs agent
loop internally, returns structured output. MCP content variant narrowing
(text | blob) is a trivial internal step. VERDICT: PASS.

### O3 — Serve-MCP as MCP tool handler

`Serve<StructuredResult>` registers as an MCP tool handler at construction time
and writes atom data to the MCP response channel. The pipeline IS the tool
implementation. Per Cat IX ADR-IX-5: adapter-tier concern. VERDICT: PASS.

### O4 — End-to-end type chain

`ComposerChain<MCPResource, MCPResource, StructuredResult, StructuredResult>`
is non-`never` at compile time — structural proof that the chain aligns without
coercion. VERDICT: PASS.

### O5 — MCP Prompts pattern

MCP Prompts map to `Source<MCPPromptOutput>` — a Source that calls
`mcpClient.getPrompt()` and emits the resolved message array. Same pattern as
any template-sourced atom. VERDICT: PASS.

### Unexpected friction

MCP blob content (`{ blob: string }` — base64 binary) requires decoding before
agent can process. Warrants a `decodeMCPContent` utility helper. Low severity.
(carry-forward #2)

## Cell C findings (multi-agent-handoff)

### O1 — Agent handoff = through-chain

OpenAI Agents SDK's Handoff → `.through(agentA).through(agentB)`. Agent A's
output type IS agent B's input type; Composer chain IS the handoff. Type
constraint enforced at compile time. VERDICT: PASS.

### O2 — Protocol choice is Process-internal

Anthropic SDK, OpenAI SDK, Google A2A HTTP POST all produce `Process<I,O>` at
the Composer boundary. Protocol = implementation detail inside async function
body. Same principle as Cat IX ADR-IX-5. VERDICT: PASS.

### O3 — A2A as Serve adapter

Google A2A Task intake = `Source<A2ATask>`. A2A output = `Serve<FinalResult>`.
Pipeline IS the A2A agent. Agent Card discovery is pre-pipeline HTTP metadata —
not a stage. Matches Cat IX ADR-IX-5. VERDICT: PASS.

### O4 — Session state via MemoryAdapter

`ctx.deps.memory` keyed by `sessionId` (Cat V ADR-V-1). Within-turn state =
local variable. Probe confirmed behaviorally: Run 1 sees `priorContext: null`,
Run 2 sees prior run data. No new primitive. VERDICT: PASS.

### O5 — Agent fan-out via kitFanOut

`kitFanOut([agentP1, agentP2, agentP3], input)` per Cat IV ADR-IV-7. Stub is
8 lines. Agent fan-out is not special. VERDICT: PASS.

### O6 — Reviewable gate between agents

`.through(agentA).review(hrpConfig).through(agentB)`. Reviewable is
`Process<T,T>` per Cat VI ADR-VI-7. HRP does not know it sits between agents.
VERDICT: PASS.

### Unexpected friction

None structural. Open question: when Reviewable sits between agents, the
reviewer sees raw `Atom<IntermediateResult>` — synthesis should clarify whether
a rendering transform is applied before HRP review. (carry-forward #3)

## Pre-answered confirmation matrix

| Question | Pre-answered by | Confirmed? | Notes |
|---|---|---|---|
| Q1: Agent-as-Process | Cat VI ADR-VI-1 | YES | Named pattern; O1-O5 all PASS |
| Q2: MCP composition | Cat IX ADR-IX-5 | YES | Source+Serve adapters; O1-O5 all PASS |
| Q3: Multi-agent orchestration | Cat IV ADR-IV-1+7 | YES | Handoff = through-chain; fan-out = kitFanOut |
| Q4: Protocol interop | Cat IX ADR-IX-5 | YES | Protocol = Process-internal; O2 PASS |
| Q5: Stateful sessions | Cat V ADR-V-1 | YES | deps.memory + sessionId key; O4 PASS |

## Carry-forwards

1. **Max-turn configuration** — `maxTurns` as per-Process constructor option
   vs. Composer-level guard. Lean per-agent with Composer override.
2. **MCP blob content utility** — `decodeMCPContent` helper for base64 blob
   to processable string. Include in MCP adapter package.
3. **Reviewable gate rendering** — clarify whether a rendering transform is
   applied to `Atom<IntermediateResult>` before HRP review.
4. **StreamingProcess named variant** — confirm v1 or defer to v2 scope.
5. **A2A Agent Card boundary** — confirm Agent Card discovery is pre-pipeline
   setup (not a stage) in synthesis ADR.

## ADR direction signal

All five pre-answered questions confirmed. Cat II synthesis ADRs should be thin
— recording confirmation with rationale, not resolving new controversies.

Suggested structure:
- **ADR-II-1**: Agent = named pattern on `Process<I,O>`; no new stage type.
  Cite Cat VI ADR-VI-1. Record `AgentProcess<I,O>` convention.
- **ADR-II-2**: MCP Source/Serve adapters; MCP Prompts = Source variant.
  Cite Cat IX ADR-IX-5.
- **ADR-II-3**: Multi-agent handoff = through-chain; protocol interop =
  Process-internal; A2A = Serve adapter. Cite Cat IV ADR-IV-1+7 + Cat IX.
- **ADR-II-4**: Session state = MemoryAdapter keyed by sessionId. Cite Cat V.
  Close carry-forward #5 (Agent Card boundary).
- **ADR-II-5**: Resolve carry-forward #1 (max-turn config) and #4
  (StreamingProcess scope).
