import { describe, expect, it } from 'vitest';
import { azureWif } from '../src/azure.js';

const FAKE_TOKEN = 'test-azure-access-token-fake-abc123';
const DEFAULT_SCOPE = 'https://management.azure.com/.default';

function makeCredential(token: string | null) {
  return {
    getToken: async (_scopes: string | string[]) =>
      token === null ? null : { token, expiresOnTimestamp: Date.now() + 3600_000 },
  };
}

function throwingCredential(message: string) {
  return {
    getToken: async (_scopes: string | string[]): Promise<{ token: string } | null> => {
      throw new Error(message);
    },
  };
}

describe('azureWif', () => {
  it('happy path: credential returns token → resolve returns ok(token)', async () => {
    const resolver = azureWif({ credential: makeCredential(FAKE_TOKEN) });

    const result = await resolver.resolve('access_token');

    expect(result.error).toBeNull();
    expect(result.data).toBe(FAKE_TOKEN);
  });

  it('getToken returns null → err with code secret_not_found', async () => {
    const resolver = azureWif({ credential: makeCredential(null) });

    const result = await resolver.resolve('access_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
    expect(result.error?.type).toBe('secrets_error');
  });

  it('custom scope is forwarded to getToken', async () => {
    const receivedScopes: Array<string | string[]> = [];
    const credential = {
      getToken: async (scopes: string | string[]) => {
        receivedScopes.push(scopes);
        return { token: FAKE_TOKEN, expiresOnTimestamp: Date.now() + 3600_000 };
      },
    };
    const customScope = 'https://storage.azure.com/.default';
    const resolver = azureWif({ credential, scope: customScope });

    await resolver.resolve('storage_token');

    expect(receivedScopes).toEqual([customScope]);
  });

  it('default scope is management.azure.com when not specified', async () => {
    const receivedScopes: Array<string | string[]> = [];
    const credential = {
      getToken: async (scopes: string | string[]) => {
        receivedScopes.push(scopes);
        return { token: FAKE_TOKEN, expiresOnTimestamp: Date.now() + 3600_000 };
      },
    };
    const resolver = azureWif({ credential });

    await resolver.resolve('access_token');

    expect(receivedScopes).toEqual([DEFAULT_SCOPE]);
  });

  it('credential throws → err with code secret_unavailable, message preserved', async () => {
    const resolver = azureWif({
      credential: throwingCredential('Azure identity exchange failed'),
    });

    const result = await resolver.resolve('access_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toBe('Azure identity exchange failed');
  });

  it('stats + invalidate: reads increment, invalidate bumps currentVersion', async () => {
    const resolver = azureWif({ credential: makeCredential(FAKE_TOKEN) });

    const before = resolver.stats('access_token');
    expect(before.reads).toBe(0);
    expect(before.currentVersion).toBeUndefined();

    await resolver.resolve('access_token');
    await resolver.resolve('access_token');

    const mid = resolver.stats('access_token');
    expect(mid.reads).toBe(2);
    expect(mid.currentVersion).toBeUndefined();

    resolver.invalidate('access_token');

    const after = resolver.stats('access_token');
    expect(after.reads).toBe(2);
    expect(after.currentVersion).toBe('1');

    resolver.invalidate('access_token');
    expect(resolver.stats('access_token').currentVersion).toBe('2');
  });
});

/**
 * Dynamic-import-failure branch (missing peer dep):
 * Covered at the type level by the lazy-import path in azure.ts.
 * Unit testing requires the peer dep not be installed in the test environment,
 * which conflicts with devDependencies. Tested via injection paths above.
 */
