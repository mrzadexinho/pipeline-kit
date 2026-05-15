import { ok } from '@idriszade/core';
import { describe, expect, it } from 'vitest';
import { isDisposable } from '../src/index.js';
import { isListable } from '../src/markers.js';
import type { MemoryAdapter, MemoryError } from '../src/types.js';

// Mock adapter
function createMockAdapter(): MemoryAdapter {
  const store = new Map<string, string>();
  return {
    async read(key) {
      return ok(store.get(key) ?? null);
    },
    async write(key, value) {
      store.set(key, value);
      return ok(undefined);
    },
  };
}

describe('MemoryAdapter contract', () => {
  it('read returns null for missing key', async () => {
    const adapter = createMockAdapter();
    const result = await adapter.read('missing');
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  it('write then read returns the value', async () => {
    const adapter = createMockAdapter();
    await adapter.write('key1', 'value1');
    const result = await adapter.read('key1');
    expect(result.data).toBe('value1');
  });

  it('LWW: last write wins on same key', async () => {
    const adapter = createMockAdapter();
    await adapter.write('key', 'first');
    await adapter.write('key', 'second');
    const result = await adapter.read('key');
    expect(result.data).toBe('second');
  });
});

describe('isListable guard', () => {
  it('returns true for object with list function', () => {
    const listable = { list: async () => ok([]) };
    expect(isListable(listable)).toBe(true);
  });

  it('returns false for plain object', () => {
    expect(isListable({})).toBe(false);
  });

  it('returns false for null', () => {
    expect(isListable(null)).toBe(false);
  });

  it('returns false for non-function list', () => {
    expect(isListable({ list: 'not a function' })).toBe(false);
  });
});

describe('Disposable re-export', () => {
  it('isDisposable returns true for object with close function', () => {
    const disposable = { close: async () => {} };
    expect(isDisposable(disposable)).toBe(true);
  });

  it('isDisposable returns false for plain object', () => {
    expect(isDisposable({})).toBe(false);
  });
});

describe('MemoryError codes', () => {
  it('memory_unavailable error has correct shape', () => {
    const error: MemoryError = {
      type: 'memory_error',
      code: 'memory_unavailable',
      message: 'Database connection lost',
    };
    expect(error.type).toBe('memory_error');
    expect(error.code).toBe('memory_unavailable');
  });

  it('key_invalid error has correct shape', () => {
    const error: MemoryError = {
      type: 'memory_error',
      code: 'key_invalid',
      message: 'Key contains invalid characters',
    };
    expect(error.code).toBe('key_invalid');
  });
});
