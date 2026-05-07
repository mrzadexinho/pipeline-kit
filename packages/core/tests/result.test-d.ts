import { expect, test } from 'tstyche';
import type { ErrorEnvelope } from '../src/envelope.js';
import type { Result } from '../src/result.js';

declare const stringResult: Result<string>;
declare const numberWithCustomError: Result<
  number,
  { type: 'auth'; code: string; message: string }
>;
declare const okResult: Result<{ id: string }, ErrorEnvelope>;

test('Result<T> defaults E to ErrorEnvelope', () => {
  expect<Result<string>>().type.toBe<Result<string, ErrorEnvelope>>();
});

test('Result<T, E> error is exclusive — when error is null, data is T', () => {
  if (stringResult.error === null) {
    expect(stringResult.data).type.toBe<string>();
  }
});

test('Result<T, E> data is null when error is non-null', () => {
  if (stringResult.error !== null) {
    expect(stringResult.data).type.toBe<null>();
  }
});

test('Custom error type narrows correctly', () => {
  if (numberWithCustomError.error !== null) {
    expect(numberWithCustomError.error.type).type.toBe<'auth'>();
    expect(numberWithCustomError.error.code).type.toBe<string>();
  }
});

test('Object payload preserves shape on success', () => {
  if (okResult.error === null) {
    expect(okResult.data).type.toBe<{ id: string }>();
    expect(okResult.data.id).type.toBe<string>();
  }
});

test('Result<T, E> is union of two distinct branches (error: null OR error: E)', () => {
  expect<Result<number, ErrorEnvelope>>().type.toBeAssignableTo<
    { data: number; error: null } | { data: null; error: ErrorEnvelope }
  >();
});
