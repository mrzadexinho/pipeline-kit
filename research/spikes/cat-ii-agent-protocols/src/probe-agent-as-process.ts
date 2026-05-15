/**
 * probe-agent-as-process.ts — Cell A (Q1)
 *
 * Probe: does multi-turn agent invocation fit inside Process<I,O>?
 *
 * Ground truth: Anthropic Claude SDK agentic loop pattern —
 *   client.messages.create({ tools }) → check for tool_use blocks
 *   → execute tools → re-send with tool_result → repeat until text-only.
 *   The entire loop is async. Final response is structured.
 *
 * Also references: Vercel AI SDK (generateText vs streamText distinction),
 * OpenAI Agents SDK (Runner.run internal tool loop).
 */

import {
  type Atom,
  type PipelineContext,
  type Process,
  type Result,
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

/** Input to any agent-style Process: prompt + context documents */
interface AgentInput {
  prompt: string;
  contextDocs: string[];
}

/** Structured output from the agent — the final extraction result */
interface ExtractOutput {
  entities: string[];
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
}

// ---------------------------------------------------------------------------
// Mock SDK types (stand-ins for @anthropic-ai/sdk without actual import)
// ---------------------------------------------------------------------------

interface MockToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface MockTextBlock {
  type: "text";
  text: string;
}

type MockContentBlock = MockToolUseBlock | MockTextBlock;

interface MockMessage {
  id: string;
  stop_reason: "tool_use" | "end_turn" | "max_tokens";
  content: MockContentBlock[];
}

interface MockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// §1: Anthropic-style agentic loop as Process<AgentInput, ExtractOutput>
//
// Reference: Anthropic Claude SDK agentic loop pattern.
// The entire multi-turn loop is INTERNAL to the async function body.
// Composer sees ONE async call → Result<O,E>. Never sees intermediate turns.
// ---------------------------------------------------------------------------

/** Mock implementation of the Anthropic messages.create call */
async function mockMessagesCreate(
  _messages: Array<{ role: string; content: unknown }>,
  turnNumber: number,
): Promise<MockMessage> {
  // Turn 1: simulate tool_use block (search tool call)
  if (turnNumber === 1) {
    return {
      id: `msg_turn${turnNumber}`,
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu_001",
          name: "search_knowledge_base",
          input: { query: "entity extraction" },
        },
      ],
    };
  }
  // Turn 2: simulate final text response with structured JSON
  return {
    id: `msg_turn${turnNumber}`,
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          entities: ["Acme Corp", "Q4 2025"],
          sentiment: "positive",
          confidence: 0.92,
        }),
      },
    ],
  };
}

/** Execute a tool call — internal side effect within Process body */
function executeTool(block: MockToolUseBlock): MockToolResult {
  // In production: call ctx.deps.mcpClient or local tool registry
  const fakeResult =
    block.name === "search_knowledge_base"
      ? "Found 3 relevant documents about entity extraction patterns."
      : `Tool ${block.name} executed successfully.`;
  return { type: "tool_result", tool_use_id: block.id, content: fakeResult };
}

// §1: O1 — Anthropic-style agentic loop as Process<AgentInput, ExtractOutput>
// VERDICT: PASS — multi-turn loop is fully internal; Process signature unchanged.
const agentExtractProcess: Process<AgentInput, ExtractOutput> = async (
  atom: Atom<AgentInput>,
  ctx: PipelineContext,
): Promise<Result<ExtractOutput, StageError>> => {
  const { prompt, contextDocs } = atom.data;
  const maxTurns = 5;

  // Turn history grows internally — Composer never observes it
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: `${prompt}\n\nContext:\n${contextDocs.join("\n")}` },
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    // §3: O3 — AbortSignal threaded through multi-turn loop
    // Reference: Anthropic SDK AbortSignal pattern (signal passed per request)
    if (ctx.signal.aborted) {
      return err(stageErr("AGENT_ABORTED", "Agent loop aborted by caller", false));
    }

    const response = await mockMessagesCreate(messages, turn);

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b): b is MockTextBlock => b.type === "text");
      if (!textBlock) {
        return err(stageErr("AGENT_NO_TEXT", "Agent returned end_turn with no text block", false));
      }
      const parsed = JSON.parse(textBlock.text) as ExtractOutput;
      return ok(parsed);
    }

    if (response.stop_reason === "tool_use") {
      // §4: O4 — Tool calls are INTERNAL side effects
      // Reference: OpenAI Agents SDK — tool execution inside Runner.run()
      // Composer doesn't know or care; tools are deps, not stage composition.
      const toolUseBlocks = response.content.filter(
        (b): b is MockToolUseBlock => b.type === "tool_use",
      );
      const toolResults = toolUseBlocks.map(executeTool);

      // Append assistant turn + tool results to history
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    if (response.stop_reason === "max_tokens") {
      return err(stageErr("AGENT_MAX_TOKENS", "Agent hit max_tokens before completion", true));
    }
  }

  return err(stageErr("AGENT_MAX_TURNS", `Agent exceeded ${maxTurns} turns`, false));
};

