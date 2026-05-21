import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMapMemoryAdapter } from '../src/index.js';

describe('MapMemoryAdapter — basic contract', () => {
  it('read returns ok(null) for absent key', async () => {
    const adapter = createMapMemoryAdapter();
    const result = await adapter.read('missing-key');
    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('write then read returns ok(value)', async () => {
    const adapter = createMapMemoryAdapter();
    await adapter.write('k1', 'hello');
    const result = await adapter.read('k1');
    expect(result.error).toBeNull();
    expect(result.data).toBe('hello');
  });

  it('LWW: write(k,V1); write(k,V2); read(k) === ok(V2)', async () => {
    const adapter = createMapMemoryAdapter();
    await adapter.write('k', 'V1');
    await adapter.write('k', 'V2');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('V2');
  });

  it('write(k,"") then read(k) returns ok("") — empty distinct from absent', async () => {
    const adapter = createMapMemoryAdapter();
    await adapter.write('k', '');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('');
  });

  it('write returns ok(undefined)', async () => {
    const adapter = createMapMemoryAdapter();
    const result = await adapter.write('k', 'v');
    expect(result.error).toBeNull();
    expect(result.data).toBeUndefined();
  });

  it('different keys are isolated', async () => {
    const adapter = createMapMemoryAdapter();
    await adapter.write('a', 'alpha');
    await adapter.write('b', 'beta');
    const ra = await adapter.read('a');
    const rb = await adapter.read('b');
    expect(ra.data).toBe('alpha');
    expect(rb.data).toBe('beta');
  });
});

describe('MapMemoryAdapter — namespace', () => {
  it('namespace prefix isolates keys from non-namespace instance', async () => {
    const ns = createMapMemoryAdapter({ namespace: 'ns1' });
    const bare = createMapMemoryAdapter();
    await ns.write('k', 'namespaced');
    await bare.write('k', 'bare');
    const nsResult = await ns.read('k');
    const bareResult = await bare.read('k');
    expect(nsResult.data).toBe('namespaced');
    expect(bareResult.data).toBe('bare');
  });

  it('different namespaces do not collide', async () => {
    const ns1 = createMapMemoryAdapter({ namespace: 'ns1' });
    const ns2 = createMapMemoryAdapter({ namespace: 'ns2' });
    await ns1.write('key', 'from-ns1');
    const result = await ns2.read('key');
    expect(result.data).toBeNull();
  });

  it('LWW works within namespace', async () => {
    const adapter = createMapMemoryAdapter({ namespace: 'ns' });
    await adapter.write('key', 'first');
    await adapter.write('key', 'second');
    const result = await adapter.read('key');
    expect(result.data).toBe('second');
  });
});

describe('MapMemoryAdapter — NOT Disposable or Listable', () => {
  it('does not have a close() method', () => {
    const adapter = createMapMemoryAdapter();
    expect('close' in adapter).toBe(false);
  });

  it('does not have a list() method', () => {
    const adapter = createMapMemoryAdapter();
    expect('list' in adapter).toBe(false);
  });
});

describe('MapMemoryAdapter — property tests', () => {
  it('write(k, v); read(k) === v for any valid key and UTF-8 value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z0-9][a-z0-9:_-]*$/), fc.string(), async (k, v) => {
        const adapter = createMapMemoryAdapter();
        await adapter.write(k, v);
        const result = await adapter.read(k);
        expect(result.error).toBeNull();
        expect(result.data).toBe(v);
      }),
    );
  });
});
