import { err, ok, type Result } from '@idriszade/core';
import type { MemoryAdapter, MemoryError } from '@idriszade/memory';

export interface MapMemoryAdapterOptions {
  /** Construction-time namespace. When set, keys are stored as `${namespace}::${key}`. */
  namespace?: string;
}

export class MapMemoryAdapter implements MemoryAdapter {
  readonly #store = new Map<string, string>();
  readonly #namespace: string | undefined;

  constructor(opts?: MapMemoryAdapterOptions) {
    this.#namespace = opts?.namespace;
  }

  #resolveKey(key: string): string {
    return this.#namespace !== undefined ? `${this.#namespace}::${key}` : key;
  }

  async read(key: string): Promise<Result<string | null, MemoryError>> {
    try {
      const resolved = this.#resolveKey(key);
      const value = this.#store.get(resolved);
      return ok(value !== undefined ? value : null);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  async write(key: string, value: string): Promise<Result<void, MemoryError>> {
    try {
      const resolved = this.#resolveKey(key);
      this.#store.set(resolved, value);
      return ok(undefined);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }
}

export function createMapMemoryAdapter(opts?: MapMemoryAdapterOptions): MapMemoryAdapter {
  return new MapMemoryAdapter(opts);
}
