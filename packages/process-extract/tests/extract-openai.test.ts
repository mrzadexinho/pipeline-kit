import type { PipelineContext } from '@idriszade/core';
import { ROOT_CONTEXT } from '@opentelemetry/api';
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

  it('auth failure (401 status) maps to auth_failed', async () => {
    const authError = Object.assign(new Error('Unauthorized: invalid API key'), { status: 401 });
    mockCreate.mockRejectedValueOnce(authError);

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'bad-key',
    });

    const result = await process.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('auth_failed');
    expect(result.error?.type).toBe('permanent');
  });

  it('auth failure (message-only, no status) maps to auth_failed', async () => {
    // No status code, but message contains "Unauthorized"
    const authError = new Error('Unauthorized request');
    mockCreate.mockRejectedValueOnce(authError);

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'bad-key',
    });

    const result = await process.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('auth_failed');
    expect(result.error?.type).toBe('permanent');
  });

  it('rate limit via "rate" keyword in message (no status) maps to rate_limited', async () => {
    // Some clients omit status; mapProviderError matches the 'rate' keyword in message
    const rateError = new Error('You exceeded your current rate quota');
    mockCreate.mockRejectedValueOnce(rateError);

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

  it('systemPrompt is included in messages', async () => {
    mockCreate.mockResolvedValueOnce(makeOkResponse({ name: 'Dana', age: 40 }));

    const proc = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      systemPrompt: 'You are a strict extractor',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
    });

    const result = await proc.run('Dana 40', fakeCtx());
    expect(result.error).toBeNull();
    const callArgs = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string }> };
    expect(callArgs.messages[0]?.role).toBe('system');
    expect(callArgs.messages[1]?.role).toBe('user');
  });

  it('missing usage and null finish_reason fall back to defaults', async () => {
    // Response with no usage and finish_reason=null exercises ?? 0 and ?? 'unknown' branches
    mockCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ name: 'Eve', age: 22 }) }, finish_reason: null },
      ],
      // no usage field
    });

    const proc = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
    });

    const result = await proc.run('Eve 22', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ name: 'Eve', age: 22 });
  });

  it('content filter (null content) maps to content_filtered', async () => {
    // OpenAI returns null content with finish_reason 'content_filter' — provider wraps with code: 'content_filter'
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    });

    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract person',
      outputSchema: PersonSchema,
      apiKey: 'sk-test',
    });

    const result = await process.run('blocked content', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('content_filtered');
    expect(result.error?.type).toBe('permanent');
  });
});
