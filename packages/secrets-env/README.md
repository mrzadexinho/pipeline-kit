# @idriszade/secrets-env

Pipeline-kit reference adapter for environment-variable-backed secrets (ADR VIII-5, env leg).

Implements the `SecretsResolver` contract from `@idriszade/secrets` using Zod schema validation at construction time — the same pattern used by [T3 Env](https://env.t3.gg/) and [envalid](https://github.com/af/envalid).

## Quick start

```ts
import { z } from 'zod';
import { createEnvSecretsResolver } from '@idriszade/secrets-env';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
});

// Throws SecretsEnvConfigError if process.env doesn't match schema.
const secrets = createEnvSecretsResolver(schema);

const result = await secrets.resolve('API_KEY');
if (result.error) {
  // Handle missing env var at runtime.
} else {
  console.log(result.data); // string
}
```

## Kit-name → env-var indirection

Use `envVarMap` to decouple kit-side names from actual env-var names:

```ts
const schema = z.object({ GH_TOKEN: z.string() });

const secrets = createEnvSecretsResolver(schema, {
  envVarMap: { githubToken: 'GH_TOKEN' },
});

await secrets.resolve('githubToken'); // reads process.env.GH_TOKEN
```

## Usage with `createVersionAwareResolver`

Wrap the env adapter with the version-aware resolver from `@idriszade/secrets` to get cache + rotation semantics:

```ts
import { createVersionAwareResolver } from '@idriszade/secrets';
import { createEnvSecretsResolver } from '@idriszade/secrets-env';
import { z } from 'zod';

const schema = z.object({ API_KEY: z.string() });
const inner = createEnvSecretsResolver(schema);
const secrets = createVersionAwareResolver(inner);

// First call fetches + caches.
await secrets.resolve('API_KEY');

// Invalidate forces a fresh read on next resolve.
secrets.invalidate('API_KEY');
await secrets.resolve('API_KEY'); // re-fetches
```

## Source injection (testing)

Pass a `source` object instead of reading `process.env`. This avoids mutating the global env in tests:

```ts
const resolver = createEnvSecretsResolver(schema, {
  source: { API_KEY: 'test-key' },
});
```

## Kit-level env vars

The following env vars are consumed by `@idriszade/core` itself, not by this adapter. Include them in your env schema if you want Zod-validated startup errors for missing values:

| Variable | Used by | Notes |
|----------|---------|-------|
| `PK_SIGNING_KEY` | `scopedIdempotencyKey` (core) | HMAC key + HKDF source. High-entropy; treat as production secret. Generate: `openssl rand -hex 32`. Rotating invalidates in-flight idempotency keys. |

## Caveats

- **No runtime cache.** Env vars are already in-process memory; there is nothing to cache. The `invalidate` method exists to satisfy the `SecretsResolver` contract and bumps an internal version counter (consumed by `createVersionAwareResolver`).
- **No runtime refresh.** `process.env` is populated once at process start in all major Node/Bun runtimes. Changing an env var externally (e.g., in a container via a secrets operator) requires a process restart. For dynamic rotation without restarts, use the SOPS or OIDC adapter instead.
- **Zod validation at construction.** Missing or malformed env vars throw `SecretsEnvConfigError` immediately, giving a clear startup error rather than a cryptic runtime failure deep inside a pipeline stage.
- **ADR:** VIII-5 — three reference adapters for SecretsResolver: env (this package), SOPS, and OIDC workload-identity.