// ---------------------------------------------------------------------------
// §2: O2 — Streaming intermediates vs. final result
//
// Reference: Vercel AI SDK — generateText (final) vs streamText (stream).
// Kit's Process<I,O> maps to generateText: returns final structured result.
// Streaming tokens go to observer on ctx.deps, NOT changing Process signature.
// ---------------------------------------------------------------------------

interface StreamingObserver {
  onToken: (chunk: string) => void;
  onComplete: (result: ExtractOutput) => void;
}

// O2: Process returns final result. Streaming tokens are observer side effects.
// VERDICT: PASS — streaming doesn't mutate Process<I,O> shape.
// If streaming IS the output (e.g. live display), that's a named variant:
//   StreamingProcess<I,O> = (atom, ctx) => AsyncIterable<O>
// But for structured extraction, generateText pattern (final result) suffices.
const agentExtractWithStreaming: Process<AgentInput, ExtractOutput> = async (
  atom: Atom<AgentInput>,
  ctx: PipelineContext,
): Promise<Result<ExtractOutput, StageError>> => {
  const observer = ctx.deps["observer"] as StreamingObserver | undefined;

  // Simulate streaming tokens to observer (side effect, not return value)
  const fakeTokens = ["Analyzing", " entities", "...", " done"];
  for (const token of fakeTokens) {
    observer?.onToken(token);
  }

  // Final result returned via Process signature — same shape as O1
  const result: ExtractOutput = {
    entities: ["Acme Corp"],
    sentiment: "positive",
    confidence: 0.87,
  };
  observer?.onComplete(result);
  return ok(result);
};

// ---------------------------------------------------------------------------
// §5: O5 — Agent-as-Process verdict
//
// Multi-turn agent invocation IS Process<I,O>.
// "Agent pattern" = named pattern on Process (like Gate, Aggregate in Cat VI).
// No new stage type needed.
//
// AgentProcess<I,O> = Process<AgentInput & I, AgentOutput & O>
// where AgentInput wraps prompt+context, AgentOutput is structured extraction.
//
// VERDICT: PASS — Process<I,O> is sufficient. Named convention, not new type.
// ---------------------------------------------------------------------------

/** Named pattern alias — Agent is a Process with agentic loop semantics */
type AgentProcess<I, O> = Process<I & AgentInput, O & ExtractOutput>;

// Prove the alias is assignable — agentExtractProcess satisfies AgentProcess
const _check: AgentProcess<AgentInput, ExtractOutput> = agentExtractProcess;
void _check; // suppress unused warning

// ---------------------------------------------------------------------------
// Exercise all observations
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const ctx = makeCtx("pk_run_cat2_cell_a", {
    observer: {
      onToken: (t: string) => process.stdout.write(t),
      onComplete: (r: ExtractOutput) => console.log("\nStreaming complete:", r),
    } satisfies StreamingObserver,
  });

  const atom = makeAtom<AgentInput>("pk_atom_001", {
    prompt: "Extract entities and sentiment from the following text.",
    contextDocs: ["Acme Corp reported strong Q4 2025 results, beating estimates by 15%."],
  });

  // O1: standard agentic loop
  console.log("--- O1: Agentic loop (Anthropic-style multi-turn) ---");
  const result1 = await agentExtractProcess(atom, ctx);
  console.log("Result:", JSON.stringify(result1, null, 2));

  // O2: streaming observer
  console.log("\n--- O2: Streaming observer (Vercel AI SDK generateText analogy) ---");
  const result2 = await agentExtractWithStreaming(atom, ctx);
  console.log("Result:", JSON.stringify(result2, null, 2));

  // O3: abort signal test
  console.log("\n--- O3: AbortSignal threading ---");
  const ctrl = new AbortController();
  ctrl.abort();
  const abortCtx = makeCtx("pk_run_cat2_abort", {}, ctrl.signal);
  const result3 = await agentExtractProcess(atom, abortCtx);
  console.log("Aborted result:", JSON.stringify(result3, null, 2));

  // O4: tool call side effect (already embedded in O1 — verify second result is clean)
  console.log("\n--- O4: Tool calls internal to Process (verified via O1 turn 1 tool_use) ---");
  console.log("Composer-visible output (no tool traces):", result1.ok ? "PASS" : "FAIL");

  // O5: named pattern verdict
  console.log("\n--- O5: AgentProcess<I,O> named pattern assignability ---");
  console.log("VERDICT: PASS — Process<AgentInput, ExtractOutput> satisfies AgentProcess alias");
}

run().catch(console.error);
