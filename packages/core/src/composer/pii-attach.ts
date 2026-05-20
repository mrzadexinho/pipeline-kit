import type { ZodType } from 'zod';
import { type PiiAnnotation, walkAnnotations } from '../pii.js';

/**
 * Precompute PII annotations for a step's output schema at composer build time.
 *
 * Returns `undefined` when the schema is absent or yields no annotations,
 * so callers can gate span attribute writes on a truthiness check.
 *
 * ADR VIII-6.f: auto-attach `pk.pii_annotations` to step spans.
 */
export function precomputeStepPiiAnnotations(
  outputSchema: ZodType<unknown> | undefined,
): PiiAnnotation[] | undefined {
  if (!outputSchema) return undefined;
  const result = walkAnnotations(outputSchema);
  return result.length > 0 ? result : undefined;
}
