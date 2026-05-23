/**
 * Unit tests for `feature-gap-check.ts`.
 *
 * All tests are uv-independent — pure TypeScript logic over Zod defs.
 * Covers: refine, transform, preprocess, pipeline, nested object, array,
 * union, optional/nullable wrappers, and the no-gap case.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { detectFeatureGaps } from '../src/lib/feature-gap-check.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run detectFeatureGaps with a single schema named 'Root'. */
function gaps(schema: z.ZodTypeAny) {
  return detectFeatureGaps({ Root: schema });
}

// ---------------------------------------------------------------------------
// No-gap cases
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — no-gap schemas', () => {
  it('returns empty array for a pure z.string()', () => {
    expect(gaps(z.string())).toHaveLength(0);
  });

  it('returns empty array for a plain z.object()', () => {
    const schema = z.object({
      id: z.string(),
      count: z.number().int().nonnegative(),
      active: z.boolean(),
    });
    expect(gaps(schema)).toHaveLength(0);
  });

  it('returns empty array for nested objects with no gaps', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      tags: z.array(z.string()),
    });
    expect(gaps(schema)).toHaveLength(0);
  });

  it('returns empty array when schemas map is empty', () => {
    expect(detectFeatureGaps({})).toHaveLength(0);
  });

  it('returns empty array for z.enum()', () => {
    expect(gaps(z.enum(['a', 'b', 'c']))).toHaveLength(0);
  });

  it('returns empty array for z.literal()', () => {
    expect(gaps(z.literal('hello'))).toHaveLength(0);
  });

  it('returns empty array for z.record()', () => {
    expect(gaps(z.record(z.string(), z.number()))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A. refine
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — refine', () => {
  it('detects .refine() at the top-level string', () => {
    const schema = z.string().refine((v) => v.length > 0, { message: 'non-empty' });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root');
  });

  it('detects .refine() on a field inside z.object()', () => {
    const schema = z.object({
      name: z.string().refine((v) => v.length > 0),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root.name');
  });

  it('detects .refine() on a number field inside z.object()', () => {
    const schema = z.object({
      score: z.number().refine((v) => v >= 0),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root.score');
  });

  it('hint mentions "Remove .refine()"', () => {
    const schema = z.string().refine((v) => v.length > 0);
    const result = gaps(schema);
    expect(result[0]?.hint).toMatch(/remove.*refine/i);
  });

  it('multiple .refine() calls on same field produce multiple gaps', () => {
    const schema = z.object({
      val: z
        .number()
        .refine((v) => v > 0)
        .refine((v) => v < 100),
    });
    const result = gaps(schema);
    // Each refine produces a 'custom' check entry
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.every((g) => g.feature === 'refine')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. transform
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — transform', () => {
  it('detects .transform() at the root', () => {
    const schema = z.string().transform((v) => v.toUpperCase());
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('transform');
    expect(result[0]?.path).toBe('Root');
  });

  it('detects .transform() on an object field', () => {
    const schema = z.object({
      label: z.string().transform((v) => v.trim()),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('transform');
    expect(result[0]?.path).toBe('Root.label');
  });

  it('hint mentions "Remove .transform()"', () => {
    const schema = z.string().transform((v) => v);
    const result = gaps(schema);
    expect(result[0]?.hint).toMatch(/remove.*transform/i);
  });
});

// ---------------------------------------------------------------------------
// C. preprocess
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — preprocess', () => {
  it('detects z.preprocess() at the root', () => {
    const schema = z.preprocess((v) => String(v), z.string());
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('preprocess');
    expect(result[0]?.path).toBe('Root');
  });

  it('detects z.preprocess() on a field', () => {
    const schema = z.object({
      amount: z.preprocess((v) => Number(v), z.number()),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('preprocess');
    expect(result[0]?.path).toBe('Root.amount');
  });

  it('hint mentions "Remove z.preprocess()"', () => {
    const schema = z.preprocess((v) => v, z.string());
    const result = gaps(schema);
    expect(result[0]?.hint).toMatch(/remove.*preprocess/i);
  });
});

// ---------------------------------------------------------------------------
// D. pipeline (.pipe)
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — pipeline (.pipe)', () => {
  it('detects .pipe() between two concrete schemas at root', () => {
    const schema = z.string().pipe(z.string().min(1));
    const result = gaps(schema);
    // pipeline gap should be reported
    const pipeGap = result.find((g) => g.feature === 'pipeline');
    expect(pipeGap).toBeDefined();
    expect(pipeGap?.path).toBe('Root');
  });

  it('hint mentions "Remove .pipe()"', () => {
    const schema = z.string().pipe(z.string());
    const result = gaps(schema);
    const pipeGap = result.find((g) => g.feature === 'pipeline');
    expect(pipeGap?.hint).toMatch(/remove.*pipe/i);
  });
});

// ---------------------------------------------------------------------------
// E. Nested traversal
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — nested traversal', () => {
  it('detects refine nested inside object > field', () => {
    const schema = z.object({
      outer: z.object({
        inner: z.string().refine((v) => v.length > 0),
      }),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root.outer.inner');
  });

  it('detects refine through array element', () => {
    const schema = z.object({
      items: z.array(z.string().refine((v) => v.length > 0)),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root.items[]');
  });

  it('detects refine in union member', () => {
    const schema = z.union([z.string().refine((v) => v.length > 0), z.number()]);
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root[0]');
  });

  it('detects refine through z.optional() wrapper', () => {
    const schema = z
      .string()
      .refine((v) => v.length > 0)
      .optional();
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
  });

  it('detects refine through z.nullable() wrapper', () => {
    const schema = z
      .string()
      .refine((v) => v.length > 0)
      .nullable();
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
  });

  it('detects refine on deeply nested: object > array > object > field', () => {
    const schema = z.object({
      outer: z.array(
        z.object({
          inner: z.object({
            refined: z.string().refine((v) => v.length > 0),
          }),
        }),
      ),
    });
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root.outer[].inner.refined');
  });
});

// ---------------------------------------------------------------------------
// F. Multiple schemas in the map
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — multiple schemas', () => {
  it('reports gaps from all schemas in the map', () => {
    const result = detectFeatureGaps({
      Clean: z.object({ name: z.string() }),
      Dirty: z.string().refine((v) => v.length > 0),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toMatch(/^Dirty/);
  });

  it('aggregates gaps from multiple schemas', () => {
    const result = detectFeatureGaps({
      A: z.string().refine((v) => v.length > 0),
      B: z.string().transform((v) => v.toLowerCase()),
    });
    const features = result.map((g) => g.feature);
    expect(features).toContain('refine');
    expect(features).toContain('transform');
  });
});

// ---------------------------------------------------------------------------
// G. Record / Tuple traversal
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — record and tuple traversal', () => {
  it('detects refine in record value', () => {
    const schema = z.record(
      z.string(),
      z.string().refine((v) => v.length > 0),
    );
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root[*]');
  });

  it('detects refine in tuple item', () => {
    const schema = z.tuple([z.string().refine((v) => v.length > 0), z.number()]);
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toBe('Root[0]');
  });
});

// ---------------------------------------------------------------------------
// H. Intersection traversal
// ---------------------------------------------------------------------------

describe('detectFeatureGaps — intersection traversal', () => {
  it('detects refine in intersection left arm', () => {
    const schema = z.intersection(
      z.object({ a: z.string().refine((v) => v.length > 0) }),
      z.object({ b: z.number() }),
    );
    const result = gaps(schema);
    expect(result).toHaveLength(1);
    expect(result[0]?.feature).toBe('refine');
    expect(result[0]?.path).toContain('Root.(left).a');
  });
});
