# @idriszade/serve-mcp

Serve adapter for exposing a TerminalPipeline as an MCP tool — userland wires the returned `toolRegistration` into its own MCP `Server` instance.

## Install

```bash
pnpm add @idriszade/serve-mcp
```

Peer dependency:
- `@modelcontextprotocol/sdk`

## Usage

```typescript
import { createMcpToolServe } from '@idriszade/serve-mcp';
import { z } from 'zod';

const tool = createMcpToolServe({
  toolName: 'summarize_ticket',
  description: 'Summarize a support ticket via the kit pipeline',
  inputSchema: z.object({ ticketId: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  pipeline: terminalPipeline,
});

// Register tool.toolRegistration with your MCP server.
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
