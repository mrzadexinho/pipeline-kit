/**
 * Sample Zod schemas exercising z.discriminatedUnion() on the `type` field.
 * Used by: pk gen-py-schema fixture + regen-stability CI check (gen-py-schema:check-union).
 *
 * Intentionally uses only vanilla Zod features (no .refine, .transform,
 * .brand, .preprocess, .pipe) — these would trigger the feature-gap check.
 *
 * The three variants (DataFrame / ErrorFrame / ProgressFrame) model a
 * streaming wire protocol frame that Python adapters must decode.
 */

import { z } from 'zod';

const DataFrame = z.object({
  type: z.literal('data'),
  payload: z.object({ value: z.string() }),
});

const ErrorFrame = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

const ProgressFrame = z.object({
  type: z.literal('progress'),
  percent: z.number().int().min(0).max(100),
});

export const WireFrame = z.discriminatedUnion('type', [DataFrame, ErrorFrame, ProgressFrame]);
