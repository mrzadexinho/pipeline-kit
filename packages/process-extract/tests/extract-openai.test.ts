import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { PipelineContext } from '@pipeline-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

function makeOkResponse(obj: unknown): unknown {
  return {
    choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe('process-extract / openai', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('structured output success', async () => {
    mockCreate.mockResolvedValueOnce(makeOkResponse({ name: 'Alice', age: 30 }));

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person info',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
    });

    const result = await process.run('Alice is 30 years old', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('schema retry: first pass fails, second succeeds', async () => {
    // First call returns data missing 'age' field — schema parse will fail
    mockCreate.mockResolvedValueOnce(makeOkResponse({ name: 'Bob' }));
    // Second call returns valid data
    mockCreate.mockResolvedValueOnce(makeOkResponse({ name: 'Bob', age: 25 }));

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
      maxRetriesOnSchemaFailure: 2,
    });

    const result = await process.run('Bob is 25', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'Bob', age: 25 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('schema retry exhausted', async () => {
    // All calls return invalid data (missing 'age')
    mockCreate.mockResolvedValue(makeOkResponse({ name: 'Charlie' }));

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
      maxRetriesOnSchemaFailure: 2,
    });

    const result = await process.run('Charlie', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('schema_parse_exhausted');
    expect(result.error?.type).toBe('validation');
    // 1 initial + 2 retries = 3 calls
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('rate limit error', async () => {
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    mockCreate.mockRejectedValueOnce(rateLimitError);

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
    });

    const result = await process.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('rate_limited');
    expect(result.error?.type).toBe('transient');
  });
});
