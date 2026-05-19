# @idriszade/eval

Braintrust-style eval runner for pipeline-kit. Define test cases, a task function, and one or more scorers; run them in parallel with configurable concurrency; collect per-case `EvalResult` and a rolled-up `EvalSummary`. The API surface is a common-denominator design aligned with Braintrust, Inspect AI, Promptfoo, and LangSmith — scorer results are typed `Score` objects, not opaque strings.

## Installation

```bash
pnpm add @idriszade/eval
```

## Quick start

```ts
import { defineEval } from '@idriszade/eval';
import { exactMatch, llmJudge } from '@idriszade/eval-scorers';

const myEval = defineEval({
  name: 'summarise-v1',
  cases: [
    { input: 'The cat sat on the mat.', expected: 'A cat is on a mat.' },
    { input: 'Water boils at 100°C.', expected: 'Water boils at 100 degrees Celsius.' },
  ],
  task: async (input) => {
    // Call your model or pipeline here.
    return await mySummariser(input);
  },
  scorers: {
    exact: exactMatch(),
    judge: llmJudge({ model: 'gpt-4o', client: myModelClient }),
  },
  concurrency: 4,
});

const summary = await myEval.run();
console.log(summary.passRate);        // fraction where ALL scorers passed
console.log(summary.totalUsage);      // merged UsageAccumulator snapshot
```

## API

### `defineEval(opts)`

Returns a `DefinedEval` with a `.run()` method.

```ts
interface DefineEvalOpts<I, O> {
  name: string;
  cases: ReadonlyArray<Case<I, O>>;
  task: (input: I) => Promise<O> | O;
  scorers: Record<string, Scorer<I, O>>;
  concurrency?: number;          // default: unbounded (all cases in parallel)
  judge?: { model: string; rubric?: string };  // metadata only — wire llmJudge in scorers
}
```

### `runEval(opts)`

Lower-level function if you want to skip the `DefinedEval` wrapper.

### `Scorer<I, O>`

```ts
type Scorer<I, O> = (args: {
  input: I;
  output: O;
  expected?: O;
  metadata?: Record<string, unknown>;
}) => Score | Promise<Score>;
```

## EvalSummary shape

```ts
interface EvalSummary<I, O> {
  name: string;
  results: ReadonlyArray<EvalResult<I, O>>;
  passRate: number;              // fraction where all scorer scores pass
  totalDurationMs: number;
  totalUsage: ReadonlyMap<string, number>;
}

interface EvalResult<I, O> {
  case: Case<I, O>;
  output?: O;
  scores: Array<{ name: string; score: Score }>;
  usage: ReadonlyMap<string, number>;
  durationMs: number;
  error?: { code: string; message: string };
}
```

## Concurrency

`concurrency` controls the maximum number of cases running at the same time. Omitting it runs all cases in parallel. Set it to `1` for sequential execution (useful when rate-limiting a model).

```ts
defineEval({ ..., concurrency: 5 });
```

## Errors are captured

If `task` throws, the case gets `EvalResult.error` and all scorers produce `{ pass: false, score: 0 }`. If a scorer throws, that scorer's `Score` carries a `reason` describing the error. Neither propagates as a rejected promise — `run()` always resolves.

## Usage tracking

`EvalResult.usage` is a snapshot of the `UsageAccumulator` recorded during that case's task execution. `EvalSummary.totalUsage` merges all per-case snapshots — it is the union of all recorded keys with values summed across cases.

Wire `UsageAccumulator` into your task via the kit context to get automatic per-case tracking:

```ts
task: async (input, ctx) => {
  const result = await myProcess.execute(input, ctx);
  // ctx.usage is populated inside execute(); the runner reads it after.
  return result.data;
},
```

## License — MIT
