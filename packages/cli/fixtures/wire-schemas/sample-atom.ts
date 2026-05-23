/**
 * Sample Zod schemas representing the wire Atom shape.
 * Used by: pk gen-py-schema fixture + regen-stability CI check.
 *
 * Intentionally uses only vanilla Zod features (no .refine, .transform,
 * .brand, .preprocess, .pipe) — these would trigger the feature-gap check.
 */

import { z } from 'zod';

export const Job = z.object({
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  salary_min: z.number().int().nonnegative(),
  salary_max: z.number().int().nonnegative(),
});

export const Atom = z.object({
  id: z.string().regex(/^pk_atom_[A-Z0-9]{26}$/),
  object: z.literal('atom'),
  // RFC-3339 wire format; validation happens at boundary, not in schema
  created_at: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  data: Job,
});
