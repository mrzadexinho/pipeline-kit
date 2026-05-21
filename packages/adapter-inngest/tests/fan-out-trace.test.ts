/**
 * Fan-out W3C trace propagation integration tests — ADR III-2 / HARD GATE B5.
 *
 * Verifies that kitFanOut injects the parent OTel trace context into the
 * step.invoke data envelope, and that a child handler extracting the envelope
 * via mapInngestContext sees the parent's traceId in its restored context.
 *
 * Strategy:
 *  1. Build a parent OTel context with a known traceId.
 *  2. Pass it via `opts.traceContext` to kitFanOut (explicit injection — avoids
 *     reliance on AsyncLocalStorage which is not wired in the OTel no-op context
 *     manager used outside a real Inngest runtime).
 *  3. Capture the data envelope passed to step.invoke.
 *  4. Feed the captured envelope to mapInngestContext as a child event.
 *  5. Assert the child's ctx.trace carries the parent traceId.
 *  6. End-to-end: create a child span under ctx.trace and confirm it inherits
 *     the parent traceId via the InMemorySpanExporter.
 *
 * Note on context.with(): the OTel default (no-op) context manager does not
 * propagate context through async boundaries. In real Inngest runs, an
 * AsyncLocalStorage context manager is installed. For tests, we pass the
 * parent context explicitly via `traceContext` option rather than mocking the
 * runtime environment.
 */
import { propagation, ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapInngestContext } from '../src/context-mapping.js';
import type { StepTools } from '../src/create-kit-function.js';
import { kitFanOut } from '../src/kit-fan-out.js';

// ─── OTel in-process provider ────────────────────────────────────────────────

let exporter: InMemorySpanExporter;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

beforeEach(() => {
  exporter.reset();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PARENT_TRACE_ID = 'aabb1122ccdd3344eeff5566778899aa';
const PARENT_SPAN_ID = 'abcdef1234567890';

/** Build an OTel context with a known traceId as the active span context. */
function buildParentOtelCtx() {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: PARENT_TRACE_ID,
    spanId: PARENT_SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true, // marks as remote (cross-boundary)
  });
}

/**
 * Build a mock StepTools that captures the data envelope passed to step.invoke.
 * Returned as `capturedData[]` so tests can inspect it.
 */
function makeCapturingStep(capturedData: unknown[]) {
  return {
    run: vi.fn(async (_id: string, fn: () => unknown) => fn()),
    invoke: vi.fn(async (_id: string, opts: { function: unknown; data: unknown }) => {
      capturedData.push(opts.data);
      return 'child-output';
    }),
    waitForEvent: vi.fn(),
    sendEvent: vi.fn(),
  } satisfies StepTools;
}

const childFn = { id: 'child-fn' } as unknown;

// ─── B5 tests ─────────────────────────────────────────────────────────────────

describe('kitFanOut — OTel W3C trace propagation (ADR III-2)', () => {
  it('injects _pk_trace carrier into step.invoke data envelope', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    await kitFanOut(step, {
      childFunction: childFn,
      items: ['item-a'],
      traceContext: parentCtx,
    });

    expect(capturedData).toHaveLength(1);
    const envelope = capturedData[0] as { _pk_trace: unknown; payload: unknown };
    expect(envelope).toHaveProperty('_pk_trace');
    expect(envelope).toHaveProperty('payload', 'item-a');
  });

  it('_pk_trace carrier contains W3C traceparent header with parent traceId', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    await kitFanOut(step, {
      childFunction: childFn,
      items: ['item-b'],
      traceContext: parentCtx,
    });

    const envelope = capturedData[0] as { _pk_trace: Record<string, string> };
    const traceparent = envelope._pk_trace.traceparent;
    expect(traceparent).toBeDefined();
    // W3C traceparent format: 00-<traceId>-<spanId>-<flags>
    expect(traceparent).toContain(PARENT_TRACE_ID);
  });

  it('child mapInngestContext restores parent traceId from _pk_trace envelope', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    // Parent invokes fan-out with explicit traceContext
    await kitFanOut(step, {
      childFunction: childFn,
      items: [{ userId: 'u1' }],
      traceContext: parentCtx,
    });

    const envelope = capturedData[0] as Record<string, unknown>;

    // Child entry: mapInngestContext extracts trace from the _pk_trace carrier
    const childCtx = mapInngestContext(
      { attempt: 0, data: envelope },
      { runId: 'pk_run_child01', pipelineId: 'pk_pipe_test' },
    );

    // The child's restored trace must carry the parent's traceId
    const restoredSpanCtx = trace.getSpanContext(childCtx.trace);
    expect(restoredSpanCtx).toBeDefined();
    expect(restoredSpanCtx?.traceId).toBe(PARENT_TRACE_ID);
  });

  it('child payload is unwrapped to original item shape', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    const originalItem = { order: 42, sku: 'ABC' };
    await kitFanOut(step, {
      childFunction: childFn,
      items: [originalItem],
      traceContext: parentCtx,
    });

    const envelope = capturedData[0] as Record<string, unknown>;

    // envelope.payload must be the original item, not the wrapped shape
    expect(envelope.payload).toEqual(originalItem);
  });

  it('three children each receive the same parent traceId in their envelopes', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    await kitFanOut(step, {
      childFunction: childFn,
      items: ['a', 'b', 'c'],
      traceContext: parentCtx,
    });

    expect(capturedData).toHaveLength(3);

    for (const envelope of capturedData) {
      const e = envelope as { _pk_trace: Record<string, string> };
      expect(e._pk_trace.traceparent).toContain(PARENT_TRACE_ID);
    }
  });

  it('without traceContext, _pk_trace carrier is still present (envelope always set)', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);

    // No traceContext — relies on context.active() (root in no-op env)
    await kitFanOut(step, { childFunction: childFn, items: ['item-no-parent'] });

    const envelope = capturedData[0] as { _pk_trace: unknown; payload: unknown };
    // The carrier object is always injected (may be empty if no active span)
    expect(envelope).toHaveProperty('_pk_trace');
    expect(envelope).toHaveProperty('payload', 'item-no-parent');
  });

  it('end-to-end: child span created under restored trace inherits parent traceId', async () => {
    const capturedData: unknown[] = [];
    const step = makeCapturingStep(capturedData);
    const parentCtx = buildParentOtelCtx();

    await kitFanOut(step, {
      childFunction: childFn,
      items: ['e2e-item'],
      traceContext: parentCtx,
    });

    const envelope = capturedData[0] as Record<string, unknown>;

    // Simulate child handler: restore context from envelope, create a child span
    const childKitCtx = mapInngestContext(
      { attempt: 0, data: envelope },
      { runId: 'pk_run_e2e', pipelineId: 'pk_pipe_e2e' },
    );

    // Create a span explicitly under the restored context — pass context as 3rd arg
    // to startSpan to avoid relying on the context manager's AsyncLocalStorage
    // propagation (not wired in the OTel no-op environment used in tests).
    const tracer = trace.getTracer('adapter-inngest-test');
    const childSpanObj = tracer.startSpan('child-work', {}, childKitCtx.trace);
    childSpanObj.end();

    const spans = exporter.getFinishedSpans();
    const childSpan = spans.find((s) => s.name === 'child-work');
    expect(childSpan).toBeDefined();
    expect(childSpan?.spanContext().traceId).toBe(PARENT_TRACE_ID);
  });
});
