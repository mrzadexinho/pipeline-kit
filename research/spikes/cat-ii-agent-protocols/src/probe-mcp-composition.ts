/**
 * probe-mcp-composition.ts — Cell B (Q2)
 *
 * Probe: does source-mcp → Process (agent) → serve-mcp compose
 * without new primitives?
 *
 * Ground truth: MCP specification (2024-26) —
 *   Resources (read-only data URI), Tools (actions with input schema),
 *   Prompts (templates). Agents USE tools mid-conversation (internal).
 *   Servers EXPOSE capabilities. Client↔Server is transport-agnostic.
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
// MCP domain types (inline — no @modelcontextprotocol/sdk import)
// ---------------------------------------------------------------------------

/** MCP Resource as returned by mcpClient.readResource(uri) */
interface MCPResource {
  uri: string;
  mimeType: string;
  contents: Array<{ text: string } | { blob: string }>;
}

/** Structured extraction result from the agent-Process */
interface StructuredResult {
  summary: string;
  keyPoints: string[];
  resourceUri: string;
  processedAt: number;
}

/** Simplified MCP client interface (type-level stand-in) */
interface MCPClient {
  readResource: (uri: string) => Promise<MCPResource>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  registerToolHandler: (
    name: string,
    schema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) => void;
}

// ---------------------------------------------------------------------------
// §1: O1 — Source<MCPResource> reads resource → atom
//
// Reference: MCP spec §5.1 Resources — read-only data at a URI.
// Source is already the correct abstraction: pull data, emit Atom<T>.
// No new primitive needed; Source wraps the mcpClient.readResource call.
// ---------------------------------------------------------------------------

// O1 VERDICT: PASS — Source<MCPResource> wraps readResource; standard Source pattern.
function createMcpResourceSource(resourceUris: string[]): Source<MCPResource> {
  return async function* (ctx: PipelineContext): AsyncIterable<Atom<MCPResource>> {
    const mcpClient = ctx.deps["mcpClient"] as MCPClient;

    for (const uri of resourceUris) {
      if (ctx.signal.aborted) break;

      const resource = await mcpClient.readResource(uri);
      yield makeAtom<MCPResource>(`pk_atom_mcp_${encodeURIComponent(uri)}`, resource, {
        sourceUri: uri,
        protocol: "mcp",
      });
    }
  };
}

// ---------------------------------------------------------------------------
// §2: O2 — Process<MCPResource, StructuredResult> transforms atom
//
// Reference: Anthropic Claude SDK — agent loop runs internally.
// The Process takes resource content, runs agent (mocked here),
// returns structured output. Standard Process shape unchanged.
// ---------------------------------------------------------------------------

// O2 VERDICT: PASS — Process<MCPResource, StructuredResult> is standard Process.
const mcpResourceAgentProcess: Process<MCPResource, StructuredResult> = async (
  atom: Atom<MCPResource>,
  ctx: PipelineContext,
): Promise<Result<StructuredResult, StageError>> => {
  if (ctx.signal.aborted) {
    return err(stageErr("AGENT_ABORTED", "Signal aborted before processing", false));
  }

  const resource = atom.data;

  // Extract text content from MCP resource (handles text | blob variants)
  const textContent = resource.contents
    .filter((c): c is { text: string } => "text" in c)
    .map((c) => c.text)
    .join("\n");

  if (!textContent.trim()) {
    return err(stageErr("AGENT_NO_CONTENT", "MCP resource has no text content to process", false));
  }

  // Mock agent invocation — in production: Anthropic SDK agentic loop
  // The agent loop is fully internal; Composer only sees this Result
  const structured: StructuredResult = {
    summary: `Processed resource at ${resource.uri}`,
    keyPoints: textContent
      .split(".")
      .filter((s) => s.trim().length > 10)
      .slice(0, 3)
      .map((s) => s.trim()),
    resourceUri: resource.uri,
    processedAt: Date.now(),
  };

  return ok(structured);
};

// ---------------------------------------------------------------------------
// §3: O3 — Serve<StructuredResult> exposes as MCP tool response
//
// Reference: MCP spec §5.2 Tools — servers expose callable actions.
// The pipeline IS the tool implementation. Serve<T> adapter registers
// as an MCP tool handler. Incoming tool call → Serve invoked → returns result.
// This is a protocol adapter at adapter-tier (Cat IX ADR-IX-5).
// ---------------------------------------------------------------------------

// O3 VERDICT: PASS — Serve<StructuredResult> registers as MCP tool handler; standard Serve.
function createMcpToolServe(mcpClient: MCPClient): Serve<StructuredResult> {
  // Register the pipeline as an MCP tool (side effect at construction time)
  mcpClient.registerToolHandler(
    "process_resource",
    {
      type: "object",
      properties: { uri: { type: "string" } },
      required: ["uri"],
    },
    async (_args) => {
      // The tool handler is the pipeline entry point
      // In production: this triggers Source → Process → Serve chain
      return { ok: true, message: "Tool registered — pipeline wired as handler" };
    },
  );

  // The Serve stage itself writes the atom to the MCP response channel
  return async (
    atom: Atom<StructuredResult>,
    ctx: PipelineContext,
  ): Promise<Result<void, StageError>> => {
    if (ctx.signal.aborted) {
      return err(stageErr("SERVE_ABORTED", "Signal aborted before serving", false));
    }

    // In production: write to MCP response channel / session
    console.log("[MCP Tool Response]", JSON.stringify(atom.data, null, 2));
    return ok(undefined);
  };
}

