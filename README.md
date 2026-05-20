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

## Milestones

| Milestone | What shipped | ADRs |
|-----------|--------------|------|
| M0 / M0.5 | Composer kernel, `Reviewable<I>`, 15 reference adapters | 23 v0 |
| M1 | Core v1 foundation: `SecretsResolver`, `MemoryAdapter`, `DisposableRegistry`, `PiiAnnotation` | 29 |
| M2 | Durable execution (`adapter-inngest`), CLI (`pk trace`) | 11 |
| M3 | Observability + eval: `observe`, `observe-vercel`, `eval`, `eval-scorers` | 7 |
| **M4** | **Secrets + Redaction Closure — closes v1 must-have 3-of-3** | **2** |
| **M5** | **Audit closure — IV-4, IV-5, IV-6, III-2, VIII-2, VIII-6.f/g** | **2** |

**M4 packages (v0.1.x / 0.1.0):**

- `@idriszade/core` — `markRedact`/`markSecret`, `walkAnnotations`, `formatRedacted`/`formatSecret` (VIII-6)
- `@idriszade/observe` — `RedactingProcessor`: default-on PII redaction at SpanProcessor layer; known-sensitive table (`gen_ai.prompt`, `gen_ai.completion`); schema-derived hints via `pk.pii_annotations` (VIII-6)
- `@idriszade/observe-vercel` — parity exports for RedactingProcessor
- `@idriszade/secrets-env` — env-var-backed `SecretsResolver`, Zod-validated at construction (VIII-5, T3 Env pattern)
- `@idriszade/secrets-sops` — SOPS CLI-backed resolver via `node:child_process`; no JS wrapper dep (VIII-5)
- `@idriszade/secrets-oidc` — workload-identity OIDC resolver: `./gcp`, `./aws`, `./azure` sub-paths; each cloud SDK is an optional peer dep (VIII-5)

**v1 must-haves closed:** eval (M3) · local-prod-seam (M2) · PII redaction (M4).
**ADR progress: 49/55 v1 ADRs implemented.**

**M5 closes audit gaps** on IV-4 / IV-5 / IV-6 / III-2 / VIII-2 / VIII-6.f / VIII-6.g — see [`docs/briefs/m5_audit_findings.md`](docs/briefs/m5_audit_findings.md) and [`docs/briefs/m5_brief.md`](docs/briefs/m5_brief.md).

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
