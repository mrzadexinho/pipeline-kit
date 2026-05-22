/**
 * Detects Zod features that have no stable JSON Schema equivalent.
 *
 * Supported gap categories (Zod v4 internal def inspection):
 *   - `transform`  — `type: 'pipe'` with `out.def.type === 'transform'` (non-preprocess)
 *   - `preprocess` — `type: 'pipe'` with `in.def.type === 'transform'` (created by z.preprocess)
 *   - `refine`     — custom checks (`kind === 'custom'`) attached to a schema
 *   - `brand`      — not detectable via def in Zod v4 (type-level only); detected via
 *                    instance-method heuristic (schema has `.brand` but def has no brand field)
 *   - `pipeline`   — `type: 'pipe'` where neither in nor out is a transform (a true pipe)
 *
 * Note: Zod v4 changed the internal def shape versus Zod v3. `.brand()` in v4 is a
 * TypeScript-only marker — it does not alter the runtime def. We do NOT attempt to detect
 * brands as they are transparent to JSON Schema emission.
 */

import type { ZodTypeAny } from 'zod';

export type GapFeature = 'refine' | 'transform' | 'brand' | 'pipeline' | 'preprocess';

export interface FeatureGap {
  /** Dot-path within the schema tree (e.g. "Atom.data.title"). */
  path: string;
  feature: GapFeature;
  hint: string;
}

// ---------------------------------------------------------------------------
// Internal helpers — Zod v4 def inspection
// ---------------------------------------------------------------------------

type AnyDef = Record<string, unknown>;

function getDef(schema: ZodTypeAny): AnyDef {
  // Zod v4: def is at schema._zod.def; Zod v3: schema._def
  // Cast through unknown to avoid structural overlap errors with strict Zod types.
  const asAny = schema as unknown as { _zod?: { def?: AnyDef }; _def?: AnyDef };
  const v4 = asAny._zod?.def;
  if (v4) return v4;
  return asAny._def ?? {};
}

function getType(schema: ZodTypeAny): string {
  const def = getDef(schema);
  return typeof def.type === 'string' ? def.type : '';
}

function getChecks(schema: ZodTypeAny): Array<AnyDef> {
  const def = getDef(schema);
  const checks = def.checks;
  return Array.isArray(checks) ? (checks as Array<AnyDef>) : [];
}

function getInSchema(schema: ZodTypeAny): ZodTypeAny | undefined {
  const def = getDef(schema);
  const inSchema = def.in;
  return inSchema != null ? (inSchema as ZodTypeAny) : undefined;
}

function getOutSchema(schema: ZodTypeAny): ZodTypeAny | undefined {
  const def = getDef(schema);
  const out = def.out;
  return out != null ? (out as ZodTypeAny) : undefined;
}

// ---------------------------------------------------------------------------
// Recursive traversal
// ---------------------------------------------------------------------------

