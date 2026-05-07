import { expect, test } from 'tstyche';

test('@pipeline-kit/core type-tests bootstrap', () => {
  expect<string>().type.toBe<string>();
});
