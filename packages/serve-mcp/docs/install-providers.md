# `@pipeline-kit/serve-mcp` — Provider wiring

## ADR22: Library, not runtime

`@pipeline-kit/serve-mcp` exposes a tool **registration object** that you wire
into your own MCP `Server`. It does **not** spawn or own an MCP runtime. The
durable runtime — process supervision, transport selection, lifecycle — is
the application's concern, not the kit's. This keeps pipeline-kit a library
you compose, not a server you inherit.

## Requirements

The package depends on `@modelcontextprotocol/sdk` (already a direct
dependency). You build the `Server` instance yourself and attach pipeline-kit
tool registrations to it.

## Example

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMcpToolServe } from '@pipeline-kit/serve-mcp';

// 1. Build your pipeline (source -> ... -> terminal)
declare const myPipeline: import('@pipeline-kit/core').TerminalPipeline<{
  reply: string;
}>;

// 2. Create the Serve / tool registration
const serve = createMcpToolServe({
  toolName: 'my_tool',
  description: 'Runs the pipeline and returns the reply.',
  inputSchema: z.object({ msg: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  pipeline: myPipeline,
});

// 3. Wire into your MCP Server
const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: serve.toolRegistration.name,
      description: serve.toolRegistration.description,
      inputSchema: serve.toolRegistration.inputSchema,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === serve.toolRegistration.name) {
    return await serve.toolRegistration.handler(request.params.arguments ?? {});
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// 4. Connect a transport — your choice (stdio / SSE / streaming HTTP)
await server.connect(new StdioServerTransport());
```

## Notes

- `idempotencySupport` is `'unsupported'` — MCP tool calls do not carry
  idempotency keys.
- The handler validates input against your Zod schema before invoking the
  pipeline. Validation failures return `{ isError: true }` with a message,
  never throw.
- Pipeline errors are surfaced as `{ isError: true }` from the handler and
  as `{ type: 'unknown', code: 'pipeline_error' }` from `serve.emit()`.
- Multiple tools can share one `Server`: build one `createMcpToolServe`
  per tool and dispatch on `request.params.name` in `CallToolRequestSchema`.
