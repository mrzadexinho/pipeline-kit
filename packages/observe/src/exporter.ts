import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { GEN_AI_REQUEST_MODEL, GEN_AI_SYSTEM } from './otel-genai-keys.js';

export interface KitSpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeNs: number;
  endTimeNs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
}

export interface SpanSink {
  write(spans: ReadonlyArray<KitSpanRecord>): Promise<void>;
  close(): Promise<void>;
}

// Resolve OTEL_SEMCONV_STABILITY_OPT_IN mode.
// Returns 'dup' if gen_ai/dup is present, 'v137' otherwise.
function resolveOptIn(): 'v137' | 'dup' {
  const raw = process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
  if (!raw) return 'v137';
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.includes('gen_ai/dup')) return 'dup';
  return 'v137';
}

// Convert HrTime [seconds, nanos] to a single nanoseconds number.
function hrTimeToNs(hrTime: readonly [number, number]): number {
  return hrTime[0] * 1_000_000_000 + hrTime[1];
}

const LEGACY_PREFIX_MAP: ReadonlyMap<string, string> = new Map([
  ['gen_ai.system', 'llm.system'],
  ['gen_ai.operation.name', 'llm.operation.name'],
  ['gen_ai.request.model', 'llm.request.model'],
  ['gen_ai.response.model', 'llm.response.model'],
  ['gen_ai.request.temperature', 'llm.request.temperature'],
  ['gen_ai.request.max_tokens', 'llm.request.max_tokens'],
  ['gen_ai.usage.input_tokens', 'llm.usage.input_tokens'],
  ['gen_ai.usage.output_tokens', 'llm.usage.output_tokens'],
  ['gen_ai.response.id', 'llm.response.id'],
  ['gen_ai.response.finish_reasons', 'llm.response.finish_reasons'],
]);

// Cross-vendor join keys — emitted if present on any span (Datadog/Honeycomb/Langfuse).
const JOIN_KEYS = [GEN_AI_SYSTEM, GEN_AI_REQUEST_MODEL] as const;

function buildAttributes(span: ReadableSpan, mode: 'v137' | 'dup'): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    result[key] = value;
    if (mode === 'dup') {
      const legacy = LEGACY_PREFIX_MAP.get(key);
      if (legacy !== undefined) result[legacy] = value;
    }
  }
  // Ensure cross-vendor join keys are present when set on the span.
  for (const k of JOIN_KEYS) {
    const v = span.attributes[k];
    if (v !== undefined && result[k] === undefined) result[k] = v;
  }
  return result;
}

function toRecord(span: ReadableSpan, mode: 'v137' | 'dup'): KitSpanRecord {
  const ctx = span.spanContext();
  const record: KitSpanRecord = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name: span.name,
    kind: span.kind,
    startTimeNs: hrTimeToNs(span.startTime),
    endTimeNs: hrTimeToNs(span.endTime),
    status: {
      code: span.status.code,
      ...(span.status.message !== undefined ? { message: span.status.message } : {}),
    },
    attributes: buildAttributes(span, mode),
  };

  if (span.parentSpanContext !== undefined) {
    record.parentSpanId = span.parentSpanContext.spanId;
  }

  return record;
}

export class KitSpanExporter implements SpanExporter {
  readonly #sink: SpanSink;

  constructor({ sink }: { sink: SpanSink }) {
    this.#sink = sink;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    const mode = resolveOptIn();
    const records = spans.map((s) => toRecord(s, mode));
    this.#sink.write(records).then(
      () => resultCallback({ code: 0 }),
      (err: unknown) =>
        resultCallback({
          code: 1,
          error: err instanceof Error ? err : new Error(String(err)),
        }),
    );
  }

  shutdown(): Promise<void> {
    return this.#sink.close();
  }
}
