/**
 * Unit tests for RedisRateLimitStore — SHA caching and NOSCRIPT fallback.
 *
 * These tests use a mock Redis client and do NOT require a running Redis instance.
 * The Lua sliding-window algorithm correctness is covered in integration.test.ts
 * via @testcontainers/redis.
 *
 * Acceptance criteria covered:
 *   AC-5: SHA caching — second consume() does not retransmit full script body
 *   AC-6: NOSCRIPT fallback — scriptFlush between consumes; second call succeeds
 */

import { describe, expect, it, vi } from 'vitest';
import { SLIDING_WINDOW_SCRIPT } from '../src/lua.js';
import { createRedisRateLimitStore, RedisRateLimitStore } from '../src/store.js';
import type { RedisRateLimitStoreOptions } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock Redis client factory
// ---------------------------------------------------------------------------

const FAKE_SHA = 'abc123deadbeef';

function makeAllowedResult(): [number, number, number] {
  return [1, 4, 0];
}

type MockClient = RedisRateLimitStoreOptions['client'];

function makeMockClient(
  opts: {
    scriptLoadResult?: string;
    evalShaResult?: [number, number, number];
    evalShaError?: Error | null;
    luaEvalResult?: [number, number, number];
    scriptExistsResult?: boolean[];
  } = {},
): MockClient {
  const scriptLoadResult = opts.scriptLoadResult ?? FAKE_SHA;
  const evalShaResult = opts.evalShaResult ?? makeAllowedResult();
  const evalShaError = opts.evalShaError ?? null;
  const luaEvalResult = opts.luaEvalResult ?? makeAllowedResult();
  const scriptExistsResult = opts.scriptExistsResult ?? [true];

  const scriptLoad = vi.fn().mockResolvedValue(scriptLoadResult);
  const evalShaFn = evalShaError
    ? vi.fn().mockRejectedValue(evalShaError)
    : vi.fn().mockResolvedValue(evalShaResult);

  // node-redis v5 method name is literally `eval`; stored under the key 'eval'
  const luaEvalFn = vi.fn().mockResolvedValue(luaEvalResult);
  const scriptExists = vi.fn().mockResolvedValue(scriptExistsResult);

  // Build an object literal — the key 'eval' is required by node-redis v5 API
  const mock = {
    scriptLoad,
    evalSha: evalShaFn,
    scriptExists,
  } as Record<string, unknown>;
  mock.eval = luaEvalFn;

  return mock as unknown as MockClient;
}

