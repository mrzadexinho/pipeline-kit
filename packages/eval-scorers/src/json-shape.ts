import type { Scorer } from '@idriszade/eval';
import { type ZodType } from 'zod';

export function jsonShape<I, O>(opts: { zodSchema: ZodType }): Scorer<I, O> {
  return ({ output }) => {
    const result = opts.zodSchema.safeParse(output);
    if (result.success) return { pass: true, score: 1 };
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { pass: false, score: 0, reason: `zod parse failed: ${issues}` };
  };
}
