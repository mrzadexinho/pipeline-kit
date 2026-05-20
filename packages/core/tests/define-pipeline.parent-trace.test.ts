import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { definePipeline } from '../src/define-pipeline.js';
import type { TerminalPipeline } from '../src/pipeline-types.js';
import { ok } from '../src/result.js';

function mockTerminalPipeline(): TerminalPipeline<string> {
  return {
    async run(_input, _options) {
      return ok({
        runId: 'pk_run_trace_test',
        pipelineId: 'pk_pipe_trace_test',
        output: 'result',
        atomCount: 1,
        duration: 50,
        metadata: {},
      });
    },
    describe() {
      return { pipelineId: 'pk_pipe_trace_test', steps: [] };
    },
  };
}

function buildCustomTraceContext() {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: 'abcdef0123456789abcdef0123456789',
    spanId: 'abcdef0123456789',
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

describe('definePipeline — parentTraceContext forwarding (ADR III-2)', () => {
  it('forwards parentTraceContext to the inner pipeline.run call', async () => {
    const pipeline = mockTerminalPipeline();
    const runSpy = vi.spyOn(pipeline, 'run');
    const defined = definePipeline({ id: 'pk_pipe_trace_fwd' }, pipeline);

    const customCtx = buildCustomTraceContext();
    await defined.run(undefined, { parentTraceContext: customCtx });

    expect(runSpy).toHaveBeenCalledOnce();
    const calledWith = runSpy.mock.calls[0]?.[1];
    expect(calledWith?.parentTraceContext).toBe(customCtx);
  });

  it('passes parentTraceContext === customCtx (identity equality, not ROOT_CONTEXT)', async () => {
    const pipeline = mockTerminalPipeline();
    const runSpy = vi.spyOn(pipeline, 'run');
    const defined = definePipeline({ id: 'pk_pipe_trace_identity' }, pipeline);

    const customCtx = buildCustomTraceContext();
    await defined.run(undefined, { parentTraceContext: customCtx });

    const calledWith = runSpy.mock.calls[0]?.[1];
    expect(calledWith?.parentTraceContext).not.toBe(ROOT_CONTEXT);
    expect(calledWith?.parentTraceContext).toBe(customCtx);
  });

  it('passes parentTraceContext === undefined when caller omits it', async () => {
    const pipeline = mockTerminalPipeline();
    const runSpy = vi.spyOn(pipeline, 'run');
    const defined = definePipeline({ id: 'pk_pipe_trace_omit' }, pipeline);

    await defined.run(undefined, { metadata: { key: 'val' } });

    const calledWith = runSpy.mock.calls[0]?.[1];
    expect(calledWith?.parentTraceContext).toBeUndefined();
  });

  it('passes parentTraceContext === undefined when options object is omitted entirely', async () => {
    const pipeline = mockTerminalPipeline();
    const runSpy = vi.spyOn(pipeline, 'run');
    const defined = definePipeline({ id: 'pk_pipe_trace_nopts' }, pipeline);

    await defined.run();

    const calledWith = runSpy.mock.calls[0]?.[1];
    expect(calledWith?.parentTraceContext).toBeUndefined();
  });
});