// Helper to extract the luaEvalFn from a mock
function getLuaEvalFn(client: MockClient): ReturnType<typeof vi.fn> {
  return (client as Record<string, unknown>).eval as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisRateLimitStore', () => {
  // --- factory ---

  it('createRedisRateLimitStore returns a RedisRateLimitStore instance', () => {
    const client = makeMockClient();
    const store = createRedisRateLimitStore({ client });
    expect(store).toBeInstanceOf(RedisRateLimitStore);
  });

  // --- first call: scriptLoad ---

  it('first consume() calls scriptLoad to load Lua script', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('key1', 5, 10_000);

    expect(client.scriptLoad).toHaveBeenCalledOnce();
    expect(client.scriptLoad).toHaveBeenCalledWith(SLIDING_WINDOW_SCRIPT);
  });

  it('first consume() calls evalSha with the loaded SHA', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('key1', 5, 10_000);

    expect(client.evalSha).toHaveBeenCalledOnce();
    const firstCallArg = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstCallArg).toBe(FAKE_SHA);
  });

  // --- AC-5: SHA caching ---

  it('AC-5: second consume() skips scriptLoad (uses cached SHA)', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('key1', 5, 10_000);
    await store.consume('key1', 5, 10_000);

    // scriptLoad only on first call
    expect(client.scriptLoad).toHaveBeenCalledOnce();
    // evalSha called both times
    expect(client.evalSha).toHaveBeenCalledTimes(2);
    // full script body NOT sent on second call
    expect(getLuaEvalFn(client)).not.toHaveBeenCalled();
  });

  it('AC-5 (deeper): cached SHA is passed to evalSha on both calls', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('keyA', 10, 5_000);
    await store.consume('keyB', 10, 5_000);

    const calls = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe(FAKE_SHA);
    expect(calls[1]?.[0]).toBe(FAKE_SHA);
  });

  // --- AC-6: NOSCRIPT fallback ---

  it('AC-6: NOSCRIPT error falls back to lua eval and refreshes SHA', async () => {
    const noscriptError = new Error('NOSCRIPT No matching script');
    const evalShaFn = vi
      .fn()
      .mockRejectedValueOnce(noscriptError)
      .mockResolvedValue(makeAllowedResult());
    const scriptLoadFn = vi.fn().mockResolvedValue(FAKE_SHA);
    const luaEvalMock = vi.fn().mockResolvedValue(makeAllowedResult());

    const client = {
      scriptLoad: scriptLoadFn,
      evalSha: evalShaFn,
      scriptExists: vi.fn().mockResolvedValue([true]),
    } as Record<string, unknown>;
    client.eval = luaEvalMock;

    const store = new RedisRateLimitStore({ client: client as unknown as MockClient });

    // First call: scriptLoad (SHA cache), evalSha throws NOSCRIPT, fallback to lua eval, refreshes SHA
    const result = await store.consume('key1', 5, 10_000);

    expect(result.allowed).toBe(true);
    expect(luaEvalMock).toHaveBeenCalledOnce();
    // scriptLoad called twice: once for initial cache, once to refresh after NOSCRIPT
    expect(scriptLoadFn).toHaveBeenCalledTimes(2);
  });

  it('AC-6: after NOSCRIPT fallback, next consume() uses evalSha again (not lua eval)', async () => {
    const noscriptError = new Error('NOSCRIPT No matching script');
    const evalShaFn = vi
      .fn()
      .mockRejectedValueOnce(noscriptError)
      .mockResolvedValue(makeAllowedResult());
    const scriptLoadFn = vi.fn().mockResolvedValue(FAKE_SHA);
    const luaEvalMock = vi.fn().mockResolvedValue(makeAllowedResult());

    const client = {
      scriptLoad: scriptLoadFn,
      evalSha: evalShaFn,
      scriptExists: vi.fn().mockResolvedValue([true]),
    } as Record<string, unknown>;
    client.eval = luaEvalMock;

    const store = new RedisRateLimitStore({ client: client as unknown as MockClient });

    await store.consume('key1', 5, 10_000); // triggers NOSCRIPT + fallback
    await store.consume('key1', 5, 10_000); // should use evalSha (refreshed SHA)

    // lua eval only called once (during fallback)
    expect(luaEvalMock).toHaveBeenCalledOnce();
    // evalSha called twice total (first throw + second succeed)
    expect(evalShaFn).toHaveBeenCalledTimes(2);
  });

  it('non-NOSCRIPT errors are re-thrown', async () => {
    const connectionError = new Error('Connection refused');
    const client = makeMockClient({ evalShaError: connectionError });
    const store = new RedisRateLimitStore({ client });

    await expect(store.consume('key1', 5, 10_000)).rejects.toThrow('Connection refused');
  });

  // --- result shape ---

  it('allowed result maps correctly to RateLimitResult', async () => {
    const client = makeMockClient({ evalShaResult: [1, 3, 0] });
    const store = new RedisRateLimitStore({ client });

    const result = await store.consume('key1', 5, 10_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(result.retryAfterMs).toBe(0);
  });

  it('denied result maps correctly to RateLimitResult', async () => {
    const client = makeMockClient({ evalShaResult: [0, 0, 2500] });
    const store = new RedisRateLimitStore({ client });

    const result = await store.consume('key1', 5, 10_000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(2500);
  });

  // --- key prefix ---

  it('default key prefix is applied to redis key', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('my-key', 5, 10_000);

    const evalShaOpts = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(evalShaOpts?.keys?.[0]).toBe('pk:ratelimit:my-key');
  });

  it('custom key prefix overrides the default', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client, keyPrefix: 'myapp:rl:' });

    await store.consume('my-key', 5, 10_000);

    const evalShaOpts = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(evalShaOpts?.keys?.[0]).toBe('myapp:rl:my-key');
  });

  // --- ARGV uniqueness ---

  it('member ARGV contains now timestamp and a UUID (uniqueness under concurrent calls)', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await store.consume('key1', 5, 10_000);

    const evalShaOpts = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    const member: string = evalShaOpts?.arguments?.[3];
    // Format: "<timestamp>-<uuid>"
    expect(member).toMatch(/^\d+-[0-9a-f-]{36}$/);
  });

  it('two concurrent consumes produce distinct members', async () => {
    const client = makeMockClient();
    const store = new RedisRateLimitStore({ client });

    await Promise.all([store.consume('key1', 5, 10_000), store.consume('key1', 5, 10_000)]);

    const calls = (client.evalSha as ReturnType<typeof vi.fn>).mock.calls;
    const member1: string = calls[0]?.[1]?.arguments?.[3];
    const member2: string = calls[1]?.[1]?.arguments?.[3];
    expect(member1).not.toBe(member2);
  });

  // --- malformed response guard ---

  it('throws on unexpected Lua response shape', async () => {
    const badClient = {
      scriptLoad: vi.fn().mockResolvedValue(FAKE_SHA),
      evalSha: vi.fn().mockResolvedValue('not-an-array'),
      scriptExists: vi.fn(),
    } as Record<string, unknown>;
    badClient.eval = vi.fn();

    const store = new RedisRateLimitStore({ client: badClient as unknown as MockClient });
    await expect(store.consume('key1', 5, 10_000)).rejects.toThrow('@idriszade/rate-limit-redis');
  });
});

describe('createRedisRateLimitStore', () => {
  it('is equivalent to new RedisRateLimitStore', async () => {
    const client = makeMockClient();
    const store = createRedisRateLimitStore({ client });

    const result = await store.consume('key1', 5, 10_000);
    expect(result.allowed).toBe(true);
  });
});

describe('SLIDING_WINDOW_SCRIPT', () => {
  it('is a non-empty string containing Lua ZREMRANGEBYSCORE', () => {
    expect(typeof SLIDING_WINDOW_SCRIPT).toBe('string');
    expect(SLIDING_WINDOW_SCRIPT.length).toBeGreaterThan(0);
    expect(SLIDING_WINDOW_SCRIPT).toContain('ZREMRANGEBYSCORE');
    expect(SLIDING_WINDOW_SCRIPT).toContain('ZCARD');
    expect(SLIDING_WINDOW_SCRIPT).toContain('ZADD');
    expect(SLIDING_WINDOW_SCRIPT).toContain('PEXPIRE');
  });
});
