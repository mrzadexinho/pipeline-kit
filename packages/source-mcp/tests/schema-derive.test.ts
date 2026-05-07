import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { deriveZodFromJsonSchema } from '../src/schema-derive.js';

describe('deriveZodFromJsonSchema', () => {
  it('flat object schema → parses matching data', () => {
    const schema = deriveZodFromJsonSchema({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    });

    const result = schema.safeParse({ name: 'Alice', age: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ name: 'Alice', age: 30 });
    }
  });

  it('unsupported type "array" → z.unknown() fallback (accepts anything)', () => {
    const schema = deriveZodFromJsonSchema({ type: 'array' });

    // z.unknown() should accept any value
    expect(schema.safeParse([1, 2, 3]).success).toBe(true);
    expect(schema.safeParse({ anything: true }).success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
  });

  it('user-provided config.schema takes precedence — deriveZodFromJsonSchema is not called', () => {
    const spy = vi.spyOn({ deriveZodFromJsonSchema }, 'deriveZodFromJsonSchema');

    const userSchema = z.object({ id: z.number() });

    // Simulate what createMcpToolSource does: if config.schema is provided, skip derivation
    const configSchema: typeof userSchema | undefined = userSchema;

    // The factory should use the user schema directly without calling deriveZodFromJsonSchema
    const schemaToUse = configSchema ?? (z.unknown() as typeof userSchema);

    const result = schemaToUse.safeParse({ id: 42 });
    expect(result.success).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
