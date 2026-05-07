import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpToolServe } from '../src/mcp-tool-serve.js';
import { makeCtx, makeMockPipeline } from './helpers.js';

describe('McpToolServe — pipeline integration', () => {
  it('end-to-end emit through mock pipeline returns ok with runId as emit id', async () => {
    const inputSchema = z.object({ msg: z.string() });
    const outputSchema = z.object({ reply: z.string() });
    const pipeline = makeMockPipeline<{ reply: string }>({
      output: { reply: 'echoed' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo',
      description: 'Echo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const result = await serve.emit({ msg: 'hi' }, makeCtx());

    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
    expect(result.data?.id).toBe('pk_run_test_123');
    expect(result.data?.metadata).toMatchObject({ atomCount: 1, duration: 50 });
  });

  it('emit propagates pipeline error as ServeError with code pipeline_error', async () => {
    const inputSchema = z.object({ msg: z.string() });
    const outputSchema = z.object({ reply: z.string() });
    const pipeline = makeMockPipeline<{ reply: string }>({
      error: { message: 'boom', code: 'unknown' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo',
      description: 'Echo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const result = await serve.emit({ msg: 'hi' }, makeCtx());

    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('unknown');
    expect(result.error?.code).toBe('pipeline_error');
    expect(result.error?.message).toBe('boom');
  });
});
