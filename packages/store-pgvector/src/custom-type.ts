import { customType } from 'drizzle-orm/pg-core';

/**
 * Serializes a Float32Array to pgvector wire format: "[0.1,0.2,0.3]"
 */
export function serializeEmbedding(v: Float32Array): string {
  return `[${Array.from(v).join(',')}]`;
}

/**
 * Deserializes pgvector wire format "[0.1,0.2,0.3]" to Float32Array
 */
export function deserializeEmbedding(s: string): Float32Array {
  return new Float32Array(s.slice(1, -1).split(',').map(Number));
}

/**
 * Drizzle custom column type for pgvector `vector(dim)`.
 *
 * - JS type: Float32Array
 * - PG wire format: "[0.1,0.2,...]"
 * - configRequired: true — must specify { dim: number }
 */
export const pgvectorColumn = customType<{
  data: Float32Array;
  driverData: string;
  config: { dim: number };
  configRequired: true;
}>({
  dataType(config) {
    return `vector(${config.dim})`;
  },
  toDriver(value: Float32Array): string {
    return serializeEmbedding(value);
  },
  fromDriver(value: string): Float32Array {
    return deserializeEmbedding(value);
  },
});

export type PgvectorColumn = ReturnType<typeof pgvectorColumn>;
