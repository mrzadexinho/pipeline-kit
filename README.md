# pipeline-kit

> Typed-stage TypeScript automation library. Wire
> `Source<O> → Store<T> → Process<I,O> → Serve<I>` with retry, rate-limit,
> idempotency, observability, and HRP-review checkpoints baked in.

## Status

**v0 status: M0 shipped** — kernel + `Reviewable<I>`. **M0.5** ships 15
reference adapters. **M1** ships the first reference project (Trades
Outbound) validating Loop γ.

## What it is

A small, typed library that names the four stages of any automation as
TypeScript interfaces, ships a Composer that wires them end-to-end, and
provides `Reviewable<I>` as a first-class primitive for human-review
checkpoints. Aligned with the Gatewerk family — Stripe-style API design,
HMAC webhook signing, `Result<T, E>` error handling, Zod 4 boundary
validation.

## Quickstart

```typescript
import { Pipeline } from '@idriszade/core';
import { GatewerkReviewable } from '@idriszade/process-reviewable';
import { createClient } from 'gatewerk';

const reviewable = new GatewerkReviewable<MyData>({
  client: createClient({ apiKey: process.env.GATEWERK_API_KEY }),
  templateId: 'tpl_my_review',
  config: {
    allowApprove: true,
    allowReject: true,
    allowEdit: true,
    allowRetry: true,
    allowIgnore: true,
  },
});

const pipeline = Pipeline.from(mySource)
  .through(extractProcess)
  .review(reviewable)
  .to(myServe);

const result = await pipeline.run();
if (result.error !== null) {
  console.error('pipeline failed:', result.error);
} else {
  console.log('pipeline output:', result.data.output);
}
```

`.review(rev)` is sugar over `.through(reviewableWrapper(rev))` — explicit
`Process<I, I>` composition is also supported via the `reviewableWrapper`
factory.

## Packages shipped in M0

- `@idriszade/core` — orchestration kernel: stage interfaces,
  Composer (retry + rate-limit + OTel + idempotency + cancellation),
  Pipeline chainable factory, webhook sign/verify (Stripe canon),
  `createPipelineKit` SDK factory.
- `@idriszade/process-reviewable` — HRP gate adapters:
  `GatewerkReviewable`, `ConsoleReviewable`, `reviewableWrapper`,
  `EditableField<T>` + `Field.{unedited, edited, rejected}` helpers.

## Architecture

See [`docs/spec.md`](docs/spec.md) for the full Phase 2 spec — 23 v0
ADRs, 16 reference adapters (M0.5), test plan, and roadmap.

## Family-of-products

- [gatewerk](https://github.com/mrzadexinho/gatewerk) — HITL station;
  reference HRP implementation; `GatewerkReviewable<I>` wires pipeline-kit
  to gatewerk natively.
- [pursuit](https://github.com/mrzadexinho/pursuit) — opportunity-pursuit
  framework; provides `PursuitDemandSource` adapter (M1).
- [orchestr8-mcp](https://github.com/mrzadexinho/orchestr8) — agent
  coordination; memory backend for pipeline-kit Composer.

## Engineering

- TypeScript 6.x strict (`noUncheckedIndexedAccess`,
  `noImplicitOverride`), ESM only.
- `Result<T, E>` at every public boundary; no thrown errors crossing
  the public stage API.
- Zod 4 at every Source/Serve boundary.
- HMAC-SHA256 with single `t=<unix>,v1=<hex>` header + 5-minute replay
  window for webhook signing (Stripe canon).
- OpenTelemetry traces native; `pipeline.<stage>` spans with
  `runId`/`pipelineId`/`attempt`/`stageId` attributes.
- Tested with Vitest 4 + fast-check 4 + tstyche 7 against Node 20 / 22
  matrix + Bun 1.3+ runtime-compat smoke.

## License

MIT — see [LICENSE](LICENSE).
