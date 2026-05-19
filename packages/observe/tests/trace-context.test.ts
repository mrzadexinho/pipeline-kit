import { ROOT_CONTEXT, context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import {
  NDJSONFrame,
  WireTraceContext,
  parseTraceContext,
  serializeTraceContext,
  unwrapFrame,
  wrapFrame,
} from '../src/trace-context.js';

const VALID_TRACE_ID = 'a'.repeat(32);
const VALID_SPAN_ID = 'b'.repeat(16);
const VALID_FLAGS = '01';
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-${VALID_FLAGS}`;

describe('parseTraceContext', () => {
  it('returns WireTraceContext for valid traceparent', () => {
    const result = parseTraceContext({ traceparent: VALID_TRACEPARENT });
    expect(result).toBeDefined();
    expect(result!.traceparent).toBe(VALID_TRACEPARENT);
  });

  it('returns undefined for all-zero traceId', () => {
    const tp = `00-${'0'.repeat(32)}-${VALID_SPAN_ID}-01`;
    expect(parseTraceContext({ traceparent: tp })).toBeUndefined();
  });

  it('returns undefined for all-zero spanId', () => {
    const tp = `00-${VALID_TRACE_ID}-${'0'.repeat(16)}-01`;
    expect(parseTraceContext({ traceparent: tp })).toBeUndefined();
  });

  it('returns undefined for wrong section count', () => {
    expect(parseTraceContext({ traceparent: 'only-two-parts' })).toBeUndefined();
  });

  it('returns undefined for uppercase hex (spec requires lowercase)', () => {
    const tp = `00-${'A'.repeat(32)}-${VALID_SPAN_ID}-01`;
    expect(parseTraceContext({ traceparent: tp })).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(parseTraceContext('not-an-object')).toBeUndefined();
    expect(parseTraceContext(null)).toBeUndefined();
    expect(parseTraceContext(42)).toBeUndefined();
  });

  it('preserves tracestate when present', () => {
    const result = parseTraceContext({
      traceparent: VALID_TRACEPARENT,
      tracestate: 'vendor=abc',
    });
    expect(result!.tracestate).toBe('vendor=abc');
  });
});

describe('serializeTraceContext', () => {
  it('returns undefined for ROOT_CONTEXT (no active span)', () => {
    expect(serializeTraceContext(ROOT_CONTEXT)).toBeUndefined();
  });

  it('round-trips a real OTel-API context through serialize + parse', async () => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    const tracer = provider.getTracer('test');

    const span = tracer.startSpan('round-trip');
    // Build the context explicitly — avoids depending on the global context manager
    // (which is a noop in the test environment).
    const ctx = trace.setSpan(ROOT_CONTEXT, span);
    const serialized = serializeTraceContext(ctx);
    span.end();
    await provider.shutdown();

    expect(serialized).toBeDefined();
    const parsed = parseTraceContext(serialized!);
    expect(parsed).toBeDefined();
    expect(parsed!.traceparent).toBe(serialized!.traceparent);
  });
});

describe('wrapFrame / unwrapFrame', () => {
  it('round-trips payload with trace context', () => {
    const trace: WireTraceContext = { traceparent: VALID_TRACEPARENT };
    const frame = wrapFrame({ value: 42 }, trace);
    expect(frame.trace).toEqual(trace);
    expect(frame.payload).toEqual({ value: 42 });

    const unwrapped = unwrapFrame(frame);
    expect(unwrapped.trace).toEqual(trace);
    expect(unwrapped.payload).toEqual({ value: 42 });
  });

  it('round-trips payload without trace context', () => {
    const frame = wrapFrame('hello');
    expect(frame.trace).toBeUndefined();
    expect(frame.payload).toBe('hello');

    const unwrapped = unwrapFrame(frame);
    expect(unwrapped.trace).toBeUndefined();
    expect(unwrapped.payload).toBe('hello');
  });
});
