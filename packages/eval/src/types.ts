export interface Case<I, O = unknown> {
  input: I;
  expected?: O;
  metadata?: Record<string, unknown>;
}

export interface Score {
  pass: boolean;
  /** Typically 0..1 but unconstrained. */
  score: number;
  reason?: string;
}

export type Scorer<I, O> = (args: {
  input: I;
  output: O;
  expected?: O;
  metadata?: Record<string, unknown>;
}) => Score | Promise<Score>;

export interface EvalResult<I, O> {
  case: Case<I, O>;
  output?: O;
  scores: Array<{ name: string; score: Score }>;
  usage: ReadonlyMap<string, number>;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface EvalSummary<I, O> {
  name: string;
  results: ReadonlyArray<EvalResult<I, O>>;
  /** Fraction of results where ALL scorers passed. */
  passRate: number;
  totalDurationMs: number;
  totalUsage: ReadonlyMap<string, number>;
}
