import { type ZodType, z } from 'zod';

/**
 * Derives a Zod schema from a JSON Schema object.
 *
 * Supports primitive types (string, number, boolean) and flat objects.
 * Falls back to z.unknown() for unsupported shapes (arrays, nested objects,
 * $ref, oneOf, anyOf, etc.).
 */
export function deriveZodFromJsonSchema(jsonSchema: unknown): ZodType<unknown> {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    return z.unknown();
  }

  const s = jsonSchema as Record<string, unknown>;

  switch (s.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'integer':
      return z.number().int();
    case 'object': {
      // flat-object only: no nested objects, no $ref, no oneOf/anyOf
      if (
        '$ref' in s ||
        'oneOf' in s ||
        'anyOf' in s ||
        'allOf' in s ||
        typeof s.properties !== 'object' ||
        s.properties === null
      ) {
        return z.unknown();
      }

      const props = s.properties as Record<string, unknown>;
      const shape: Record<string, ZodType<unknown>> = {};

      for (const [key, val] of Object.entries(props)) {
        const derived = deriveZodFromJsonSchema(val);
        // If the property is a nested object, fall back to z.unknown() for the whole object
        if (
          typeof val === 'object' &&
          val !== null &&
          (val as Record<string, unknown>).type === 'object'
        ) {
          return z.unknown();
        }
        shape[key] = derived;
      }

      return z.object(shape).passthrough();
    }
    default:
      return z.unknown();
  }
}
