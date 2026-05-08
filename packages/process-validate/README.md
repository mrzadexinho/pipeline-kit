# @pipeline-kit/process-validate

Process adapter for schema-driven validation of pipeline atoms via Zod — supports `coerce` (boundary recovery) and `strict` modes.

## Install

```bash
pnpm add @pipeline-kit/process-validate
```

## Usage

```typescript
import { createValidateProcess } from '@pipeline-kit/process-validate';
import { z } from 'zod';

const validate = createValidateProcess({
  schema: z.object({ id: z.string(), amount: z.number() }),
  mode: 'coerce',
  onCoerce: (path, original, fallback) => {
    console.warn(`coerced ${path}: ${original} -> ${fallback}`);
  },
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