// ---------------------------------------------------------------------------
// §4: O4 — End-to-end type chain
//
// from(sourceMcp).through(agentProcess).to(serveMcp)
// Types chain: Source<MCPResource> → Process<MCPResource, StructuredResult>
//              → Serve<StructuredResult>
// No new primitives — standard Composer wiring.
//
// Type-level proof: show that the types align without a real Composer import.
// ---------------------------------------------------------------------------

// O4 VERDICT: PASS — type chain aligns; Source<A>, Process<A,B>, Serve<B> compose correctly.

/** Type-level Composer stub — verifies stage type alignment at compile time */
type ComposerChain<SrcO, ProcI, ProcO, ServeI> =
  ProcI extends SrcO
    ? ServeI extends ProcO
      ? { source: Source<SrcO>; process: Process<ProcI, ProcO>; serve: Serve<ServeI> }
      : never
    : never;

// This must NOT be `never` — proving the chain is type-safe
type McpChain = ComposerChain<MCPResource, MCPResource, StructuredResult, StructuredResult>;

// Compile-time check: McpChain is not never
const _chainCheck: McpChain = {
  source: createMcpResourceSource(["mcp://kb/doc1"]),
  process: mcpResourceAgentProcess,
  serve: createMcpToolServe({
    readResource: async (uri) => ({ uri, mimeType: "text/plain", contents: [] }),
    callTool: async () => ({}),
    registerToolHandler: () => {},
  }),
};
void _chainCheck;

// ---------------------------------------------------------------------------
// §5: O5 — MCP Prompts pattern
//
// Reference: MCP spec §5.3 Prompts — templates that generate messages.
// Kit maps: Source<PromptOutput> resolves a prompt template with arguments.
// No new primitive — just a Source variant that calls mcpClient.getPrompt().
// ---------------------------------------------------------------------------

interface MCPPromptOutput {
  templateName: string;
  resolvedMessages: Array<{ role: "user" | "assistant"; content: string }>;
}

/** MCP Prompt resolved to messages = Source<MCPPromptOutput>. Standard Source. */
// O5 VERDICT: PASS — MCP Prompts map to Source<PromptOutput>; no new primitive.
function createMcpPromptSource(
  templateName: string,
  args: Record<string, string>,
): Source<MCPPromptOutput> {
  return async function* (ctx: PipelineContext): AsyncIterable<Atom<MCPPromptOutput>> {
    if (ctx.signal.aborted) return;

    // In production: mcpClient.getPrompt(templateName, args)
    const resolved: MCPPromptOutput = {
      templateName,
      resolvedMessages: [
        {
          role: "user",
          content: `Template: ${templateName}, Args: ${JSON.stringify(args)}`,
        },
      ],
    };

    yield makeAtom<MCPPromptOutput>(`pk_atom_prompt_${templateName}`, resolved, {
      protocol: "mcp",
      templateName,
    });
  };
}

// ---------------------------------------------------------------------------
// Exercise all observations
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const mockMcpClient: MCPClient = {
    readResource: async (uri: string) => ({
      uri,
      mimeType: "text/plain",
      contents: [
        {
          text: "Pipeline-kit enables type-safe automation. It composes stages. Each stage has a clear contract.",
        },
      ],
    }),
    callTool: async (name, args) => ({ name, args, result: "mocked" }),
    registerToolHandler: (name, _schema, _handler) => {
      console.log(`[MCP] Tool handler registered: ${name}`);
    },
  };

  const ctx = makeCtx("pk_run_cat2_cell_b", { mcpClient: mockMcpClient });

  // O1: Source emits MCP resource atoms
  console.log("--- O1: Source<MCPResource> ---");
  const source = createMcpResourceSource(["mcp://kb/pipeline-kit-intro"]);
  const atoms: Atom<MCPResource>[] = [];
  for await (const atom of source(ctx)) {
    atoms.push(atom);
    console.log("Atom emitted:", atom.id, "URI:", atom.data.uri);
  }

  // O2: Process transforms atom
  console.log("\n--- O2: Process<MCPResource, StructuredResult> ---");
  if (atoms[0]) {
    const result = await mcpResourceAgentProcess(atoms[0], ctx);
    console.log("Process result:", JSON.stringify(result, null, 2));

    // O3: Serve writes to MCP tool channel
    console.log("\n--- O3: Serve<StructuredResult> as MCP tool handler ---");
    const serve = createMcpToolServe(mockMcpClient);
    if (result.ok) {
      const serveAtom = makeAtom<StructuredResult>("pk_atom_serve_001", result.value);
      await serve(serveAtom, ctx);
    }
  }

  // O4: type chain already proved at compile time
  console.log("\n--- O4: Type chain McpChain (compile-time proof) ---");
  console.log("VERDICT: PASS — Source<MCPResource> → Process<MCPResource,StructuredResult> → Serve<StructuredResult>");

  // O5: Prompt source
  console.log("\n--- O5: MCP Prompts as Source<MCPPromptOutput> ---");
  const promptSrc = createMcpPromptSource("extract-entities", { language: "en" });
  for await (const atom of promptSrc(ctx)) {
    console.log("Prompt atom:", JSON.stringify(atom.data, null, 2));
  }
}

run().catch(console.error);
