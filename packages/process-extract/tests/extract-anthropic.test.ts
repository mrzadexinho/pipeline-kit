import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { PipelineContext } from '@pipeline-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExtractProcess } from '../src/extract-process.js';

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function Anthropic(_opts: unknown) {
    return {
      messages: {
        create: mockMessagesCreate,
      },
    };
  }
  return { default: Anthropic };
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

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
});

function makeToolUseResponse(input: unknown): unknown {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_abc',
        name: 'extract',
        input,
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 20, output_tokens: 15 },
  };
}

describe('process-extract / anthropic', () => {
  beforeEach(() => {
    mockMessagesCreate.mockReset();
  });

  it('success with tool_use response', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      makeToolUseResponse({ sentiment: 'positive', confidence: 0.95 }),
    );

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
    });

    const result = await process.run('I love this product!', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ sentiment: 'positive', confidence: 0.95 });
  });

  it('auth error (401) maps to auth_failed', async () => {
    const authError = Object.assign(new Error('Invalid API key'), { status: 401 });
    mockMessagesCreate.mockRejectedValueOnce(authError);

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'bad-key',
    });

    const result = await process.run('test input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('auth_failed');
    expect(result.error?.type).toBe('permanent');
  });

  it('schema retry succeeds on second pass', async () => {
    // First returns wrong enum value — schema parse will fail
    mockMessagesCreate.mockResolvedValueOnce(
      makeToolUseResponse({ sentiment: 'happy', confidence: 0.9 }),
    );
    // Second returns valid data
    mockMessagesCreate.mockResolvedValueOnce(
      makeToolUseResponse({ sentiment: 'positive', confidence: 0.9 }),
    );

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
      maxRetriesOnSchemaFailure: 2,
    });

    const result = await process.run('I like it', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.sentiment).toBe('positive');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('rate limit (429) maps to rate_limited', async () => {
    const rateError = Object.assign(new Error('rate_limit_exceeded'), { status: 429 });
    mockMessagesCreate.mockRejectedValueOnce(rateError);

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
    });

    const result = await process.run('test', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('rate_limited');
    expect(result.error?.type).toBe('transient');
  });

  it('schema retry exhausted', async () => {
    // All responses contain wrong enum value — schema fails every attempt
    mockMessagesCreate.mockResolvedValue(
      makeToolUseResponse({ sentiment: 'meh', confidence: 0.5 }),
    );

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
      maxRetriesOnSchemaFailure: 1,
    });

    const result = await process.run('confusing input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('schema_parse_exhausted');
    expect(result.error?.type).toBe('validation');
    // 1 initial + 1 retry = 2 calls
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('network error maps to transient/network_error', async () => {
    const netError = new Error('fetch failed: ECONNREFUSED');
    mockMessagesCreate.mockRejectedValueOnce(netError);

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
    });

    const result = await process.run('test', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('network_error');
    expect(result.error?.type).toBe('transient');
  });

  it('null stop_reason falls back to "unknown"', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'extract',
          input: { sentiment: 'neutral', confidence: 0.5 },
        },
      ],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const proc = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
    });

    const result = await proc.run('input', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.sentiment).toBe('neutral');
  });

  it('missing tool_use block falls through to schema validation failure', async () => {
    // Response has only a text block and no tool_use; provider sets rawJson = {} which fails the schema
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const process = createExtractProcess({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      prompt: 'Analyze sentiment',
      outputSchema: SentimentSchema,
      apiKey: 'sk-ant-test',
      maxRetriesOnSchemaFailure: 1,
    });

    const result = await process.run('refuses to answer', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('schema_parse_exhausted');
    expect(result.error?.type).toBe('validation');
  });
});
