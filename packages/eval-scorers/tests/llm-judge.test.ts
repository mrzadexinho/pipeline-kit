import { describe, expect, it, vi } from 'vitest';
import type { ModelClient } from '../src/llm-judge.js';
import { llmJudge } from '../src/llm-judge.js';

function makeClient(verdict: { pass: boolean; score: number; reason?: string }): ModelClient {
  return {
    judge: vi.fn().mockResolvedValue(verdict),
  };
}

describe('llmJudge', () => {
  it('returns pass when mock client returns pass=true', async () => {
    const client = makeClient({ pass: true, score: 1, reason: 'correct' });
    const scorer = llmJudge({ model: 'gpt-4o', client });
    const result = await scorer({ input: 'q', output: 'a', expected: 'a' });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
    expect(result.reason).toBe('correct');
  });

  it('returns fail when mock client returns pass=false', async () => {
    const client = makeClient({ pass: false, score: 0, reason: 'bad answer' });
    const scorer = llmJudge({ model: 'gpt-4o', client });
    const result = await scorer({ input: 'q', output: 'wrong', expected: 'right' });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bad answer');
  });

  it('uses default rubric in system prompt when rubric not provided', async () => {
    const client: ModelClient = { judge: vi.fn().mockResolvedValue({ pass: true, score: 1 }) };
    const scorer = llmJudge({ model: 'claude-3', client });
    await scorer({ input: 'x', output: 'y' });
    const call = (client.judge as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system?: string;
    };
    expect(call.system).toMatch(/Score 1\.0 if output is correct/);
  });

  it('includes user-provided rubric in system prompt', async () => {
    const client: ModelClient = { judge: vi.fn().mockResolvedValue({ pass: true, score: 1 }) };
    const scorer = llmJudge({ model: 'claude-3', rubric: 'Be lenient.', client });
    await scorer({ input: 'x', output: 'y' });
    const call = (client.judge as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system?: string;
    };
    expect(call.system).toMatch(/Be lenient\./);
  });
});
