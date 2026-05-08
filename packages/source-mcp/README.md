# @pipeline-kit/source-mcp

Source adapter for consuming any MCP tool output as a Source<O>. Auto-derives a Zod schema from the MCP tool's output schema if `schema` is not provided.

## Install

```bash
pnpm add @pipeline-kit/source-mcp
```

`@modelcontextprotocol/sdk` is bundled as a direct dependency.

## Usage

```typescript
import { createMcpToolSource } from '@pipeline-kit/source-mcp';
import { z } from 'zod';

const mcp = createMcpToolSource({
  serverUrl: 'http://localhost:3001/mcp',
  toolName: 'list_orders',
  args: { status: 'pending' },
  schema: z.object({ id: z.string(), total: z.number() }),
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
