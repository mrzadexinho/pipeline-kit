# @idriszade/process-extract

Process adapter for LLM-powered structured data extraction with Zod schema validation and JSON-schema auto-derivation.

## Install

```bash
pnpm add @idriszade/process-extract
```

Peer dependencies (install whichever provider you use):
- `openai`
- `@anthropic-ai/sdk`
- `@google/generative-ai`

## Usage

```typescript
import { createExtractProcess } from '@idriszade/process-extract';
import { z } from 'zod';

const extract = createExtractProcess({
  provider: 'openai',
  model: 'gpt-4o-mini',
  prompt: (input: { text: string }) => `Extract entities from: ${input.text}`,
  outputSchema: z.object({ name: z.string(), email: z.string().email() }),
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
