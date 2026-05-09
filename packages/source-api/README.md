# @idriszade/source-api

Source adapter for polling and streaming HTTP/REST APIs — supports cursor / offset / page pagination plus bearer / API-key / basic auth.

## Install

```bash
pnpm add @idriszade/source-api
```

## Usage

```typescript
import { createApiSource } from '@idriszade/source-api';
import { z } from 'zod';

const api = createApiSource({
  baseUrl: 'https://api.example.com',
  endpoint: '/v1/orders',
  auth: { type: 'bearer', value: process.env.API_TOKEN! },
  paginate: { type: 'cursor', cursorField: 'next_cursor', cursorParam: 'cursor' },
  schema: z.object({ id: z.string(), total: z.number() }),
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
