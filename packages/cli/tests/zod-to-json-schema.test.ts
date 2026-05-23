/**
 * Unit tests for `zod-to-json-schema.ts`.
 *
 * Pure TypeScript logic — no subprocess required. Tests validate that
 * `emitJsonSchema` correctly wraps Zod v4's native JSON Schema emission.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { emitJsonSchema } from '../src/lib/zod-to-json-schema.js';

// ---------------------------------------------------------------------------
// Basic emission
// ---------------------------------------------------------------------------

describe('emitJsonSchema — basic emission', () => {
  it('returns a JSON string', () => {
    const result = emitJsonSchema({ MySchema: z.string() });
    expect(typeof result).toBe('string');
    // Must be valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('emitted document has $schema key for Draft 2020-12', () => {
    const result = emitJsonSchema({ MySchema: z.string() });
    const doc = JSON.parse(result) as Record<string, unknown>;
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('emitted document has $ref pointing to the first schema', () => {
    const result = emitJsonSchema({ MySchema: z.string() });
    const doc = JSON.parse(result) as Record<string, unknown>;
    expect(doc.$ref).toBe('#/$defs/MySchema');
  });

  it('emitted document has $defs containing the schema', () => {
    const result = emitJsonSchema({ MySchema: z.string() });
    const doc = JSON.parse(result) as { $defs: Record<string, unknown> };
    expect(doc.$defs).toBeDefined();
    expect(doc.$defs.MySchema).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Single schema shapes
// ---------------------------------------------------------------------------

describe('emitJsonSchema — single schema shapes', () => {
  it('emits a string schema', () => {
    const result = emitJsonSchema({ S: z.string() });
    const doc = JSON.parse(result) as { $defs: { S: { type: string } } };
    expect(doc.$defs.S.type).toBe('string');
  });

  it('emits a number schema', () => {
    const result = emitJsonSchema({ N: z.number() });
    const doc = JSON.parse(result) as { $defs: { N: { type: string } } };
    expect(doc.$defs.N.type).toBe('number');
  });

  it('emits a boolean schema', () => {
    const result = emitJsonSchema({ B: z.boolean() });
    const doc = JSON.parse(result) as { $defs: { B: { type: string } } };
    expect(doc.$defs.B.type).toBe('boolean');
  });

  it('emits an object schema with properties', () => {
    const schema = z.object({ name: z.string(), age: z.number().int() });
    const result = emitJsonSchema({ User: schema });
    const doc = JSON.parse(result) as {
      $defs: { User: { type: string; properties: Record<string, unknown> } };
    };
    expect(doc.$defs.User.type).toBe('object');
    expect(doc.$defs.User.properties.name).toBeDefined();
    expect(doc.$defs.User.properties.age).toBeDefined();
  });

  it('emits an array schema', () => {
    const schema = z.array(z.string());
    const result = emitJsonSchema({ Tags: schema });
    const doc = JSON.parse(result) as {
      $defs: { Tags: { type: string; items?: unknown } };
    };
    expect(doc.$defs.Tags.type).toBe('array');
  });
});

// ---------------------------------------------------------------------------
// Multiple schemas
// ---------------------------------------------------------------------------

describe('emitJsonSchema — multiple schemas', () => {
  it('$ref points to the FIRST schema in insertion order', () => {
    const result = emitJsonSchema({
      Alpha: z.string(),
      Beta: z.number(),
    });
    const doc = JSON.parse(result) as Record<string, unknown>;
    expect(doc.$ref).toBe('#/$defs/Alpha');
  });

  it('all schemas appear under $defs', () => {
    const result = emitJsonSchema({
      A: z.string(),
      B: z.number(),
      C: z.boolean(),
    });
    const doc = JSON.parse(result) as { $defs: Record<string, unknown> };
    expect(doc.$defs.A).toBeDefined();
    expect(doc.$defs.B).toBeDefined();
    expect(doc.$defs.C).toBeDefined();
  });

  it('each $defs entry is an independent schema object', () => {
    const result = emitJsonSchema({
      Name: z.string(),
      // z.number().int() emits type:'integer' in JSON Schema Draft 2020-12
      Count: z.number().int().nonnegative(),
    });
    const doc = JSON.parse(result) as {
      $defs: { Name: { type: string }; Count: { type: string } };
    };
    expect(doc.$defs.Name.type).toBe('string');
    // Zod v4 emits 'integer' for .int() constrained numbers
    expect(doc.$defs.Count.type).toBe('integer');
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('emitJsonSchema — error cases', () => {
  it('throws when schemas map is empty', () => {
    expect(() => emitJsonSchema({})).toThrow('no schemas provided');
  });
});

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

describe('emitJsonSchema — output format', () => {
  it('returns pretty-printed JSON (2-space indent)', () => {
    const result = emitJsonSchema({ S: z.string() });
    // Pretty JSON has newlines
    expect(result).toContain('\n');
    // Standard 2-space indent
    expect(result).toMatch(/^ {2}/m);
  });

  it('output is stable across calls with same input', () => {
    const schema = z.object({ id: z.string(), val: z.number() });
    const r1 = emitJsonSchema({ Stable: schema });
    const r2 = emitJsonSchema({ Stable: schema });
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// Complex schemas
// ---------------------------------------------------------------------------

describe('emitJsonSchema — complex schemas', () => {
  it('handles nested objects', () => {
    const schema = z.object({
      meta: z.object({
        title: z.string(),
        version: z.number().int(),
      }),
    });
    const result = emitJsonSchema({ Doc: schema });
    // Valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
    const doc = JSON.parse(result) as {
      $defs: { Doc: { type: string } };
    };
    expect(doc.$defs.Doc.type).toBe('object');
  });

  it('handles z.union()', () => {
    const schema = z.union([z.string(), z.number()]);
    const result = emitJsonSchema({ StringOrNum: schema });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('handles z.enum()', () => {
    const schema = z.enum(['a', 'b', 'c']);
    const result = emitJsonSchema({ MyEnum: schema });
    const doc = JSON.parse(result) as { $defs: { MyEnum: { enum?: unknown } } };
    expect(doc.$defs.MyEnum.enum).toBeDefined();
  });

  it('handles z.optional() fields in object', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = emitJsonSchema({ WithOptional: schema });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
