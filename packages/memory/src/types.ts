import type { Result } from '@idriszade/core';

export interface MemoryError {
  type: 'memory_error';
  code: 'memory_unavailable' | 'key_invalid' | 'unknown';
  message: string;
}

/**
 * MemoryAdapter v1 contract.
 * LWW (last-writer-wins) semantic: concurrent writes to the same key
 * resolve to the latest write. This is a contractual guarantee, not
 * enforced in the type system.
 */
export interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}
