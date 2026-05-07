import type { PipelineContext, TraceContext } from '@pipeline-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createValidateProcess } from '../src/index.js';

// Minimal trace context stub (ROOT_CONTEXT equivalent)
const stubTrace = {} as TraceContext;

describe('ValidateProcess', () => {
  const makeCtx = (): PipelineContext => ({
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: {},
    signal: new AbortController().signal,
    trace: stubTrace,
    attachMetadata() {},
  });

  it('strict mode success', async () => {
    const ItemSchema = z.object({ name: z.string(), value: z.number() });
    const process = createValidateProcess({ schema: ItemSchema, mode: 'strict' });

    const result = await process.run({ name: 'test', value: 42 }, makeCtx());

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'test', value: 42 });
  });

  it('strict mode failure', async () => {
    const ItemSchema = z.object({ name: z.string(), value: z.number() });
    const process = createValidateProcess({ schema: ItemSchema, mode: 'strict' });

    const result = await process.run({ name: 123, value: 'x' }, makeCtx());

    expect(result.error).not.toBeNull();
    expect(result.error?.type).toBe('validation');
    expect(result.error?.code).toBe('schema_parse_failed');
    expect(result.data).toBeNull();
  });

  it('coerce mode with .catch() fallback', async () => {
    const CatchSchema = z.object({
      name: z.string().catch('default'),
      value: z.number().catch(0),
    });
    const process = createValidateProcess({ schema: CatchSchema, mode: 'coerce' });

    const result = await process.run({ name: null, value: 'x' }, makeCtx());

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'default', value: 0 });
  });

  it('coerce mode onCoerce callback fires', async () => {
    const CatchSchema = z.object({
      name: z.string().catch('default'),
      value: z.number().catch(0),
    });
    const onCoerce = vi.fn();
    const process = createValidateProcess({
      schema: CatchSchema,
      mode: 'coerce',
      onCoerce,
    });

    const input = { name: null, value: 'x' };
    const result = await process.run(input, makeCtx());

    expect(result.error).toBeNull();
    expect(onCoerce).toHaveBeenCalled();
    expect(onCoerce).toHaveBeenCalledWith(
      '',
      input,
      expect.objectContaining({ name: 'default', value: 0 }),
    );
  });

  it('nested schema', async () => {
    const NestedSchema = z.object({
      id: z.string(),
      nested: z.object({
        deep: z.string(),
      }),
    });
    const process = createValidateProcess({ schema: NestedSchema, mode: 'strict' });

    const result = await process.run({ id: 'test', nested: { deep: 'value' } }, makeCtx());

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 'test', nested: { deep: 'value' } });
  });

  it('transformed schema', async () => {
    const TransformSchema = z.object({
      date: z.string().transform((s) => new Date(s)),
    });
    const process = createValidateProcess({
      schema: TransformSchema,
      mode: 'strict',
    });

    const result = await process.run({ date: '2026-05-07' }, makeCtx());

    expect(result.error).toBeNull();
    expect(result.data?.date).toBeInstanceOf(Date);
    expect(result.data?.date?.toISOString()).toMatch(/^2026-05-07/);
  });
});
