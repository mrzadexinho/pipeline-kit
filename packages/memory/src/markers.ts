import type { Result } from '@idriszade/core';
import type { MemoryError } from './types.js';

export interface Listable {
  list(namespace: string): Promise<Result<string[], MemoryError>>;
}

export function isListable(dep: unknown): dep is Listable {
  return (
    typeof dep === 'object' &&
    dep !== null &&
    'list' in dep &&
    typeof (dep as Record<string, unknown>).list === 'function'
  );
}
