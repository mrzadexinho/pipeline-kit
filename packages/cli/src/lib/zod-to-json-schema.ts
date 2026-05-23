/**
 * Thin wrapper over Zod v4's native `z.toJSONSchema` (Draft 2020-12).
 *
 * Zod v4 ships built-in JSON Schema generation; no external adapter needed.
 * Each exported Zod schema is emitted under `$defs/<exportName>` and the root
 * `$ref` points to the first schema in insertion order.
 */

import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

export interface ZodSchemaModule {
  [exportName: string]: ZodTypeAny;
}

/**
 * Convert a map of named Zod schemas into a single JSON Schema Draft 2020-12
 * document. Each schema appears as a `$defs` entry; the root `$ref` resolves
 * to the first schema in the map.
 *
 * @param schemas - Record of export name → Zod schema instance.
 * @returns JSON Schema document string (compact JSON).
 */
export function emitJsonSchema(schemas: ZodSchemaModule): string {
  const entries = Object.entries(schemas);
  if (entries.length === 0) {
    throw new Error('emitJsonSchema: no schemas provided');
  }

  const $defs: Record<string, unknown> = {};
  for (const [name, schema] of entries) {
    // Generate per-schema; strip outer $schema wrapper, keep the inner def
    const raw = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      reused: 'ref',
      cycles: 'ref',
      unrepresentable: 'any',
    });
    $defs[name] = raw;
  }

  const firstKey = entries[0]?.[0];
  const doc = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: `#/$defs/${firstKey}`,
    $defs,
  };

  return JSON.stringify(doc, null, 2);
}
