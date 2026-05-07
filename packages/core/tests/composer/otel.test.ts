import { describe, expect, it } from 'vitest';
import { getTracer, withSpan } from '../../src/composer/otel.js';
import { err, ok, type Result } from '../../src/result.js';

type StageErr = { type: string; code: string; message: string };

describe('getTracer', () => {
  it('returns a Tracer (no-op when no provider registered)', () => {
    const t = getTracer();
    expect(t).toBeDefined();
    expect(typeof t.startActiveSpan).toBe('function');
  });
});

describe('withSpan', () => {
  it('passes through inner success result', async () => {
    const r = await withSpan<string, StageErr>(
      'process',
      { runId: 'pk_run_x', pipelineId: 'pk_pipe_x' },
      async () => ok('hi'),
    );
    expect(r.data).toBe('hi');
    expect(r.error).toBeNull();
  });

  it('passes through inner error result', async () => {
    const r = await withSpan<string, StageErr>(
      'serve',
      { runId: 'pk_run_x', pipelineId: 'pk_pipe_x' },
      async () => err({ type: 'transient', code: 'flap', message: 'transient failure' }),
    );
    expect(r.error?.type).toBe('transient');
  });

  it('propagates thrown exceptions out of the span', async () => {
    const oops = new Error('boom');
    await expect(
      withSpan<string, StageErr>(
        'source',
        { runId: 'pk_run_x', pipelineId: 'pk_pipe_x' },
        async () => {
          throw oops;
        },
      ),
    ).rejects.toBe(oops);
  });

  it('accepts optional attempt + stageId attributes without throwing', async () => {
    const r: Result<number, StageErr> = await withSpan<number, StageErr>(
      'process',
      { runId: 'pk_run_x', pipelineId: 'pk_pipe_x', attempt: 2, stageId: 'pk_proc_x' },
      async () => ok(42),
    );
    expect(r.data).toBe(42);
  });
});
