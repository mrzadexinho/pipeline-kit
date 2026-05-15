/**
 * probe-multi-agent-handoff.ts — Cell C (Q3+Q4+Q5)
 *
 * Probe: multi-agent orchestration, protocol interop, and session state.
 *
 * Ground truth protocols:
 *   - OpenAI Agents SDK: Agent has instructions+tools+handoffs; Runner.run()
 *     returns RunResult. Handoff = agent returns Handoff object → orchestrator
 *     routes to next agent.
 *   - Google A2A: Agent Card discovery + Task (HTTP POST) with input Message
 *     → output Message + optional artifacts. Stateless; session via sessionId.
 *   - Anthropic SDK: agentic loop (see Cell A).
 *   - Cat IV ADR-IV-7: kitFanOut pattern for parallel fan-out.
 *   - Cat V ADR-V-1: MemoryAdapter for session state.
 *   - Cat VI ADR-VI-7: Reviewable gate between stages.
 */

import {
  type Atom,
  type PipelineContext,
  type Process,
  type Result,
  type Serve,
  type Source,
  type StageError,
  err,
  makeAtom,
  makeCtx,
  ok,
  stageErr,
} from "./kit-types.js";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface RawDocument {
  text: string;
  language: string;
}

interface IntermediateResult {
  extractedFacts: string[];
  documentLanguage: string;
  sessionId: string;
}

