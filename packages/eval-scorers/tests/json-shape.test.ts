import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonShape } from '../src/json-shape.js';

describe('jsonShape', () => {
  it('passes when output matches Zod schema', () => {
    const scorer = jsonShape<unknown, unknown>({
      zodSchema: z.object({ name: z.string(), age: z.number() }),
    });
    const result = scorer({ input: null, output: { name: 'Alice', age: 30 } });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it('fails with zod issue list when output mismatches', () => {
    const scorer = jsonShape<unknown, unknown>({
      zodSchema: z.object({ name: z.string(), age: z.number() }),
    });
    const result = scorer({ input: null, output: { name: 'Alice', age: 'old' } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/zod parse failed:/);
    expect(result.reason).toMatch(/age/);
  });

  it('empty schema z.object({}) passes any object', () => {
    const scorer = jsonShape<unknown, unknown>({ zodSchema: z.object({}) });
    const result = scorer({ input: null, output: { foo: 'bar', baz: 123 } });
    expect(result.pass).toBe(true);
  });

  it('optional field missing still passes', () => {
    const scorer = jsonShape<unknown, unknown>({
      zodSchema: z.object({ name: z.string(), tag: z.string().optional() }),
    });
    const result = scorer({ input: null, output: { name: 'Bob' } });
    expect(result.pass).toBe(true);
  });
});
