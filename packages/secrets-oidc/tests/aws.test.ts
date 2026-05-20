import { describe, expect, it } from 'vitest';
import { awsIrsa } from '../src/aws.js';

const FAKE_SESSION_TOKEN = 'FakeAqIXnyJV/test-session-token-abc123';
const FAKE_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
const FAKE_SECRET_KEY = 'test-secret-access-key-fake';

function makeProvider(sessionToken: string | undefined) {
  return async () => ({
    sessionToken,
    accessKeyId: FAKE_ACCESS_KEY_ID,
    secretAccessKey: FAKE_SECRET_KEY,
  });
}

function throwingProvider(message: string) {
  return async (): Promise<{
    sessionToken?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }> => {
    throw new Error(message);
  };
}

describe('awsIrsa', () => {
  it('happy path: provider returns sessionToken → resolve returns ok(sessionToken)', async () => {
    const resolver = awsIrsa({ credentialsProvider: makeProvider(FAKE_SESSION_TOKEN) });

    const result = await resolver.resolve('session_token');

    expect(result.error).toBeNull();
    expect(result.data).toBe(FAKE_SESSION_TOKEN);
  });

  it('sessionToken undefined → err with code secret_not_found', async () => {
    const resolver = awsIrsa({ credentialsProvider: makeProvider(undefined) });

    const result = await resolver.resolve('session_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
    expect(result.error?.type).toBe('secrets_error');
  });

  it('any name returns same session token (single-token adapter)', async () => {
    const resolver = awsIrsa({ credentialsProvider: makeProvider(FAKE_SESSION_TOKEN) });

    const r1 = await resolver.resolve('my-custom-name');
    const r2 = await resolver.resolve('something-else');

    expect(r1.data).toBe(FAKE_SESSION_TOKEN);
    expect(r2.data).toBe(FAKE_SESSION_TOKEN);
  });

  it('provider throws → err with code secret_unavailable, message preserved', async () => {
    const resolver = awsIrsa({
      credentialsProvider: throwingProvider('IRSA token exchange failed'),
    });

    const result = await resolver.resolve('session_token');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toBe('IRSA token exchange failed');
  });

  it('stats + invalidate: reads increment, invalidate bumps currentVersion', async () => {
    const resolver = awsIrsa({ credentialsProvider: makeProvider(FAKE_SESSION_TOKEN) });

    const before = resolver.stats('session_token');
    expect(before.reads).toBe(0);
    expect(before.currentVersion).toBeUndefined();

    await resolver.resolve('session_token');
    await resolver.resolve('session_token');

    const mid = resolver.stats('session_token');
    expect(mid.reads).toBe(2);
    expect(mid.currentVersion).toBeUndefined();

    resolver.invalidate('session_token');

    const after = resolver.stats('session_token');
    expect(after.reads).toBe(2);
    expect(after.currentVersion).toBe('1');

    resolver.invalidate('session_token');
    expect(resolver.stats('session_token').currentVersion).toBe('2');
  });
});

/**
 * Dynamic-import-failure branch (missing peer dep):
 * Covered at the type level by the lazy-import path in aws.ts.
 * Unit testing requires the peer dep not be installed in the test environment,
 * which conflicts with devDependencies. Tested via injection paths above.
 */
