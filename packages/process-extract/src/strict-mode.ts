/**
 * Strict-mode helpers for OpenAI structured outputs.
 *
 * OpenAI's `response_format: { type: 'json_schema', strict: true }` rejects
 * JSON Schemas that contain `default` values, `$schema` markers, or any
 * `type: "object"` node that is missing `additionalProperties: false` or
 * has `required` not equal to all property keys.
 *
 * Zod 4's native `toJSONSchema()` produces idiomatic JSON Schema that
 * does NOT meet these strict-mode prerequisites by itself. `applyStrictMode`
 * is a pure, idempotent transformation that adapts a JSON Schema for
 * OpenAI strict mode without losing semantic intent.
 *
 * Anthropic and Gemini providers do not require this transformation —
 * their structured-output modes accept idiomatic JSON Schema.
 */

/**
 * Recursively transform a JSON Schema for OpenAI strict mode.
 *
 * Transformations applied:
 * - Strip `default` keyword (any depth)
 * - Strip `$schema` keyword
 * - For every `type: "object"`: set `additionalProperties: false` and
 *   `required = Object.keys(properties)`
 * - Recurse into `array.items`, `anyOf`, `oneOf`, `allOf`
 *
 * Pure (no mutation of input) and idempotent.
 */
export function applyStrictMode(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(applyStrictMode);
  }
  if (!schema || typeof schema !== 'object') return schema;
  const obj = { ...(schema as Record<string, unknown>) };
  delete obj.default;
  delete obj.$schema;
  if (obj.type === 'object' && typeof obj.properties === 'object' && obj.properties !== null) {
    const props = obj.properties as Record<string, unknown>;
    const strictProps: Record<string, unknown> = {};
    for (const k of Object.keys(props)) {
      strictProps[k] = applyStrictMode(props[k]);
    }
    obj.properties = strictProps;
    obj.required = Object.keys(strictProps);
    obj.additionalProperties = false;
  }
  if (obj.type === 'array' && obj.items !== undefined) {
    obj.items = applyStrictMode(obj.items);
  }
  if (Array.isArray(obj.anyOf)) obj.anyOf = obj.anyOf.map(applyStrictMode);
  if (Array.isArray(obj.oneOf)) obj.oneOf = obj.oneOf.map(applyStrictMode);
  if (Array.isArray(obj.allOf)) obj.allOf = obj.allOf.map(applyStrictMode);
  return obj;
}
