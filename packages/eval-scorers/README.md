# @idriszade/eval-scorers

Built-in scorers for `@idriszade/eval`. Each scorer is a factory returning a `Scorer<I, O>` — the same type accepted by `defineEval({ scorers })`. Provided: `exactMatch`, `numericClose`, `jsonShape`, `llmJudge`.

## Installation

```bash
pnpm add @idriszade/eval-scorers
```

## exactMatch

Recursive structural deep-equal. Handles `Date`, `Map`, `Set`, `NaN`, `null`, `undefined`, nested objects, and arrays.

```ts
import { exactMatch } from '@idriszade/eval-scorers';

const scorer = exactMatch<string, string>();

scorer({ input: 'q', output: 'foo', expected: 'foo' });
// { pass: true, score: 1 }

scorer({ input: 'q', output: 'foo', expected: 'bar' });
// { pass: false, score: 0 }
```

## numericClose

Passes when `Math.abs(output - expected) <= tolerance`.

```ts
import { numericClose } from '@idriszade/eval-scorers';

const scorer = numericClose({ tolerance: 0.01 });

scorer({ input: '', output: 3.14159, expected: Math.PI });
// { pass: true, score: 1 }

scorer({ input: '', output: 3.0, expected: Math.PI });
// { pass: false, score: 0, reason: 'abs diff 0.1416 > tolerance 0.01' }
```

`tolerance` defaults to `0` (exact equality).

## jsonShape

Validates output against a Zod schema via `safeParse`. Pass if parsing succeeds; fail with the formatted Zod error as `reason`.

```ts
import { jsonShape } from '@idriszade/eval-scorers';
import { z } from 'zod';

const scorer = jsonShape({
  zodSchema: z.object({ title: z.string(), tags: z.array(z.string()) }),
});

scorer({ input: '', output: { title: 'hello', tags: ['a'] } });
// { pass: true, score: 1 }

scorer({ input: '', output: { title: 42 } });
// { pass: false, score: 0, reason: 'Expected string, received number at title; ...' }
```

## llmJudge

LLM-as-judge. Calls a `ModelClient` you supply — no SDK is bundled. Returns `Score` from the model's verdict.

```ts
import { llmJudge } from '@idriszade/eval-scorers';
import type { ModelClient } from '@idriszade/eval-scorers';

// Implement ModelClient against any SDK.
const myClient: ModelClient = {
  async judge({ model, system, user }) {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system ?? '' },
        { role: 'user', content: user },
      ],
    });
    return JSON.parse(response.choices[0]?.message.content ?? '{}');
  },
};

const scorer = llmJudge({
  model: 'gpt-4o',
  rubric: 'Score 1.0 if the summary is factually accurate, 0.0 otherwise.',
  client: myClient,
});

// Use in defineEval:
defineEval({
  scorers: { judge: scorer },
  // ...
});
```

`rubric` defaults to a strict correct/incorrect prompt when omitted.

## LLM-as-judge is not a special type

`llmJudge` returns a plain `Scorer<I, O>` — the same type as `exactMatch` or `numericClose`. It calls a model internally, but from the runner's perspective it is just a function that returns a `Score`. There is no special eval-framework protocol. This mirrors the Braintrust/autoevals 2025–26 pattern of per-SDK scorer libraries rather than a built-in judge primitive.

```ts
// llmJudge and exactMatch are interchangeable at the call site.
defineEval({
  scorers: {
    shape: jsonShape({ zodSchema: mySchema }),
    correctness: llmJudge({ model: 'gpt-4o', client: myClient }),
  },
});
```

## License — MIT
