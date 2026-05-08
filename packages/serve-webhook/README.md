# @pipeline-kit/serve-webhook

Serve adapter for dispatching outbound webhook payloads with HMAC-SHA256 signing (Stripe-canon `X-Pipeline-Kit-Signature` header), SSRF guard, and four auth modes.

## Install

```bash
pnpm add @pipeline-kit/serve-webhook
```

## Usage

```typescript
import { createWebhookServe } from '@pipeline-kit/serve-webhook';
import { z } from 'zod';

const webhook = createWebhookServe({
  url: 'https://example.com/hooks/orders',
  secret: process.env.WEBHOOK_SECRET!,
  auth: 'hmac',
  schema: z.object({ orderId: z.string(), total: z.number() }),
});
```

Auth modes: `hmac` (default), `bearer`, `apiKey`, `basic`, `none`.

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
