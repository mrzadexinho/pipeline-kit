/**
 * Integration test: verifies defineEval + runEval work end-to-end with a
 * real scorer from @idriszade/eval-scorers.
 *
 * Deviation: uses a simulated pure function as the task rather than a live
 * @idriszade/process-extract call, because process-extract requires a real
 * LLM API key and network. The runner + scorer machinery is identical to what
 * a real Process<I,O> stage would exercise.
 */
import { describe, expect, it } from 'vitest';
import { exactMatch } from '../../eval-scorers/src/exact-match.js';
import { defineEval } from '../src/define-eval.js';

interface ExtractInput {
  text: string;
}

interface ExtractOutput {
  sentiment: 'positive' | 'negative' | 'neutral';
}

/** Simulated deterministic extraction (replaces live LLM call). */
function simulatedExtract(input: ExtractInput): ExtractOutput {
  const lower = input.text.toLowerCase();
  if (lower.includes('great') || lower.includes('good')) {
    return { sentiment: 'positive' };
  }
  if (lower.includes('bad') || lower.includes('terrible')) {
    return { sentiment: 'negative' };
  }
  return { sentiment: 'neutral' };
}

describe('defineEval integration', () => {
  it('runs 2-case golden set with exactMatch scorer and computes passRate', async () => {
    const ev = defineEval<ExtractInput, ExtractOutput>({
      name: 'sentiment-golden',
      cases: [
        { input: { text: 'This is great!' }, expected: { sentiment: 'positive' } },
        { input: { text: 'This is terrible.' }, expected: { sentiment: 'negative' } },
      ],
      task: simulatedExtract,
      scorers: { exact: exactMatch() },
    });

    const summary = await ev.run();

    expect(summary.name).toBe('sentiment-golden');
    expect(summary.results).toHaveLength(2);

    // Both cases should pass deterministically.
    expect(summary.passRate).toBe(1);

    // Each result should have a score entry.
    for (const result of summary.results) {
      expect(result.scores).toHaveLength(1);
      expect(result.scores[0]?.score.pass).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }

    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(summary.totalUsage).toBeInstanceOf(Map);
  });
});
