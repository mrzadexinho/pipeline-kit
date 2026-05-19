# @idriszade/observe

OTel GenAI v1.37 observability for pipeline-kit. Ships typed string constants for every `gen_ai.*` semantic convention key, a `KitSpanExporter` that bridges OTel `ReadableSpan` to any `SpanSink`, W3C Trace Context serialization/deserialization for out-of-band propagation across subprocess NDJSON frames, and a `FileSinkExporter` that appends JSONL span records to disk without sync I/O on the hot path.

## Installation

```bash
pnpm add @idriszade/observe
```

## OTel keys

All keys are typed `const` strings — no stringly-typed attribute access.

```ts
import {
  GEN_AI_SYSTEM,
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_REQUEST_TEMPERATURE,
  GEN_AI_REQUEST_MAX_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
  isCacheSubField,
  isReasoningSubField,
} from '@idriszade/observe';
```

Use `isCacheSubField(key)` / `isReasoningSubField(key)` as runtime guards when iterating unknown attribute maps.

## Cache tokens are non-additive

`gen_ai.usage.input_tokens` is the **total** token count. Cache sub-fields (`gen_ai.usage.input_tokens.cache_read`, `.cache_write`, `.no_cache`) are **descriptive** — they break down how the total was composed. They must NOT be summed into the parent.

```ts
import { UsageAccumulator } from '@idriszade/core';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
} from '@idriszade/observe';

const acc = new UsageAccumulator();

// Correct: record total, then the sub-field separately.
acc.record(GEN_AI_USAGE_INPUT_TOKENS, 500);
acc.record(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ, 350);

// acc.get(GEN_AI_USAGE_INPUT_TOKENS) === 500  (NOT 850)
// acc.get(GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ) === 350
```

**Do not** add `cache_read` to the parent total yourself — the model already included cached tokens in the top-level count. Recording both is the correct pattern; they are independent slots.

Reference: Langfuse issue #12306 — cache tokens are sub-fields, not separate counters. Vercel AI SDK v7 removed top-level `cachedInputTokens` / `reasoningTokens` for the same reason; those values now live exclusively under `inputTokenDetails.*` / `outputTokenDetails.*`.

The same rule applies to output tokens: `gen_ai.usage.output_tokens` is the total; `.reasoning` and `.text` are descriptive sub-fields.

## KitSpanExporter

`KitSpanExporter` implements the OTel `SpanExporter` interface. Wire it into your `TracerProvider` in place of (or alongside) any vendor exporter.

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { KitSpanExporter, FileSinkExporter } from '@idriszade/observe';

const sink = new FileSinkExporter({ runId: 'my-run' });
const exporter = new KitSpanExporter({ sink });

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();
```

`KitSpanExporter` reads `OTEL_SEMCONV_STABILITY_OPT_IN`. When the env var includes `gen_ai/dup`, each `gen_ai.*` attribute is duplicated under its legacy `llm.*` key — useful when routing to a backend that hasn't yet adopted GenAI semconv v1.37.

### SpanSink

```ts
interface SpanSink {
  write(spans: ReadonlyArray<KitSpanRecord>): Promise<void>;
  close(): Promise<void>;
}
```

Implement `SpanSink` to route spans to any destination (stdout, HTTP, queue). `FileSinkExporter` is the built-in implementation.

## W3C Trace Context out-of-band

Child processes that call Python, Rust, or any external subprocess do not need the OTel SDK. Pass trace context as a JSON field in the NDJSON frame; the child forwards it back without parsing.

```ts
import { context } from '@opentelemetry/api';
import {
  serializeTraceContext,
  parseTraceContext,
  wrapFrame,
  unwrapFrame,
} from '@idriszade/observe';

// Parent: serialize active span context into the outgoing frame.
const wireCtx = serializeTraceContext(context.active());
const frame = wrapFrame({ query: 'hello' }, wireCtx);
childProcess.stdin.write(JSON.stringify(frame) + '\n');

// On receipt from child — parse and validate.
const incoming = JSON.parse(line) as unknown;
const { trace, payload } = unwrapFrame(incoming as NDJSONFrame<unknown>);
const ctx = trace ? parseTraceContext(trace) : undefined;
```

`parseTraceContext` validates the W3C `traceparent` format (version + 32-hex trace-id + 16-hex span-id + flags) and rejects all-zeros IDs. Returns `undefined` on any malformed input.

## FileSinkExporter

Appends `KitSpanRecord` JSONL to `<dir>/<stem>.jsonl`. Directory is created lazily on first write.

```ts
import { FileSinkExporter } from '@idriszade/observe';

// Uses PK_TRACE_DIR env var, or .pk/traces/ relative to cwd.
const sink = new FileSinkExporter();

// Explicit dir + run ID:
const sink2 = new FileSinkExporter({
  dir: '/tmp/traces',
  runId: 'pk_run_abc123',
});
```

If `runId` is omitted the filename falls back to the first record's `traceId`.

## Environment variables

| Variable | Effect |
|---|---|
| `PK_TRACE_DIR` | Default directory for `FileSinkExporter` when `dir` is not passed. Falls back to `.pk/traces/` relative to `cwd`. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | Set to include `gen_ai/dup` to emit both `gen_ai.*` and legacy `llm.*` attribute keys on every span. |

## License — MIT