interface FinalResult {
  summary: string;
  facts: string[];
  reviewedAt: number;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// §1: O1 — Agent handoff = Composer through-chain
//
// Reference: OpenAI Agents SDK — Handoff object routes to next agent.
// Kit mapping: agentA output IS agentB input — standard .through().through().
// No routing primitive needed; Composer chain IS the handoff.
// ---------------------------------------------------------------------------

// Agent A: extracts facts from raw document
// O1 VERDICT: PASS — handoff is just type-aligned .through() chaining.
const agentA_ExtractFacts: Process<RawDocument, IntermediateResult> = async (
  atom: Atom<RawDocument>,
  ctx: PipelineContext,
): Promise<Result<IntermediateResult, StageError>> => {
  if (ctx.signal.aborted) {
    return err(stageErr("AGENT_A_ABORTED", "Agent A aborted", false));
  }
  // Mock Anthropic SDK internal agentic loop
  const facts = atom.data.text
    .split(".")
    .filter((s) => s.trim().length > 5)
    .map((s) => s.trim());

  return ok({
    extractedFacts: facts,
    documentLanguage: atom.data.language,
    sessionId: atom.metadata["sessionId"] as string ?? `sess_${ctx.runId}`,
  });
};

// Agent B: summarises extracted facts (receives agentA's output directly)
const agentB_Summarise: Process<IntermediateResult, FinalResult> = async (
  atom: Atom<IntermediateResult>,
  ctx: PipelineContext,
): Promise<Result<FinalResult, StageError>> => {
  if (ctx.signal.aborted) {
    return err(stageErr("AGENT_B_ABORTED", "Agent B aborted", false));
  }
  // Mock OpenAI SDK internal call (different SDK, same Process shape)
  return ok({
    summary: `Summary of ${atom.data.extractedFacts.length} facts from ${atom.data.documentLanguage} document.`,
    facts: atom.data.extractedFacts,
    reviewedAt: Date.now(),
    sessionId: atom.data.sessionId,
  });
};

// Type proof: both agents compose as standard Process chain
// ComposerChain<RawDocument, RawDocument, IntermediateResult, IntermediateResult, FinalResult>
// is expressible as: from(source).through(agentA).through(agentB).to(serve)

// ---------------------------------------------------------------------------
// §2: O2 — Protocol choice is Process-internal
//
// Reference: Anthropic SDK (agentA), OpenAI SDK (agentB), A2A HTTP (agentC).
// Composer sees all three as Process<I,O>. Protocol = impl detail.
// ---------------------------------------------------------------------------

interface A2ATaskInput {
  messageText: string;
  sessionId: string;
}

interface A2ATaskOutput {
  responseText: string;
  artifacts: string[];
}

// O2 VERDICT: PASS — three different protocols, identical Process<I,O> shape.
// agentA uses Anthropic (mocked above), agentB uses OpenAI (mocked above).
// agentC uses A2A HTTP POST — protocol is an implementation detail.
const agentC_A2AProtocol: Process<A2ATaskInput, A2ATaskOutput> = async (
  atom: Atom<A2ATaskInput>,
  ctx: PipelineContext,
): Promise<Result<A2ATaskOutput, StageError>> => {
  if (ctx.signal.aborted) {
    return err(stageErr("AGENT_C_ABORTED", "Agent C (A2A) aborted", false));
  }

  // In production: HTTP POST to A2A agent endpoint per Google A2A spec §3.
  // Task: { id, sessionId, input: { role: "user", parts: [{ text }] } }
  // Response: { output: { role: "agent", parts: [{ text }] }, artifacts: [] }
  // All of this is INTERNAL — Composer only sees the final Result.
  const mockA2AResponse: A2ATaskOutput = {
    responseText: `A2A agent processed: ${atom.data.messageText}`,
    artifacts: ["artifact_001"],
  };

  return ok(mockA2AResponse);
};

// Prove all three are assignable to the same Process<I,O> shape
type AnyAgentProcess<I, O> = Process<I, O>;
const _agentACheck: AnyAgentProcess<RawDocument, IntermediateResult> = agentA_ExtractFacts;
const _agentBCheck: AnyAgentProcess<IntermediateResult, FinalResult> = agentB_Summarise;
const _agentCCheck: AnyAgentProcess<A2ATaskInput, A2ATaskOutput> = agentC_A2AProtocol;
void _agentACheck; void _agentBCheck; void _agentCCheck;

// ---------------------------------------------------------------------------
// §3: O3 — A2A as Serve adapter (exposing pipeline as agent)
//
// Reference: Google A2A spec — Agent Card (JSON) describes capabilities;
// Task handling via HTTP POST. The pipeline IS the A2A agent.
// Incoming A2A Task → Source. Response → Serve.
// Per Cat IX ADR-IX-5: protocol adapters live at adapter-tier.
// ---------------------------------------------------------------------------

interface A2ATask {
  id: string;
  sessionId: string;
  input: { role: "user"; parts: Array<{ text: string }> };
}

// O3 VERDICT: PASS — A2A Task intake = Source<A2ATask>; response = Serve<FinalResult>.
// The pipeline IS the A2A agent. Standard Source+Serve adapter pattern.

/** Source that receives an A2A task (e.g. from HTTP handler) */
function createA2ATaskSource(task: A2ATask): Source<A2ATask> {
  return async function* (ctx: PipelineContext): AsyncIterable<Atom<A2ATask>> {
    if (ctx.signal.aborted) return;
    yield makeAtom<A2ATask>(`pk_atom_a2a_${task.id}`, task, {
      sessionId: task.sessionId,
      protocol: "a2a",
    });
  };
}

/** Serve that writes response as A2A Task output (HTTP response body) */
const a2aResponseServe: Serve<FinalResult> = async (
  atom: Atom<FinalResult>,
  ctx: PipelineContext,
): Promise<Result<void, StageError>> => {
  if (ctx.signal.aborted) {
    return err(stageErr("SERVE_ABORTED", "A2A serve aborted", false));
  }
  // In production: write to HTTP response as A2A Task output envelope
  const a2aResponse = {
    id: atom.id,
    sessionId: atom.data.sessionId,
    output: {
      role: "agent",
      parts: [{ text: atom.data.summary }],
    },
    artifacts: atom.data.facts.map((f, i) => ({ id: `art_${i}`, text: f })),
  };
  console.log("[A2A Response]", JSON.stringify(a2aResponse, null, 2));
  return ok(undefined);
};

// ---------------------------------------------------------------------------
// §4: O4 — Session state via MemoryAdapter (Cat V ADR-V-1)
//
// Reference: Cat V ADR-V-1 — MemoryAdapter provides cross-run state.
// Within a single Process call: local variable (no new primitive).
// Across pipeline runs: deps.memory read/write with sessionId key.
// Session affinity = memory key includes sessionId.
// ---------------------------------------------------------------------------

interface MemoryAdapter {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

// O4 VERDICT: PASS — session state = deps.memory keyed by sessionId; Cat V ADR-V-1 sufficient.
const agentWithSessionState: Process<RawDocument, FinalResult> = async (
  atom: Atom<RawDocument>,
  ctx: PipelineContext,
): Promise<Result<FinalResult, StageError>> => {
  const memory = ctx.deps["memory"] as MemoryAdapter | undefined;
  const sessionId = atom.metadata["sessionId"] as string ?? `sess_default`;

  // Read prior session context (cross-run state via MemoryAdapter)
  const priorContext = memory ? await memory.get(`session:${sessionId}:context`) : null;

  // Within-turn state: local variable (no new primitive)
  const turnContext = {
    priorContext,
    currentInput: atom.data.text,
    turnNumber: 1,
  };

  // Mock agent run using session context
  const result: FinalResult = {
    summary: `Run with prior context: ${priorContext !== null}. Input: ${turnContext.currentInput.slice(0, 50)}`,
    facts: [`Turn ${turnContext.turnNumber}`, `Session: ${sessionId}`],
    reviewedAt: Date.now(),
    sessionId,
  };

  // Persist updated context for next run
  if (memory) {
    await memory.set(`session:${sessionId}:context`, {
      lastRun: ctx.runId,
      factCount: result.facts.length,
    });
  }

  return ok(result);
};

// ---------------------------------------------------------------------------
// §5: O5 — Agent fan-out via kitFanOut (Cat IV ADR-IV-7)
//
// Reference: Cat IV ADR-IV-7 — kitFanOut for parallel fan-out.
// "Ask 3 agents in parallel, merge results" = kitFanOut([agentA, agentB, agentC], input).
// Agent fan-out is not special — same fan-out pattern as any Process fan-out.
// ---------------------------------------------------------------------------

/** Minimal kitFanOut stub — mirrors Cat IV ADR-IV-7 shape */
async function kitFanOut<I, O>(
  processes: Array<Process<I, O>>,
  atom: Atom<I>,
  ctx: PipelineContext,
): Promise<Result<O[], StageError>> {
  const results = await Promise.all(processes.map((p) => p(atom, ctx)));
  const errors = results.filter((r): r is { ok: false; error: StageError } => !r.ok);
  const firstError = errors[0];
  if (firstError !== undefined) {
    return err(firstError.error);
  }
  return ok(results.map((r) => (r as { ok: true; value: O }).value));
}

// O5 VERDICT: PASS — agent fan-out is kitFanOut([agentP1, agentP2, agentP3]).
// No special AgentFanOut primitive needed. Cat IV ADR-IV-7 covers this.

// ---------------------------------------------------------------------------
// §6: O6 — Reviewable gate between agents (Cat VI ADR-VI-7)
//
// Reference: Cat VI ADR-VI-7 — Reviewable sits between stages.
// Agent A → HRP review → Agent B = .through(agentA).review(hrpConfig).through(agentB).
// HRP doesn't know they're agents — it reviews Atom<IntermediateResult>.
// ---------------------------------------------------------------------------

/** Minimal HRP (Human Review Protocol) gate stub */
interface HRPConfig {
  reviewerId: string;
  timeoutMs: number;
}

/** Reviewable gate: Process<I,I> that may block for human approval */
function createReviewableGate<T>(_config: HRPConfig): Process<T, T> {
  // O6 VERDICT: PASS — Reviewable is Process<T,T>; sits between any two stages.
  // Per Cat VI ADR-VI-7: gate is a named Process pattern, not a new stage type.
  return async (
    atom: Atom<T>,
    ctx: PipelineContext,
  ): Promise<Result<T, StageError>> => {
    if (ctx.signal.aborted) {
      return err(stageErr("REVIEW_ABORTED", "Review gate aborted", false));
    }
    // Mock: HRP approves immediately (in production: async approval wait)
    console.log(`[HRP Review] Atom ${atom.id} submitted for review by ${_config.reviewerId}`);
    // Pass atom through unchanged — reviewer approved
    return ok(atom.data);
  };
}

// ---------------------------------------------------------------------------
// Exercise all observations
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const mockMemory: MemoryAdapter = (() => {
    const store = new Map<string, unknown>();
    return {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => { store.set(key, value); },
    };
  })();

