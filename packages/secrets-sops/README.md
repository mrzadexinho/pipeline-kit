# `@idriszade/secrets-sops`

T3 SOPS-backed SecretsResolver for pipeline-kit. Decrypts git-stored encrypted files via the `sops` CLI binary and exposes secrets as a `SecretsResolver` with caching, invalidation, and concurrency deduplication.

ADR: VIII-5 (reference-adapter trio, sops leg).

## Quick start

```ts
import { createSopsSecretsResolver } from '@idriszade/secrets-sops';

const secrets = createSopsSecretsResolver('./secrets.enc.json');

const result = await secrets.resolve('db_password');
if (result.ok) {
  console.log(result.value); // 'hunter2'
} else {
  console.error(result.error); // SecretsError
}
```

The file at `./secrets.enc.json` must be decryptable by `sops` using the keys available in the current environment (age, PGP, AWS KMS, GCP KMS, Azure Key Vault, etc.).

## Options

```ts
const secrets = createSopsSecretsResolver('./secrets.enc.json', {
  binaryPath: '/usr/local/bin/sops', // default: 'sops' (PATH lookup)
  timeoutMs: 15_000,                 // default: 30_000ms
});
```

| Option       | Type     | Default    | Description                                    |
|--------------|----------|------------|------------------------------------------------|
| `binaryPath` | `string` | `'sops'`   | Path to the sops binary. Falls back to PATH.   |
| `timeoutMs`  | `number` | `30000`    | Milliseconds before the sops subprocess is treated as hung. |
| `spawn`      | `typeof spawn` | (built-in) | Override for testing via dependency injection. |

## Caching and invalidation

The full decoded JSON object is cached after the first `resolve()` call. Subsequent calls to `resolve()` for any key are served from cache without re-spawning `sops`.

Call `invalidate(name)` to bust the cache. The next `resolve()` call will re-spawn `sops -d` to re-read the file. This is the correct pattern for secret rotation — update the encrypted file, then call `invalidate`.

```ts
secrets.invalidate('db_password'); // clears cache; next resolve re-decrypts
```

## Stats

```ts
const s = secrets.stats('db_password');
// { reads: 3, currentVersion: '1' }
```

`currentVersion` is a stringified counter incremented by each `invalidate()` call. It is `undefined` until the first invalidation.

## Error mapping

| Situation                        | `code`              |
|----------------------------------|---------------------|
| sops non-zero exit               | `secret_unavailable` |
| sops binary not found (ENOENT)   | `secret_unavailable` |
| sops output is not valid JSON    | `secret_unavailable` |
| sops timed out                   | `secret_unavailable` |
| Key missing or not a string      | `secret_not_found`  |

## Lambda / serverless caveat

**Requires the `sops` binary on PATH.** AWS Lambda, Vercel Functions, and other serverless runtimes do not include sops by default. Either:

1. Bundle sops as a Lambda Layer or container image layer (sops ships as a single statically linked Go binary — easy to layer).
2. Use a different adapter (e.g., `@idriszade/secrets-oidc`) for workload-identity-based secret retrieval on serverless platforms.

**Cold-start note:** sops subprocess spawn adds approximately 50–200ms cold-start latency on the first secret access per instance. Subsequent calls within the same instance lifetime are served from cache at near-zero cost. For high-frequency Lambda invocations, prefer an adapter that does not require subprocess spawn.

## Why no JS wrapper dependency?

The sops Go binary is the upstream source of truth. JS wrappers (e.g., `@figedi/sops`) lag behind binary releases and add abstraction over a stable CLI interface. Spawning directly via `node:child_process` keeps the dependency surface minimal and the adapter version-independent of sops's release cadence. The spawn injection point (`options.spawn`) makes the adapter fully testable without a real sops binary.

## Concurrency

If multiple `resolve()` calls are made while a sops subprocess is in-flight, they share the pending promise — only one subprocess is spawned. All callers receive the same result when the subprocess completes.
