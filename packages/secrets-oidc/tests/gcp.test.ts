import { describe, expect, it } from 'vitest';
import { gcpWif } from '../src/gcp.js';

const FAKE_TOKEN = 'test-gcp-access-token-abc123';

function makeClient(token: string | null | undefined) {
  return { getAccessToken: async () => ({ token }) };
}

function throwingClient(message: string) {
  return {
    getAccessToken: async (): Promise<{ token?: string | null }> => {
      throw new Error(message);
    },
  };
}

describe('gcpWif', () => {
  it('happy path: injected client returns token → resolve returns ok(token)', async () => {
    const resolver = gcpWif({ authClient: makeClient(FAKE_TOKEN) });

    const result = await resolver.resolve('access_token');

    expect(result.error).toBeNull();
    expect(result.data).toBe(FAKE_TOKEN);
  });

  it('token null → err with code secret_not_found', async () => {
    const resolver = gcpWif({ authClient: makeClient(null) });

    const result = await resolver.resolve('access_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
    expect(result.error?.type).toBe('secrets_error');
  });

  it('token undefined → err with code secret_not_found', async () => {
    const resolver = gcpWif({ authClient: makeClient(undefined) });

    const result = await resolver.resolve('access_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
  });

  it('client throws → err with code secret_unavailable, message preserved', async () => {
    const resolver = gcpWif({ authClient: throwingClient('network failure') });

    const result = await resolver.resolve('access_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toBe('network failure');
  });

  it('stats + invalidate: reads increment, invalidate bumps currentVersion', async () => {
    const resolver = gcpWif({ authClient: makeClient('token-v1') });

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
 * Covered at the type level by the lazy-import path in gcp.ts.
 * Unit testing requires the peer dep not be installed in the test environment,
 * which conflicts with devDependencies. Tested via injection paths above.
 */
