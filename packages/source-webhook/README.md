# @idriszade/source-webhook

Source adapter for receiving inbound webhooks via Hono — exposes a pre-wired Hono `app` and a raw web-standards `(req: Request) => Promise<Response>` handler. Verifies HMAC signatures via core's `verify()`.

## Install

```bash
pnpm add @idriszade/source-webhook
```

`hono` and `@hono/zod-validator` are bundled as direct dependencies. Mount `app` (or `handler`) on Node, Bun, Cloudflare Workers, Vercel Edge, or Lambda.

## Usage

```typescript
import { createWebhookSource } from '@idriszade/source-webhook';
import { z } from 'zod';

const webhook = createWebhookSource({
  path: '/webhooks/orders',
  secret: process.env.WEBHOOK_SECRET!,
  schema: z.object({ orderId: z.string(), total: z.number() }),
});

// In your server: webhook.app  (Hono)  or  webhook.handler  (raw fetch)
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
