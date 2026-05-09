# @idriszade/process-reviewable

Reviewable<I> HRP gate adapters — `GatewerkReviewable`, `ConsoleReviewable`, plus a `reviewableWrapper` that bridges any Reviewable into a Process<I, I> for direct `.through()` composition.

## Install

```bash
pnpm add @idriszade/process-reviewable
```

Optional peer dependency:
- `gatewerk` (only required for `GatewerkReviewable`)

## Usage

```typescript
import { ConsoleReviewable, reviewableWrapper } from '@idriszade/process-reviewable';
import { Pipeline } from '@idriszade/core';

const reviewable = new ConsoleReviewable<Order>();

// Position-locked review slot
const a = Pipeline.from(source).review(reviewable).to(serve);

// Or wrap as Process<I, I> for explicit .through() composition
const b = Pipeline.from(source).through(reviewableWrapper(reviewable)).to(serve);
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md) (entry #12). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
