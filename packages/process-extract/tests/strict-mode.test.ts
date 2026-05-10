import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toJSONSchema, z } from 'zod';
import { applyStrictMode } from '../src/strict-mode.js';

describe('applyStrictMode', () => {
  it('strips top-level default', () => {
    const result = applyStrictMode({ type: 'string', default: 'foo' });
    expect(result).toEqual({ type: 'string' });
  });

  it('strips nested default recursively', () => {
    const result = applyStrictMode({
      type: 'object',
      properties: {
        name: { type: 'string', default: 'Alice' },
        meta: { type: 'object', properties: { score: { type: 'number', default: 0 } } },
      },
    }) as Record<string, unknown>;
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: 'string' });
    const meta = props.meta as Record<string, unknown>;
    const metaProps = meta.properties as Record<string, Record<string, unknown>>;
    expect(metaProps.score).toEqual({ type: 'number' });
  });

  it('strips $schema', () => {
    const result = applyStrictMode({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { x: { type: 'number' } },
    }) as Record<string, unknown>;
    expect(result.$schema).toBeUndefined();
  });

  it('sets additionalProperties=false on every nested object', () => {
    const result = applyStrictMode({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: { type: 'object', properties: { leaf: { type: 'string' } } },
          },
        },
      },
    }) as Record<string, unknown>;
    expect(result.additionalProperties).toBe(false);
    const outer = (result.properties as Record<string, Record<string, unknown>>).outer;
    expect(outer.additionalProperties).toBe(false);
    const inner = (outer.properties as Record<string, Record<string, unknown>>).inner;
    expect(inner.additionalProperties).toBe(false);
  });

  it('sets required to all property keys on every nested object', () => {
    const result = applyStrictMode({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        nested: {
          type: 'object',
          properties: { x: { type: 'string' }, y: { type: 'string' } },
        },
      },
    }) as Record<string, unknown>;
    expect(result.required).toEqual(['a', 'b', 'nested']);
    const nested = (result.properties as Record<string, Record<string, unknown>>).nested;
    expect(nested.required).toEqual(['x', 'y']);
  });

  it('preserves array.items shape and recurses into them', () => {
    const result = applyStrictMode({
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string', default: 'foo' } },
      },
    }) as Record<string, unknown>;
    expect(result.type).toBe('array');
    const items = result.items as Record<string, unknown>;
    expect(items.type).toBe('object');
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(['name']);
    const props = items.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: 'string' });
  });

  it('preserves and recurses into anyOf / oneOf / allOf', () => {
    const result = applyStrictMode({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string', default: 'x' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
      oneOf: [{ type: 'string' }],
      allOf: [{ type: 'object', properties: { c: { type: 'boolean' } } }],
    }) as Record<string, unknown>;
    const anyOf = result.anyOf as Array<Record<string, unknown>>;
    expect(anyOf).toHaveLength(2);
    expect(anyOf[0]?.additionalProperties).toBe(false);
    expect(anyOf[0]?.required).toEqual(['a']);
    const a = (anyOf[0]?.properties as Record<string, Record<string, unknown>>).a;
    expect(a).toEqual({ type: 'string' });
    expect(result.oneOf).toEqual([{ type: 'string' }]);
    const allOf = result.allOf as Array<Record<string, unknown>>;
    expect(allOf[0]?.additionalProperties).toBe(false);
  });

  it('is a no-op on primitive values', () => {
    expect(applyStrictMode('hello')).toBe('hello');
    expect(applyStrictMode(42)).toBe(42);
    expect(applyStrictMode(true)).toBe(true);
    expect(applyStrictMode(null)).toBe(null);
    expect(applyStrictMode(undefined)).toBe(undefined);
  });

  it('is idempotent (applying twice equals applying once)', () => {
    const input = {
      type: 'object',
      properties: {
        a: { type: 'string', default: 'foo' },
        items: {
          type: 'array',
          items: { type: 'object', properties: { z: { type: 'number' } } },
        },
      },
    };
    const once = applyStrictMode(input);
    const twice = applyStrictMode(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input schema', () => {
    const input = {
      type: 'object',
      properties: { a: { type: 'string', default: 'x' } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    applyStrictMode(input);
    expect(input).toEqual(snapshot);
  });

  it('property: random Zod 4 object schemas always produce strict-mode-valid JSON Schema', () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.constant(z.string()),
          b: fc.constant(z.number()),
          c: fc.constant(z.boolean()),
        }),
        (shape) => {
          const zodSchema = z.object({
            ...(Math.random() > 0.5 ? { a: shape.a } : {}),
            b: shape.b,
            ...(Math.random() > 0.5 ? { c: shape.c } : {}),
          });
          const raw = toJSONSchema(zodSchema);
          const strict = applyStrictMode(raw) as Record<string, unknown>;
          // Root must be type: object
          expect(strict.type).toBe('object');
          // additionalProperties must be false
          expect(strict.additionalProperties).toBe(false);
          // required must equal all property keys
          const props = strict.properties as Record<string, unknown>;
          expect(strict.required).toEqual(Object.keys(props));
          // No `default` or `$schema` anywhere at root
          expect(strict.default).toBeUndefined();
          expect(strict.$schema).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('integration: Zod 4 schema with .default() yields type=object after strictify', () => {
    const schema = z.object({
      name: z.string(),
      tags: z.array(z.string()).default([]),
      count: z.number().default(0),
    });
    const raw = toJSONSchema(schema);
    const strict = applyStrictMode(raw) as Record<string, unknown>;
    expect(strict.type).toBe('object');
    expect(strict.additionalProperties).toBe(false);
    const props = strict.properties as Record<string, Record<string, unknown>>;
    expect(props.tags?.default).toBeUndefined();
    expect(props.count?.default).toBeUndefined();
  });
});
