# @idriszade/process-classify

Process adapter for label classification of pipeline atoms — rule-based or LLM-backed.

## Install

```bash
pnpm add @idriszade/process-classify
```

Optional peer dependency (only required for `mode: 'llm'`):
- `@idriszade/process-extract`

## Usage

```typescript
import { createClassifyProcess } from '@idriszade/process-classify';

const classify = createClassifyProcess<{ description: string }>({
  mode: 'rules',
  categories: ['urgent', 'normal'],
  rules: [
    { field: 'description', match: 'contains', value: 'urgent', category: 'urgent' },
  ],
  defaultCategory: 'normal',
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
