# @pipeline-kit/source-apify

Source adapter for ingesting Apify Actor run results — launches the actor, polls for completion, and emits dataset items as Atoms.

## Install

```bash
pnpm add @pipeline-kit/source-apify
```

`apify-client` is bundled as a direct dependency.

## Usage

```typescript
import { createApifySource } from '@pipeline-kit/source-apify';
import { z } from 'zod';

const apify = createApifySource({
  actorId: 'apify/web-scraper',
  input: { startUrls: [{ url: 'https://example.com' }] },
  apifyToken: process.env.APIFY_TOKEN!,
  schema: z.object({ url: z.string(), title: z.string() }),
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
