/**
 * PII annotation markers for Zod `.describe()` calls.
 *
 * - `markRedact` / `REDACT_TAG`: field should be fully redacted in logs/traces.
 *   Applied at any schema depth; covers the entire subtree (walker stops descent).
 * - `markSecret` / `SECRET_TAG`: leaf-only marker; value should be hashed before
 *   emitting to logs/traces. Non-leaf schemas with `@secret` are silently ignored.
 *
 * ADRs: VIII-6.a (annotation channel), VIII-6.b (secret hash),
 *       VIII-6.c (output formats), VIII-6.e (scope rules).
 *
 * @example
 * const UserSchema = z.object({
 *   name: z.string(),
 *   email: markRedact(z.string()),
 *   token: markSecret(z.string()),
 * });
 * walkAnnotations(UserSchema);
 * // => [{ path: ['email'], tag: 'redact' }, { path: ['token'], tag: 'secret' }]
 */

import { createHash } from 'node:crypto';
import type { z } from 'zod';

// ─── Constants ───────────────────────────────────────────────────────────────

export const REDACT_TAG = '@redact' as const;
export const SECRET_TAG = '@secret' as const;

// ─── Annotation markers ───────────────────────────────────────────────────────

/**
 * Mark a Zod schema field for full redaction in logs and traces.
 * Applies to the entire subtree rooted at this field.
 *
 * Sugar for `schema.describe(REDACT_TAG)`. Preserves the input generic.
 */
export function markRedact<T extends z.ZodTypeAny>(schema: T): T {
  return schema.describe(REDACT_TAG) as T;
}

/**
 * Mark a Zod schema field as secret material (leaf-only).
 * In logs and traces the raw value is replaced with a truncated SHA-256 hash.
 *
 * Sugar for `schema.describe(SECRET_TAG)`. Preserves the input generic.
 * Non-leaf schemas carrying this tag are silently ignored by `walkAnnotations`.
 */
export function markSecret<T extends z.ZodTypeAny>(schema: T): T {
  return schema.describe(SECRET_TAG) as T;
}

// ─── Walker types ─────────────────────────────────────────────────────────────

export type PiiTag = 'redact' | 'secret';

export interface PiiAnnotation {
  /** Dotted path from schema root, e.g. `['user', 'email']` or `[]` for root. */
  path: string[];
  tag: PiiTag;
}

// ─── Walker internals ─────────────────────────────────────────────────────────

/**
 * Leaf `def.type` values in Zod v4.
 * Arrays, objects, unions, records, etc. are non-leaf.
 */
const LEAF_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'enum',
  'literal',
  'date',
  'nativeEnum',
  'bigint',
]);

/**
 * Wrapper `def.type` values that should be unwrapped transparently
 * (no path segment consumed).
 */
const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default']);

function isLeaf(defType: string): boolean {
  return LEAF_TYPES.has(defType);
}

function getDefType(schema: z.ZodTypeAny): string | undefined {
  // Zod v4 stores the type in _zod.def.type
  return (schema as unknown as { _zod?: { def?: { type?: string } } })._zod?.def?.type;
}

function walkSchema(schema: z.ZodTypeAny, path: string[], out: PiiAnnotation[]): void {
  const defType = getDefType(schema);
  if (defType === undefined) {
    // Unknown kind — skip silently per spec
    return;
  }

  const desc: string | undefined = schema.description;

  // ── Redact check (any depth, stops descent) ──────────────────────────────
  if (desc === REDACT_TAG) {
    out.push({ path, tag: 'redact' });
    return; // do NOT descend into children
  }

  // ── Transparent wrappers — unwrap one level, preserve path ───────────────
  if (WRAPPER_TYPES.has(defType)) {
    const inner = (schema as unknown as { _zod: { def: { innerType: z.ZodTypeAny } } })._zod.def
      .innerType;
    walkSchema(inner, path, out);
    return;
  }

  // ── Pipe (ZodEffects / .transform / .pipe) — unwrap via def.in ───────────
  if (defType === 'pipe') {
    const inner = (schema as unknown as { _zod: { def: { in: z.ZodTypeAny } } })._zod.def.in;
    walkSchema(inner, path, out);
    return;
  }

  // ── Secret check (leaf-only) ──────────────────────────────────────────────
  if (desc === SECRET_TAG) {
    if (isLeaf(defType)) {
      out.push({ path, tag: 'secret' });
    }
    // Non-leaf with @secret: ignore tag, but still descend into children
    // (to find deeper leaf-level secrets). Fall through to type dispatch below.
  }

  // ── Type dispatch ─────────────────────────────────────────────────────────
  if (defType === 'object') {
    const shape = (schema as unknown as { _zod: { def: { shape: Record<string, z.ZodTypeAny> } } })
      ._zod.def.shape;
    for (const [key, child] of Object.entries(shape)) {
      walkSchema(child, [...path, key], out);
    }
    return;
  }

  if (defType === 'array') {
    const element = (schema as unknown as { _zod: { def: { element: z.ZodTypeAny } } })._zod.def
      .element;
    walkSchema(element, [...path, '[]'], out);
    return;
  }

  if (defType === 'record') {
    const valueType = (schema as unknown as { _zod: { def: { valueType: z.ZodTypeAny } } })._zod.def
      .valueType;
    walkSchema(valueType, [...path, '*'], out);
    return;
  }

  if (defType === 'union') {
    const options = (schema as unknown as { _zod: { def: { options: z.ZodTypeAny[] } } })._zod.def
      .options;
    for (const option of options) {
      walkSchema(option, path, out);
    }
    return;
  }

  // Leaf or unrecognised non-container: nothing more to do.
}

// ─── Public walker ────────────────────────────────────────────────────────────

/**
 * Walk a Zod schema and return all PII annotation sites.
 *
 * Semantics (ADR VIII-6.e):
 * - `@redact` on any node: records `{ path, tag: 'redact' }`; descent stops.
 * - `@secret` on a leaf node: records `{ path, tag: 'secret' }`.
 * - `@secret` on a non-leaf: tag ignored; children still traversed.
 * - Wrappers (Optional/Nullable/Default/pipe): transparent (no path segment).
 * - Arrays: element path segment is `'[]'`.
 * - Records: value-schema path segment is `'*'`.
 * - Unions: each option is walked; duplicates tolerated.
 * - Unknown Zod kinds: skipped silently (never throws).
 */
export function walkAnnotations(schema: z.ZodTypeAny): PiiAnnotation[] {
  const out: PiiAnnotation[] = [];
  walkSchema(schema, [], out);
  return out;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Format a redacted string value for safe emission to logs/traces.
 * Result: `<redacted:N>` where N is `value.length` (JS UTF-16 code units).
 */
export function formatRedacted(value: string): string {
  return `<redacted:${value.length}>`;
}

/**
 * Format a secret string value for safe emission to logs/traces.
 * Result: `<secret:XXXXXXXX>` where XXXXXXXX is the first 8 hex characters
 * of SHA-256(value). Stable across calls for the same input.
 */
export function formatSecret(value: string): string {
  const hash = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
  return `<secret:${hash}>`;
}
