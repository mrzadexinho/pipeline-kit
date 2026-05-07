import { ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import type { PipelineContext } from '@pipeline-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExtractProcess } from '../src/extract-process.js';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  function OpenAI(_opts: unknown) {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  }
  return { default: OpenAI };
});

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_test',
  pipelineId: 'pk_pipe_test',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: ROOT_CONTEXT,
  attachMetadata() {},
});

const SimpleSchema = z.object({ result: z.string() });

describe('process-extract / otel span', () => {
  it('creates a span for the extract operation', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ result: 'ok' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    // Capture spans via a mock tracer
    const spanMock = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };

    const tracerMock = {
      startSpan: vi.fn().mockReturnValue(spanMock),
      startActiveSpan: vi
        .fn()
        .mockImplementation(
          (_name: string, _opts: unknown, fn: (span: typeof spanMock) => Promise<unknown>) =>
            fn(spanMock),
        ),
    };

    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockReturnValue(tracerMock as unknown as ReturnType<typeof trace.getTracer>);

    try {
      const process = createExtractProcess({
        provider: 'openai',
        model: 'gpt-4o',
        prompt: 'Extract result',
        outputSchema: SimpleSchema,
        apiKey: 'sk-test',
      });

      const result = await process.run('input', fakeCtx());
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ result: 'ok' });
      expect(tracerMock.startActiveSpan).toHaveBeenCalledWith(
        'pipeline.process.extract',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-4o',
          }),
        }),
        expect.any(Function),
      );
      expect(spanMock.end).toHaveBeenCalled();
      expect(spanMock.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(spanMock.setAttribute).toHaveBeenCalledWith(
        'gen_ai.usage.input_tokens',
        expect.any(Number),
      );
      expect(spanMock.setAttribute).toHaveBeenCalledWith(
        'gen_ai.usage.output_tokens',
        expect.any(Number),
      );
      expect(spanMock.setAttribute).toHaveBeenCalledWith(
        'gen_ai.response.finish_reasons',
        expect.any(String),
      );
    } finally {
      getTracerSpy.mockRestore();
    }
  });
});
