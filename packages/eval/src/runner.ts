import { createUsageAccumulator } from '@idriszade/core';
import pLimit from 'p-limit';
import type { Case, EvalResult, EvalSummary, Scorer } from './types.js';

export interface RunEvalOpts<I, O> {
  name: string;
  cases: ReadonlyArray<Case<I, O>>;
  task: (input: I) => Promise<O> | O;
  scorers: Record<string, Scorer<I, O>>;
  concurrency?: number;
}

export async function runEval<I, O>(opts: RunEvalOpts<I, O>): Promise<EvalSummary<I, O>> {
  const limit = pLimit(opts.concurrency ?? 4);

  const runCase = async (c: Case<I, O>): Promise<EvalResult<I, O>> => {
    const usageAcc = createUsageAccumulator();
    const start = performance.now();

    let output: O | undefined;
    let taskError: { code: string; message: string } | undefined;

    try {
      output = await opts.task(c.input);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      taskError = { code: 'task_error', message: msg };
    }

    const scores: Array<{ name: string; score: import('./types.js').Score }> = [];

    if (taskError === undefined && output !== undefined) {
      for (const [name, scorer] of Object.entries(opts.scorers)) {
        try {
          const score = await scorer({
            input: c.input,
            output,
            expected: c.expected,
            metadata: c.metadata,
          });
          scores.push({ name, score });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          scores.push({
            name,
            score: { pass: false, score: 0, reason: `scorer_error: ${msg}` },
          });
        }
      }
    }

    const durationMs = performance.now() - start;

    return {
      case: c,
      output,
      scores,
      usage: usageAcc.getAll(),
      durationMs,
      error: taskError,
    };
  };

  const results = await Promise.all(opts.cases.map((c) => limit(() => runCase(c))));

  const totalAcc = createUsageAccumulator();
  let totalDurationMs = 0;
  let allPassCount = 0;

  for (const r of results) {
    totalAcc.merge(r.usage);
    totalDurationMs += r.durationMs;
    const allPass =
      r.error === undefined && r.scores.length > 0 && r.scores.every((s) => s.score.pass);
    if (allPass) allPassCount++;
  }

  const passRate = results.length > 0 ? allPassCount / results.length : 0;

  return {
    name: opts.name,
    results,
    passRate,
    totalDurationMs,
    totalUsage: totalAcc.getAll(),
  };
}
