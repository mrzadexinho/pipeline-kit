import type { PipelineContext, TraceContext } from '@idriszade/core';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('rules mode', () => {
  let ctx: PipelineContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('equals match', async () => {
    const input = { user: { role: 'admin' }, score: 95, message: 'Hello world', status: 'active' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['is_admin', 'other'],
      rules: [{ field: 'user.role', match: 'equals', value: 'admin', category: 'is_admin' }],
    });

    const result = await process.run(input, ctx);
    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('is_admin');
  });

  it('contains match', async () => {
    const input = { user: { role: 'admin' }, score: 95, message: 'Hello world', status: 'active' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['greeting', 'other'],
      rules: [{ field: 'message', match: 'contains', value: 'Hello', category: 'greeting' }],
    });

    const result = await process.run(input, ctx);
    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('greeting');
  });

  it('regex match', async () => {
    const input = { user: { role: 'admin' }, score: 95, message: 'Hello world', status: 'active' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['active', 'other'],
      rules: [{ field: 'status', match: 'regex', value: '^act', category: 'active' }],
    });

    const result = await process.run(input, ctx);
    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('active');
  });

  it('priority resolution', async () => {
    const input = { user: { role: 'admin' }, score: 95, message: 'Hello world', status: 'active' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['admin', 'high_score'],
      rules: [
        { field: 'user.role', match: 'equals', value: 'admin', category: 'admin', priority: 10 },
        { field: 'score', match: 'gt', value: 90, category: 'high_score', priority: 5 },
      ],
    });

    const result = await process.run(input, ctx);
    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('admin');
  });

  it('no match → defaultCategory', async () => {
    const input = { user: { role: 'user' }, score: 50, message: 'test', status: 'inactive' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['admin', 'other'],
      rules: [{ field: 'user.role', match: 'equals', value: 'admin', category: 'admin' }],
      defaultCategory: 'other',
    });

    const result = await process.run(input, ctx);
    expect(result.error).toBeNull();
    expect(result.data?.category).toBe('other');
  });

  it('no match + no defaultCategory → error', async () => {
    const input = { user: { role: 'user' }, score: 50, message: 'test', status: 'inactive' };
    const process = createClassifyProcess({
      mode: 'rules',
      categories: ['admin'],
      rules: [{ field: 'user.role', match: 'equals', value: 'admin', category: 'admin' }],
    });

    const result = await process.run(input, ctx);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('classify_no_match');
  });
});
