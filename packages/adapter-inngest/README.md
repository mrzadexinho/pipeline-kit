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

## RunGuard → Inngest Primitive Translation (ADR IV-5)

`createKitFunction` accepts an optional `runGuard` on the config object. Each of the 5 RunGuard shapes maps to specific Inngest primitives.

| # | RunGuard shape | Inngest primitive | Notes |
|---|---------------|-------------------|-------|
| 1 | `{}` (no runGuard) | _(none)_ | Unbounded parallelism. Inngest default — ALLOW_DUPLICATE behaviour. |
| 2 | `{ concurrency: { limit: N } }` | `concurrency: [{ limit: N }]` | Bounded parallelism. Extras queue behind the limit. No per-key scoping. |
| 3 | `{ concurrency: { limit: 1, overflow: 'queue' } }` | `concurrency: [{ limit: 1 }]` | Sequential singleton — never skips. Second trigger waits. |
| 4 | `{ concurrency: { limit: 1, overflow: 'reject' } }` | `singleton: { key: 'event.data.pipelineId', mode: 'skip' }` | True singleton — skips overlapping runs per pipeline. Uses Inngest `singleton` primitive (v4+), not `concurrency`. |
| 5 | `{ dedup: { period: '24h' } }` | `throttle: { limit: 1, period, key: 'event.data.dedupKey' }` + `idempotency: 'event.data.dedupKey'` | Dedup window. Period is forwarded. Idempotency expression is always set unconditionally (IV-6). |

**IV-6 note:** `idempotency: 'event.data.dedupKey'` is set on all function configs regardless of whether `runGuard.dedup` is configured. Inngest treats an undefined `dedupKey` expression result as a no-op dedup — this is safe and prevents silent omission when a trigger provides `dedupKey` without an explicit `runGuard.dedup`.

**Shape 4 note:** The `singleton` key is `'event.data.pipelineId'` — scoped per pipeline id. Set `event.data.pipelineId` in your trigger data to enable per-pipeline enforcement.

### Example

```ts
// Shape 3: sequential singleton (queue, never skip)
createKitFunction(inngest, {
  id: 'nightly-etl',
  trigger: { kind: 'cron', expr: '0 2 * * *' },
  runGuard: { concurrency: { limit: 1, overflow: 'queue' } },
}, handler);

// Shape 4: true singleton (skip overlapping)
createKitFunction(inngest, {
  id: 'expensive-report',
  trigger: { kind: 'event', name: 'reports/requested' },
  runGuard: { concurrency: { limit: 1, overflow: 'reject' } },
}, handler);

// Shape 5: event dedup window
createKitFunction(inngest, {
  id: 'webhook-handler',
  trigger: { kind: 'webhook', path: '/stripe' },
  runGuard: { dedup: { period: '24h' } },
}, handler);
```

## W3C Trace Propagation in Fan-Out (ADR III-2)

`kitFanOut` injects the parent OTel trace context into each child invocation's data envelope under the `_pk_trace` key. On child entry, `mapInngestContext` extracts the carrier and restores the parent trace context so child spans are correctly parented.

```
Parent run:
  kitFanOut(step, { items, traceContext: ctx.trace })
    → step.invoke({ data: { _pk_trace: { traceparent: '00-...' }, payload: item } })

Child run (via mapInngestContext):
  event.data = { _pk_trace: { traceparent: '...' }, payload: item }
  → ctx.trace = propagation.extract(ROOT_CONTEXT, event.data._pk_trace)
  → spans created under ctx.trace inherit the parent traceId
```

Pass `ctx.trace` explicitly via the `traceContext` option when calling `kitFanOut` inside a kit handler to ensure correct cross-invocation trace parenting.
