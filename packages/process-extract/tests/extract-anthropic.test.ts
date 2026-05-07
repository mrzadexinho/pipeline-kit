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
});
