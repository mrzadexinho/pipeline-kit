# @idriszade/rate-limit-redis

Distributed sliding-window `RateLimitStore` adapter for pipeline-kit, backed by Redis.
Implements ADR X-5 (distributed-tier completion) via atomic Lua EVAL.

## Installation

```bash
pnpm add @idriszade/rate-limit-redis redis
```

> **Peer dependency:** `redis` v5+ (node-redis) is required. ioredis is not supported.

## Usage

```ts
import { createClient } from 'redis';
import { createRedisRateLimitStore } from '@idriszade/rate-limit-redis';

// 1. Create and connect the client — you own the connection lifecycle.
const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

// 2. Create the store.
const store = createRedisRateLimitStore({ client });

// 3. Consume a token.
const result = await store.consume('user:42', 10, 60_000);
// { allowed: true, remaining: 9, retryAfterMs: 0 }

// 4. Clean up when done.
await client.quit();
```

## API

### `createRedisRateLimitStore(opts)`

Factory for `RedisRateLimitStore`. Equivalent to `new RedisRateLimitStore(opts)`.

#### Options

| Option      | Type              | Default            | Description                                                  |
|-------------|-------------------|--------------------|--------------------------------------------------------------|
| `client`    | `RedisClientType` | required           | Already-connected node-redis v5+ client.                    |
| `keyPrefix` | `string`          | `'pk:ratelimit:'`  | Prefix applied to every Redis ZSET key.                     |

### `store.consume(key, limit, windowMs)`

Returns `Promise<RateLimitResult>`:

```ts
interface RateLimitResult {
  allowed: boolean;
  remaining: number;      // tokens remaining; 0 when denied
  retryAfterMs: number;   // ms until next allowed request; 0 when allowed
}
```

## Connection ownership

The caller owns the Redis client lifecycle. The store **never** calls `client.connect()`,
`client.quit()`, or `client.disconnect()`. Connect before passing the client and
disconnect when your application shuts down.

```ts
const client = createClient();
await client.connect();

const store = createRedisRateLimitStore({ client });

// ...use store...

await client.quit(); // your responsibility
```

## Lua script and SHA caching

On the first `consume()` call the Lua script is loaded into Redis via
`SCRIPT LOAD`. The SHA is cached on the store instance. Subsequent calls
use `EVALSHA` (no script retransmission). If Redis flushes its script cache
(e.g. after server restart), the adapter detects the `NOSCRIPT` error,
falls back to `EVAL`, and refreshes the cached SHA automatically.

## Algorithm

Sliding-window log algorithm using a Redis ZSET:

1. `ZREMRANGEBYSCORE` — remove timestamps older than `now - windowMs`.
2. `ZCARD` — count current in-window requests.
3. If `count < limit`: `ZADD` the new timestamp, `PEXPIRE` the key for `windowMs`, return allowed.
4. Otherwise: compute `retryAfterMs` from the oldest entry and return denied.

All four operations execute atomically in a single Lua script via `EVAL`.

## Related

- `InProcessRateLimitStore` in `@idriszade/core` — single-process variant (no Redis dependency).
- ADR X-5 — distributed-tier rate limiting.
