import { expect, test } from 'tstyche';

test('@pipeline-kit/process-reviewable type-tests bootstrap', () => {
  expect<string>().type.toBe<string>();
});
