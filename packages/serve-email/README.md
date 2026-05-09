# @idriszade/serve-email

Serve adapter for delivering pipeline results via email — supports SMTP (Nodemailer), Postal, and Resend providers.

## Install

```bash
pnpm add @idriszade/serve-email
```

Peer dependencies (install whichever provider you use):
- `nodemailer` (SMTP)
- `resend` (Resend HTTP API)

Postal uses `fetch` and needs no extra peer dep.

## Usage

```typescript
import { createEmailServe } from '@idriszade/serve-email';

const email = createEmailServe({
  provider: 'resend',
  from: 'noreply@example.com',
  resend: { apiKey: process.env.RESEND_API_KEY! },
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
