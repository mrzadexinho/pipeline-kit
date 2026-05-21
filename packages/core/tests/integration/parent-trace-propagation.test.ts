import { ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runComposer } from '../../src/composer/composer.js';
import { ok } from '../../src/result.js';

// ─── OTel in-memory provider ──────────────────────────────────────────────────

let exporter: InMemorySpanExporter;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildParentCtx(traceId: string) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: '1234567890abcdef',
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

const FIXED_TRACE_ID = 'aabbccddeeff00112233445566778899';

// ─── Scenario 1: parent trace propagates ─────────────────────────────────────

describe('parent trace propagation — ADR III-2 end-to-end', () => {
  it('scenario 1: step span inherits traceId from parentTraceContext', async () => {
    const parentCtx = buildParentCtx(FIXED_TRACE_ID);

    const result = await runComposer({
      pipelineId: 'pk_pipe_ptrace_s1',
      steps: [
        {
          id: 'pk_proc_s1',
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        },
      ],
      initialInput: 'hello',
      parentTraceContext: parentCtx,
    });

    expect(result.error).toBeNull();

    const spans = exporter.getFinishedSpans();
    const stepSpan = spans.find((s) => s.attributes.stageId === 'pk_proc_s1');
    expect(stepSpan).toBeDefined();

    // The step span must be under the injected trace, not a fresh one
    expect(stepSpan?.spanContext().traceId).toBe(FIXED_TRACE_ID);
  });

  // ─── Scenario 2: no parent → fresh traceId ─────────────────────────────────

  it('scenario 2: no parentTraceContext → step span gets a fresh traceId', async () => {
    const result = await runComposer({
      pipelineId: 'pk_pipe_ptrace_s2',
      steps: [
        {
          id: 'pk_proc_s2',
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        },
      ],
      initialInput: 'world',
      // no parentTraceContext
    });

    expect(result.error).toBeNull();

    const spans = exporter.getFinishedSpans();
    const stepSpan = spans.find((s) => s.attributes.stageId === 'pk_proc_s2');
    expect(stepSpan).toBeDefined();

    // Must NOT share the injected trace from scenario 1
    expect(stepSpan?.spanContext().traceId).not.toBe(FIXED_TRACE_ID);
  });

  // ─── Scenario 3: parent + idempotency coexist ──────────────────────────────

  it('scenario 3: parentTraceContext and idempotencyKey coexist without conflict', async () => {
    const parentCtx = buildParentCtx(FIXED_TRACE_ID);

    const result = await runComposer({
      pipelineId: 'pk_pipe_ptrace_s3',
      steps: [
        {
          id: 'pk_proc_s3',
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        },
      ],
      initialInput: 'coexist',
      parentTraceContext: parentCtx,
      idempotencyKey: 'idem-key-abc123',
    });

    expect(result.error).toBeNull();
    // The run must complete without error (the two features don't conflict)
    expect(result.data?.runId).toBeDefined();

    const spans = exporter.getFinishedSpans();
    const stepSpan = spans.find((s) => s.attributes.stageId === 'pk_proc_s3');
    expect(stepSpan).toBeDefined();

    // Trace parent is still honoured
    expect(stepSpan?.spanContext().traceId).toBe(FIXED_TRACE_ID);
  });
});
