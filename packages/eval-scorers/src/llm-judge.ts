import type { Scorer } from '@idriszade/eval';

export interface ModelClient {
  judge(args: {
    model: string;
    system?: string;
    user: string;
  }): Promise<{ pass: boolean; score: number; reason?: string }>;
}

export interface LlmJudgeOpts {
  model: string;
  rubric?: string;
  /** Inject a ModelClient for testability — caller wires the real SDK. */
  client: ModelClient;
}

export function llmJudge<I, O>(opts: LlmJudgeOpts): Scorer<I, O> {
  return async ({ input, output, expected, metadata }) => {
    const rubric = opts.rubric ?? defaultRubric();
    const user = JSON.stringify({ input, output, expected, metadata });
    const verdict = await opts.client.judge({
      model: opts.model,
      system: `You are an evaluator. Rubric: ${rubric}. Return JSON {pass:boolean, score:number, reason:string}.`,
      user,
    });
    return { pass: verdict.pass, score: verdict.score, reason: verdict.reason };
  };
}

function defaultRubric(): string {
  return 'Score 1.0 if output is correct vs expected, 0.0 otherwise. Be strict.';
}
