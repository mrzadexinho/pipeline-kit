import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it } from 'vitest';
import type { KitSpanRecord, SpanSink } from '../src/exporter.js';
import { KitSpanExporter } from '../src/exporter.js';

function makeMockSink(): SpanSink & { written: KitSpanRecord[][] } {
  const written: KitSpanRecord[][] = [];
  return {
    written,
    async write(spans) {
      written.push([...spans]);
    },
    async close() {},
  };
}

function makeProvider(exporter: KitSpanExporter): BasicTracerProvider {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return provider;
}

describe('KitSpanExporter', () => {
  afterEach(() => {
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
  });

  it('forwards span name, traceId, spanId, and status', async () => {
    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('my-op');
    span.end();
    await provider.shutdown();

    expect(sink.written.length).toBeGreaterThanOrEqual(1);
    const record = sink.written.flat()[0];
    expect(record).toBeDefined();
    expect(record?.name).toBe('my-op');
    expect(typeof record?.traceId).toBe('string');
    expect(record?.traceId).toHaveLength(32);
    expect(typeof record?.spanId).toBe('string');
    expect(record?.spanId).toHaveLength(16);
    expect(typeof record?.status.code).toBe('number');
  });

  it('emits gen_ai.system and gen_ai.request.model when set', async () => {
    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('llm-call');
    span.setAttribute('gen_ai.system', 'openai');
    span.setAttribute('gen_ai.request.model', 'gpt-4o');
    span.end();
    await provider.shutdown();

    const record = sink.written.flat()[0];
    expect(record?.attributes['gen_ai.system']).toBe('openai');
    expect(record?.attributes['gen_ai.request.model']).toBe('gpt-4o');
  });

  it('does NOT emit gen_ai.system when not set on the span', async () => {
    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('plain-op');
    span.end();
    await provider.shutdown();

    const record = sink.written.flat()[0];
    expect(record?.attributes['gen_ai.system']).toBeUndefined();
    expect(record?.attributes['gen_ai.request.model']).toBeUndefined();
  });

  it('OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai/dup mirrors gen_ai.* keys under llm.*', async () => {
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai/dup';

    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('dup-test');
    span.setAttribute('gen_ai.request.model', 'claude-3');
    span.setAttribute('gen_ai.usage.input_tokens', 100);
    span.end();
    await provider.shutdown();

    const record = sink.written.flat()[0];
    expect(record?.attributes['gen_ai.request.model']).toBe('claude-3');
    expect(record?.attributes['llm.request.model']).toBe('claude-3');
    expect(record?.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(record?.attributes['llm.usage.input_tokens']).toBe(100);
  });

  it('OTEL_SEMCONV_STABILITY_OPT_IN unset emits v1.37 keys only (no llm.* mirror)', async () => {
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN;

    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });
    const provider = makeProvider(exporter);
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('v137-test');
    span.setAttribute('gen_ai.request.model', 'gpt-4');
    span.end();
    await provider.shutdown();

    const record = sink.written.flat()[0];
    expect(record?.attributes['gen_ai.request.model']).toBe('gpt-4');
    expect(record?.attributes['llm.request.model']).toBeUndefined();
  });

  it('calls resultCallback({code:0}) on success', async () => {
    const sink = makeMockSink();
    const exporter = new KitSpanExporter({ sink });

    await new Promise<void>((resolve) => {
      exporter.export([], (result) => {
        expect(result.code).toBe(0);
        resolve();
      });
    });
  });

  it('calls resultCallback({code:1, error}) when sink.write throws', async () => {
    const throwingSink: SpanSink = {
      async write() {
        throw new Error('disk full');
      },
      async close() {},
    };
    const exporter = new KitSpanExporter({ sink: throwingSink });

    await new Promise<void>((resolve) => {
      exporter.export([], (result) => {
        expect(result.code).toBe(1);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('disk full');
        resolve();
      });
    });
  });
});
