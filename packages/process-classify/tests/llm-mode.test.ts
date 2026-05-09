import type { PipelineContext, Process, ProcessError, TraceContext } from '@idriszade/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClassifyProcess } from '../src/index.js';

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    idempotencyKey: undefined,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

describe('llm mode', () => {
  let ctx: PipelineContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('delegates to extract process', async () => {
    const mockExtract: Process<unknown, { category: string }> = {
      id: 'pk_proc_mock',
      run: vi.fn().mockResolvedValue({ data: { category: 'urgent' }, error: null }),
    };

    const process = createClassifyProcess({
      mode: 'llm',
      categories: ['urgent', 'normal'],
      llm: { extract: mockExtract },
    });

    const input = { text: 'critical issue' };
    const result = await process.run(input, ctx);

    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('urgent');
    expect(mockExtract.run).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates extract error', async () => {
    const mockExtract: Process<unknown, { category: string }> = {
      id: 'pk_proc_mock',
      run: vi.fn().mockResolvedValue({
        data: null,
        error: {
          type: 'transient',
          code: 'rate_limited',
          message: 'slow down',
        } as ProcessError,
      }),
    };

    const process = createClassifyProcess({
      mode: 'llm',
      categories: ['urgent', 'normal'],
      llm: { extract: mockExtract },
    });

    const input = { text: 'test' };
    const result = await process.run(input, ctx);

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('rate_limited');
  });
});
