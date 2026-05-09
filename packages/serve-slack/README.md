# @idriszade/serve-slack

Serve adapter for posting pipeline results to Slack channels and DMs via `chat.postMessage`, with idempotency-key derived `client_msg_id` and optional cache for cross-run dedup.

## Install

```bash
pnpm add @idriszade/serve-slack
```

`@slack/web-api` is bundled as a direct dependency.

## Usage

```typescript
import { createSlackServe } from '@idriszade/serve-slack';

const slack = createSlackServe({
  token: process.env.SLACK_BOT_TOKEN!,
  channel: 'C0123456789',
});
```

Pair with `SlackEmojiReviewable` (in `@idriszade/process-reviewable`) for reaction-emoji HRP gates.

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
