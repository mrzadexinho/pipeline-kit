# @pipeline-kit/core

Pipeline-kit orchestration kernel — Source/Store/Process/Serve stages, Pipeline composer, Result<T,E>, retry/rate-limit policies, HMAC webhook sign/verify, and OpenTelemetry hooks.

## Install

```bash
pnpm add @pipeline-kit/core
```

Optional peer dependencies (install if you wire OTel exporters yourself):
- `@opentelemetry/api`
- `@opentelemetry/sdk-node`
- `@opentelemetry/exporter-trace-otlp-http`

## Usage

```typescript
import { createPipelineKit, Pipeline, webhooks } from '@pipeline-kit/core';

const kit = createPipelineKit({ apiKey: process.env.PIPELINE_KIT_API_KEY });

// Compose a pipeline (adapters live in sibling packages)
const pipeline = Pipeline.from(source).through(process).to(serve);
const result = await pipeline.run();

// Sign / verify webhook payloads
const sig = webhooks.sign(payload, secret);
const evt = webhooks.verify(rawBody, sigHeader, secret);
```

## Reference

Core types and factory: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md). Adapter list: [`docs/spec-adapters.md`](../../docs/spec-adapters.md).
