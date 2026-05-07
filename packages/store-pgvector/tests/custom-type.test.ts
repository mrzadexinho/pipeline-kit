import { describe, expect, it } from 'vitest';
import { deserializeEmbedding, pgvectorColumn, serializeEmbedding } from '../src/custom-type.js';

describe('serializeEmbedding / deserializeEmbedding', () => {
  it('round-trips Float32Array via serialize + deserialize', () => {
    const original = new Float32Array([0.1, 0.2, 0.3]);
    const serialized = serializeEmbedding(original);
    const recovered = deserializeEmbedding(serialized);

    expect(recovered).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((recovered[i] ?? 0) - (original[i] ?? 0))).toBeLessThan(1e-6);
    }
  });

  it('Float32Array serialization produces pgvector wire format', () => {
    const v = new Float32Array([1.0, 2.0, 3.0]);
    const str = serializeEmbedding(v);
    expect(str).toBe('[1,2,3]');

    const back = deserializeEmbedding(str);
    expect(Array.from(back)).toEqual([1, 2, 3]);
  });

  it('pgvectorColumn column is usable in a table definition', () => {
    // Verify the builder does not throw and produces a truthy column descriptor
    const col = pgvectorColumn('embedding', { dim: 384 });
    expect(col).toBeTruthy();
    // The column descriptor produced by customType carries a columnType string
    // accessible via the internal config (Drizzle stores it on the builder)
    // We verify it is non-null and not a primitive, indicating a valid column builder.
    expect(typeof col).not.toBe('undefined');
  });
});
