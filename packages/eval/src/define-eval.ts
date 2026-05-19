import { runEval } from './runner.js';
import type { Case, EvalSummary, Scorer } from './types.js';

export interface DefineEvalOpts<I, O> {
  name: string;
  cases: ReadonlyArray<Case<I, O>>;
  task: (input: I) => Promise<O> | O;
  scorers: Record<string, Scorer<I, O>>;
  concurrency?: number;
  /**
   * Forward-reference: if set, callers should supply an llmJudge scorer from
   * @idriszade/eval-scorers. The factory does NOT auto-inject it (avoids
   * circular dep). The field is preserved on the returned DefinedEval so
   * external code can read it.
   */
  judge?: { model: string; rubric?: string };
}

export interface DefinedEval<I, O> {
  readonly name: string;
  readonly judge?: { model: string; rubric?: string };
  run(): Promise<EvalSummary<I, O>>;
}

export function defineEval<I, O>(opts: DefineEvalOpts<I, O>): DefinedEval<I, O> {
  if (opts.cases.length === 0) {
    throw new Error('defineEval: cases must be non-empty');
  }

  const hasScorers = Object.keys(opts.scorers).length > 0;
  if (!hasScorers && opts.judge === undefined) {
    throw new Error('defineEval: at least one scorer or a judge must be configured');
  }

  return {
    name: opts.name,
    judge: opts.judge,
    run(): Promise<EvalSummary<I, O>> {
      return runEval({
        name: opts.name,
        cases: opts.cases,
        task: opts.task,
        scorers: opts.scorers,
        concurrency: opts.concurrency,
      });
    },
  };
}