function collectGaps(schema: ZodTypeAny, path: string, gaps: FeatureGap[]): void {
  const type = getType(schema);

  // ---- refine: custom checks on the schema's check array ----
  const checks = getChecks(schema);
  for (const check of checks) {
    const checkType = typeof check.type === 'string' ? check.type : '';
    if (checkType === 'custom') {
      gaps.push({
        path,
        feature: 'refine',
        hint: `Remove .refine() at '${path}' — use a Zod built-in check or move validation to Process stage.`,
      });
    }
  }

  // ---- pipe / transform / preprocess ----
  if (type === 'pipe') {
    const inS = getInSchema(schema);
    const outS = getOutSchema(schema);
    const inType = inS ? getType(inS) : '';
    const outType = outS ? getType(outS) : '';

    if (inType === 'transform') {
      // z.preprocess(fn, targetSchema) — in is always a transform shim
      gaps.push({
        path,
        feature: 'preprocess',
        hint: `Remove z.preprocess() at '${path}' — coerce at the Process stage boundary instead.`,
      });
      // Still recurse into the out schema
      if (outS) collectGaps(outS, path, gaps);
    } else if (outType === 'transform') {
      // z.transform() on an existing schema
      gaps.push({
        path,
        feature: 'transform',
        hint: `Remove .transform() at '${path}' — transformations are opaque to JSON Schema; move to Process.`,
      });
      // Recurse into the in schema (the base)
      if (inS) collectGaps(inS, path, gaps);
    } else {
      // True z.pipe() — both sides are concrete schemas
      gaps.push({
        path,
        feature: 'pipeline',
        hint: `Remove .pipe() at '${path}' — pipeline composition has no JSON Schema equivalent; use sequential Process stages.`,
      });
      if (inS) collectGaps(inS, `${path}.(pipe.in)`, gaps);
      if (outS) collectGaps(outS, `${path}.(pipe.out)`, gaps);
    }
    return; // do not recurse further generically for pipe
  }

  // ---- ZodObject — recurse into shape fields ----
  if (type === 'object') {
    const def = getDef(schema);
    const shape = def.shape as Record<string, ZodTypeAny> | undefined;
    if (shape) {
      for (const [field, fieldSchema] of Object.entries(shape)) {
        collectGaps(fieldSchema, `${path}.${field}`, gaps);
      }
    }
    return;
  }

  // ---- ZodArray — recurse into element ----
  if (type === 'array') {
    const def = getDef(schema);
    const element = def.element as ZodTypeAny | undefined;
    if (element) collectGaps(element, `${path}[]`, gaps);
    return;
  }

  // ---- ZodUnion / ZodDiscriminatedUnion — recurse into options ----
  if (type === 'union') {
    const def = getDef(schema);
    const options = def.options as ZodTypeAny[] | undefined;
    if (Array.isArray(options)) {
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (opt) collectGaps(opt, `${path}[${i}]`, gaps);
      }
    }
    return;
  }

  // ---- ZodOptional / ZodNullable — recurse into wrapped ----
  if (type === 'optional' || type === 'nullable' || type === 'nonoptional') {
    const def = getDef(schema);
    const inner = def.innerType as ZodTypeAny | undefined;
    if (inner) collectGaps(inner, path, gaps);
    return;
  }

  // ---- ZodDefault / ZodCatch / ZodReadonly / ZodNonOptional — recurse ----
  if (type === 'default' || type === 'catch' || type === 'readonly' || type === 'prefault') {
    const def = getDef(schema);
    const inner = (def.innerType ?? def.schema) as ZodTypeAny | undefined;
    if (inner) collectGaps(inner, path, gaps);
    return;
  }

  // ---- ZodIntersection — recurse both sides ----
  if (type === 'intersection') {
    const def = getDef(schema);
    const left = def.left as ZodTypeAny | undefined;
    const right = def.right as ZodTypeAny | undefined;
    if (left) collectGaps(left, `${path}.(left)`, gaps);
    if (right) collectGaps(right, `${path}.(right)`, gaps);
    return;
  }

  // ---- ZodTuple — recurse into items ----
  if (type === 'tuple') {
    const def = getDef(schema);
    const items = def.items as ZodTypeAny[] | undefined;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item) collectGaps(item, `${path}[${i}]`, gaps);
      }
    }
    return;
  }

  // ---- ZodRecord — recurse into value schema ----
  if (type === 'record') {
    const def = getDef(schema);
    const valueSchema = def.valueSchema as ZodTypeAny | undefined;
    if (valueSchema) collectGaps(valueSchema, `${path}[*]`, gaps);
    return;
  }

  // Primitives (string, number, boolean, literal, enum, etc.) — no further recursion needed
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect Zod features that have no JSON Schema equivalent.
 *
 * @param schemas - Record of export name → Zod schema (as returned by the TS loader).
 * @returns Array of feature gaps, empty if none found.
 */
export function detectFeatureGaps(schemas: Record<string, ZodTypeAny>): FeatureGap[] {
  const gaps: FeatureGap[] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    collectGaps(schema, name, gaps);
  }
  return gaps;
}