  const ctx = makeCtx("pk_run_cat2_cell_c", { memory: mockMemory });

  const docAtom = makeAtom<RawDocument>("pk_atom_doc_001", {
    text: "Pipeline-kit is a typed-stage library. It supports agents. It composes cleanly.",
    language: "en",
  }, { sessionId: "sess_abc123" });

  // O1: agent handoff = .through().through()
  console.log("--- O1: Agent handoff as Composer through-chain ---");
  const resultA = await agentA_ExtractFacts(docAtom, ctx);
  if (resultA.ok) {
    const intermediateAtom = makeAtom<IntermediateResult>("pk_atom_intermediate_001", resultA.value);
    const resultB = await agentB_Summarise(intermediateAtom, ctx);
    console.log("Handoff chain result:", JSON.stringify(resultB, null, 2));
  }

  // O2: protocol-internal (A2A probe)
  console.log("\n--- O2: A2A protocol as Process-internal ---");
  const a2aAtom = makeAtom<A2ATaskInput>("pk_atom_a2a_input_001", {
    messageText: "Analyse pipeline-kit documentation",
    sessionId: "sess_abc123",
  });
  const a2aResult = await agentC_A2AProtocol(a2aAtom, ctx);
  console.log("A2A Process result:", JSON.stringify(a2aResult, null, 2));

