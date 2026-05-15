# @idriszade/adapter-inngest

Inngest adapter for pipeline-kit — durable execution via `kitStep`, fan-out, HRP checkpoints, and trigger registration.

## Installation

```bash
pnpm add @idriszade/adapter-inngest inngest
```

`inngest ^4.0.0` is a peer dependency.

## Quick Start

```ts
import { Inngest } from 'inngest';
import { createKitFunction, kitStep } from '@idriszade/adapter-inngest';

const inngest = new Inngest({ id: 'my-app' });

const myFunction = createKitFunction(
  inngest,
  { id: 'process-order', trigger: { event: 'orders/created' } },
  async ({ step, event, kitCtx }) => {
    const result = await kitStep(step, 'validate', () =>
      validateOrder(event.data, kitCtx),
    );
    if (result.error) return result;
    return kitStep(step, 'fulfil', () => fulfil(result.data, kitCtx));
  },
);
```

## API

### `kitStep(step, id, fn)`

Result→throw bridge for `step.run()`. Unwraps `Result<O, StageError>` inside the durable step boundary — returning `Result.ok` on success or `Result.err` on failure without letting errors escape the step.

```ts
const result = await kitStep(step, 'my-step', () => myProcess.execute(input, ctx));
```

### `kitFanOut(step, opts)`

Parallel fan-out that invokes each item as a separate Inngest child function. Memoizes the items array via `step.run` for replay-safety (ADR I-6). Per-child failures are returned as `Result.err` rather than rejected.

```ts
const results = await kitFanOut(step, {
  childFunction: myChildFn,
  items: orderIds,
  sourceId: 'fetch-order-ids', // optional, default: 'fan-out-source'
});
```

### `createHrpCheckpoint(step, opts)`

HRP review checkpoint via `step.waitForEvent`. Sends an optional review-request webhook, then pauses until a `hrp/review.completed` event matching `data.runId` arrives or the timeout elapses.

```ts
const checkpoint = await createHrpCheckpoint(step, {
  runId: ctx.runId,
  timeout: '1h',
  timeoutPolicy: 'continue', // or 'error' to throw NonRetriableError
  sendReviewRequest: async (runId) => { /* notify reviewer */ },
});
if (!checkpoint.approved) return err({ type: 'stage_error', code: 'process_failed', message: 'HRP not approved' });
```

### `createKitFunction(inngest, config, handler)`

Factory wrapping `inngest.createFunction()` with kit conventions: structured `kitCtx`, typed `StepTools`, and `TriggerConfig` mapping.

### `InngestTriggerAdapter`

`TriggerAdapter` implementation for Inngest. Registers kit pipeline functions against an `Inngest` client.

```ts
const adapter = new InngestTriggerAdapter(inngest);
await adapter.register(pipeline, handler);
```

## Replay Safety (ADR I-6)

**Critical:** Inngest replays step functions on retry. Any code that runs outside a `step.run()` boundary re-executes on every replay. If that code is non-deterministic (e.g., a source fetch, a timestamp, a random ID), replays may produce different data than the original run, breaking the durability guarantee.

### Correct — Source wrapped in `step.run()`

```ts
const data = await step.run('fetch-source', async () => {
  return await source.fetch(query);
});
await kitStep(step, 'process', () => process.execute(data, ctx));
```

The fetched data is memoized after the first execution. On replay, Inngest returns the cached value without calling `source.fetch` again.

### Incorrect — Source called outside `step.run()`

```ts
// BUG: source.fetch() re-executes on every replay, may return different data
const data = await source.fetch(query);
await kitStep(step, 'process', () => process.execute(data, ctx));
```

### `kitFanOut` handles this automatically

`kitFanOut` memoizes the items array via `step.run` before fanning out, so the item list is stable across replays even if the upstream source is live.

### What counts as non-deterministic

- External API / database calls
- `Date.now()` / `new Date()`
- `Math.random()`
- Any I/O that may return different results over time

Wrap all of these in `step.run()` before using their output in subsequent steps.
