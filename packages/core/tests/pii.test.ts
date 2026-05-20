import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  formatRedacted,
  formatSecret,
  markRedact,
  markSecret,
  REDACT_TAG,
  SECRET_TAG,
  walkAnnotations,
} from '../src/pii.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('PII constants', () => {
  it('REDACT_TAG is @redact', () => {
    expect(REDACT_TAG).toBe('@redact');
  });

  it('SECRET_TAG is @secret', () => {
    expect(SECRET_TAG).toBe('@secret');
  });

  it('tags are string literals', () => {
    // Type-level: these should be string literal types, not just string
    const r: '@redact' = REDACT_TAG;
    const s: '@secret' = SECRET_TAG;
    expect(r).toBe('@redact');
    expect(s).toBe('@secret');
  });
});

// ─── markRedact / markSecret ──────────────────────────────────────────────────

describe('markRedact', () => {
  it('sets .description to REDACT_TAG', () => {
    const schema = markRedact(z.string());
    expect(schema.description).toBe(REDACT_TAG);
  });

  it('preserves narrow generic — inferred type is still string', () => {
    const schema = markRedact(z.string());
    // z.infer<> round-trip: if the generic is lost the type would widen to ZodTypeAny
    type Inferred = z.infer<typeof schema>;
    const value: Inferred = 'hello'; // must compile
    expect(value).toBe('hello');
  });

  it('works on object schemas', () => {
    const schema = markRedact(z.object({ a: z.string() }));
    expect(schema.description).toBe(REDACT_TAG);
  });
});

describe('markSecret', () => {
  it('sets .description to SECRET_TAG', () => {
    const schema = markSecret(z.string());
    expect(schema.description).toBe(SECRET_TAG);
  });

  it('preserves narrow generic — inferred type is still string', () => {
    const schema = markSecret(z.string());
    type Inferred = z.infer<typeof schema>;
    const value: Inferred = 'token'; // must compile
    expect(value).toBe('token');
  });

  it('works on number schemas', () => {
    const schema = markSecret(z.number());
    expect(schema.description).toBe(SECRET_TAG);
  });
});

// ─── walkAnnotations ──────────────────────────────────────────────────────────

describe('walkAnnotations', () => {
  it('returns empty array for empty object schema', () => {
    expect(walkAnnotations(z.object({}))).toEqual([]);
  });

  it('returns empty array for plain flat schema with no annotations', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    expect(walkAnnotations(schema)).toEqual([]);
  });

  it('flat object — single @redact field', () => {
    const schema = z.object({
      name: z.string(),
      email: markRedact(z.string()),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['email'], tag: 'redact' });
  });

  it('nested object — @secret on leaf', () => {
    const schema = z.object({
      user: z.object({
        password: markSecret(z.string()),
      }),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['user', 'password'], tag: 'secret' });
  });

  it('@redact on subtree — does NOT descend into children (recursive scope)', () => {
    const schema = z.object({
      profile: markRedact(z.object({ a: z.string(), b: z.string() })),
    });
    const annotations = walkAnnotations(schema);
    // Only one annotation at the subtree root; children are not walked
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['profile'], tag: 'redact' });
  });

  it('@secret on non-leaf object — no annotation emitted; children still walked', () => {
    const schema = z.object({
      creds: markSecret(z.object({ token: z.string() })),
    });
    const annotations = walkAnnotations(schema);
    // @secret on object is ignored; unmarked child token produces no annotation either
    expect(annotations).toHaveLength(0);
  });

  it('@secret on non-leaf object — children with @secret ARE annotated', () => {
    const schema = z.object({
      creds: markSecret(z.object({ token: markSecret(z.string()) })),
    });
    const annotations = walkAnnotations(schema);
    // creds itself is ignored (non-leaf); creds.token is a marked leaf
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['creds', 'token'], tag: 'secret' });
  });

  it('@secret on leaf — annotated', () => {
    const schema = z.object({ token: markSecret(z.string()) });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['token'], tag: 'secret' });
  });

  it('array element with @redact — path segment is "[]"', () => {
    const schema = z.object({
      emails: z.array(markRedact(z.string())),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['emails', '[]'], tag: 'redact' });
  });

  it('optional wrapper is transparent — @secret on optional string', () => {
    const schema = z.object({
      pwd: markSecret(z.string()).optional(),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['pwd'], tag: 'secret' });
  });

  it('nullable wrapper is transparent — @redact on nullable string', () => {
    const schema = z.object({
      ssn: markRedact(z.string()).nullable(),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['ssn'], tag: 'redact' });
  });

  it('default wrapper is transparent — @secret on string with default', () => {
    const schema = z.object({
      apiKey: markSecret(z.string()).default(''),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['apiKey'], tag: 'secret' });
  });

  it('union — records only marked options', () => {
    const schema = z.object({
      value: z.union([markRedact(z.string()), z.number()]),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({ path: ['value'], tag: 'redact' });
  });

  it('union — both options marked', () => {
    const schema = z.object({
      value: z.union([markRedact(z.string()), markRedact(z.number())]),
    });
    const annotations = walkAnnotations(schema);
    expect(annotations).toHaveLength(2);
    for (const a of annotations) {
      expect(a).toEqual({ path: ['value'], tag: 'redact' });
    }
  });

  it('does not throw on unknown-kind input — returns empty array', () => {
    // Simulate an unknown kind by passing a plain object cast as ZodTypeAny
    const unknown = {
      _zod: { def: { type: 'totally-unknown-type-xyz' } },
      description: undefined,
    } as unknown as import('zod').ZodTypeAny;
    expect(() => walkAnnotations(unknown)).not.toThrow();
    expect(walkAnnotations(unknown)).toEqual([]);
  });
});

// ─── formatRedacted ───────────────────────────────────────────────────────────

describe('formatRedacted', () => {
  it('wraps value length in <redacted:N>', () => {
    expect(formatRedacted('hello')).toBe('<redacted:5>');
  });

  it('empty string produces <redacted:0>', () => {
    expect(formatRedacted('')).toBe('<redacted:0>');
  });

  it('unicode: JS .length counts UTF-16 code units', () => {
    // 'é' is a single code point and a single UTF-16 code unit → length 1
    expect(formatRedacted('é')).toBe('<redacted:1>');
  });

  it('emoji (surrogate pair) counts as 2 UTF-16 code units', () => {
    // '😀' is a surrogate pair in UTF-16 → .length === 2
    expect(formatRedacted('😀')).toBe('<redacted:2>');
  });
});

// ─── formatSecret ─────────────────────────────────────────────────────────────

describe('formatSecret', () => {
  it('produces <secret:XXXXXXXX> with 8-char hex SHA-256 prefix for "hello"', () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(formatSecret('hello')).toBe('<secret:2cf24dba>');
  });

  it('produces correct hash for empty string', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(formatSecret('')).toBe('<secret:e3b0c442>');
  });

  it('is stable — same input always produces same output', () => {
    expect(formatSecret('my-api-key')).toBe(formatSecret('my-api-key'));
  });

  it('different inputs produce different outputs', () => {
    expect(formatSecret('a')).not.toBe(formatSecret('b'));
  });

  it('result is exactly 8 hex chars between the colons', () => {
    const result = formatSecret('any-value');
    const match = result.match(/^<secret:([0-9a-f]+)>$/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toHaveLength(8);
  });
});