  // O3: A2A pipeline exposure
  console.log("\n--- O3: A2A as Serve adapter (pipeline exposed as A2A agent) ---");
  const a2aTask: A2ATask = {
    id: "task_001",
    sessionId: "sess_abc123",
    input: { role: "user", parts: [{ text: "Analyse this document" }] },
  };
  const taskSource = createA2ATaskSource(a2aTask);
  for await (const taskAtom of taskSource(ctx)) {
    const finalAtom = makeAtom<FinalResult>("pk_atom_final_001", {
      summary: "A2A processed document",
      facts: ["fact_1", "fact_2"],
      reviewedAt: Date.now(),
      sessionId: taskAtom.data.sessionId,
    });
    await a2aResponseServe(finalAtom, ctx);
  }

  // O4: session state via MemoryAdapter
  console.log("\n--- O4: Session state via MemoryAdapter (Cat V ADR-V-1) ---");
  const run1 = await agentWithSessionState(docAtom, ctx);
  console.log("Run 1 (no prior context):", run1.ok ? run1.value.summary : run1.error.message);
  const run2 = await agentWithSessionState(docAtom, makeCtx("pk_run_cat2_cell_c_2", { memory: mockMemory }));
  console.log("Run 2 (with prior context):", run2.ok ? run2.value.summary : run2.error.message);

  // O5: agent fan-out
  console.log("\n--- O5: Agent fan-out via kitFanOut (Cat IV ADR-IV-7) ---");
  type SimpleOutput = { label: string };
  const agentP1: Process<RawDocument, SimpleOutput> = async (a) => ok({ label: `P1:${a.data.language}` });
  const agentP2: Process<RawDocument, SimpleOutput> = async (a) => ok({ label: `P2:${a.data.text.length}` });
  const agentP3: Process<RawDocument, SimpleOutput> = async (a) => ok({ label: `P3:${a.id}` });
  const fanOutResult = await kitFanOut([agentP1, agentP2, agentP3], docAtom, ctx);
  console.log("Fan-out result:", JSON.stringify(fanOutResult, null, 2));

  // O6: Reviewable gate between agents
  console.log("\n--- O6: Reviewable gate between Agent A and Agent B ---");
  const hrpGate = createReviewableGate<IntermediateResult>({
    reviewerId: "reviewer_001",
    timeoutMs: 30_000,
  });
  const resultA2 = await agentA_ExtractFacts(docAtom, ctx);
  if (resultA2.ok) {
    const preReviewAtom = makeAtom<IntermediateResult>("pk_atom_pre_review_001", resultA2.value);
    const reviewResult = await hrpGate(preReviewAtom, ctx);
    if (reviewResult.ok) {
      const postReviewAtom = makeAtom<IntermediateResult>("pk_atom_post_review_001", reviewResult.value);
      const finalResult = await agentB_Summarise(postReviewAtom, ctx);
      console.log("Post-review final:", JSON.stringify(finalResult, null, 2));
    }
  }
}

run().catch(console.error);
