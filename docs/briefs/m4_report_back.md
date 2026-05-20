# M4 Report-Back — Secrets + Redaction Closure

> **Status:** Complete
> **Branch:** `m4-secrets-redaction`
> **Commits:** 13 (brief amend + 4 phases across A/B/C/D)
> **Test count:** 914 passing, 2 skipped (up from 824 M3 baseline; +90 net)

## Commits

| Commit | Description |
|--------|-------------|
| `2c92fca` | docs(m4): amend brief — pii.ts naming + M5 audit carries |
| `11ec04f` | feat(core): M4 Phase A — PII annotation helpers + walker + formatters |
| `0616e57` | feat(observe): M4 Phase B — RedactingProcessor + known-sensitive table |
| `cba7ff8` | feat(secrets-env): M4 Phase C — env-var-backed SecretsResolver (work branch) |
| `8ef18d3` | merge(secrets-env): M4 Phase C — @idriszade/secrets-env adapter (integration anchor) |
| `fa3dce1` | feat(secrets-sops): M4 Phase C — SOPS CLI-backed SecretsResolver (work branch) |
| `9b3a6c8` | merge(secrets-sops): M4 Phase C — @idriszade/secrets-sops adapter (integration anchor) |
| `0d05ef3` | feat(secrets-oidc): M4 Phase C — OIDC workload-identity SecretsResolver (work branch) |
| `5c3d3fa` | merge(secrets-oidc): M4 Phase C — @idriszade/secrets-oidc adapter (integration anchor) |
| `dfa4d08` | chore(m4): canonicalize pnpm-lock.yaml after Phase C merges |
| `c9fa47c` | test(observe): M4 D1 — end-to-end PII redaction integration test |
| `e899b17` | chore(changeset): M4 — secrets + redaction closure |
| `b556909` | docs(m4): note M4 shipping in root README + spec progress |

## What shipped

### @idriszade/core extension (Phase A)

- `markRedact(schema)` / `markSecret(schema)` — ergonomic helpers wrapping `.describe('@redact')` / `.describe('@secret')`; inverse readable via `schema.description`
- `walkAnnotations(schema, value)` — recursive annotation walker; `@redact` descends into nested objects/arrays, `@secret` is leaf-only (VIII-6.e enforcement)
- `formatRedacted(value: string): string` — returns `<redacted:N>` where N = original char length (VIII-6.c)
- `formatSecret(value: string): string` — returns `<secret:<8hex>>` via `crypto.createHash('sha256')` truncated to 8 hex (VIII-6.b/c)
- `PiiTag` union (`'@redact' | '@secret'`) + `PiiAnnotation` type exported from core index
- Zod v4 `_zod.def.type` introspection used in walker for nested shape detection

### @idriszade/observe extension (Phase B)

- `RedactingProcessor` — custom `SpanProcessor` wrapping `BatchSpanProcessor`; rewrites span attributes before delegating to inner processor; two-path enforcement: known-sensitive table applied first, then annotation walker for schema hints
- `KNOWN_SENSITIVE` table — `gen_ai.prompt` / `gen_ai.completion` auto-treated as `@secret` out of the box (VIII-6.f); user-supplied `knownSensitive` wins on key collision
- `PII_ANNOTATIONS_ATTR` constant — key under which schema annotation hints are attached to spans; stripped from attributes before delegating to inner (hint never leaks to exporter)
- `RedactingProcessorOptions` type — `{ inner, knownSensitive?, piiAnnotationsAttr? }`
- `GEN_AI_PROMPT` / `GEN_AI_COMPLETION` re-exported constants for consumer reference

### @idriszade/observe-vercel extension (Phase B parity)

- `RedactingProcessor`, `KNOWN_SENSITIVE`, `PII_ANNOTATIONS_ATTR`, `RedactingProcessorOptions`, `GEN_AI_PROMPT`, `GEN_AI_COMPLETION` — all surface parity-re-exported from `@idriszade/observe-vercel`

### @idriszade/secrets-env (NEW — Phase C)

- `createEnvSecretsResolver(schema: ZodObject, options?)` — Zod-validates the full env map at construction time (fail-fast, no runtime surprises); `envVarMap` option for key indirection; `source` injection for testing without mutating `process.env`
- `resolve(name)` returns `Result<string, SecretsError>`; missing key and Zod mismatch both map to typed `SecretsError`
- `invalidate()` bumps internal version counter; `stats(name)` per VIII-2 contract; zero runtime deps beyond Zod

### @idriszade/secrets-sops (NEW — Phase C)

- `createSopsSecretsResolver(filePath: string, options?)` — shells out via `node:child_process.spawn('sops', ['-d', filePath])`; no JS wrapper dep (raw CLI, least-lag)
- Full NDJSON/JSON decode of sops output; caches decoded object until `invalidate()` is called
- Concurrency-deduplicates pending spawns (second caller awaits the in-flight spawn, not a fresh one)
- `timeout` + `binaryPath` config options; non-zero exit and missing binary both map to typed `SecretsError`

### @idriszade/secrets-oidc (NEW — Phase C)

- Three submodule entry points: `secrets-oidc/gcp`, `secrets-oidc/aws`, `secrets-oidc/azure`
- `gcpWif()` via `google-auth-library` peer dep; `awsIrsa()` via `@aws-sdk/credential-provider-node` peer dep; `azureWif()` via `@azure/identity` `WorkloadIdentityCredential` peer dep
- All peer deps optional — consumer installs only what they use; lazy dynamic imports at call time
- AWS SDK v3 `fromNodeProviderChain` vs `defaultProvider` compat shim for SDK version variance
- Each submodule satisfies full `SecretsResolver` contract (`resolve`, `invalidate`, `stats`)

## ADRs implemented

| ADR | Subject | Status |
|-----|---------|--------|
| VIII-5 | Reference-adapter trio: env / sops / oidc | ratified + implemented |
| VIII-6 | PII redaction default-on at Zod boundary (+ micro-locks .a–.g) | ratified + implemented |

2 ratified + implemented. Brings total to **47/55** v1 ADRs.

(VIII-1..VIII-4 were ratified in Cat VIII synthesis and implemented in M1's `@idriszade/secrets` package; M4 adapters consume that shipped contract.)

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| Tests | PASS | 914 passing, 2 skipped (+90 vs 824 M3 baseline) |
| Typecheck | PASS | 0 errors across all packages |
| Lint | PASS | 0 errors (non-blocking warnings only) |
| Format | PASS | No fixes needed |
| Build | PASS | All packages compiled cleanly |
| PII Hard Gate | PASS | e2e test asserts `'super-sensitive-prod-secret'` absent from span attributes; `<secret:[0-9a-f]{8}>` present; hash deterministic; hint attribute stripped. Negative test (naive provider without `RedactingProcessor`) confirms raw secret leaks — proves redaction is the load-bearing step. |

Note: brief projected +30/+20/+20/+5 per phase = 75 new tests; executor delivered 92 diff vs baseline; headline is 914 passing (+90). The +90 vs +92 discrepancy is likely a small count of pre-existing tests affected by lockfile/dep changes appearing as altered.

## Carry-forwards to M5

**Outstanding from M3 (not shipped by M4):**
- `@idriszade/cost` pricing pack (X-4 implementation tier)
- Rate-limit RunGuard impl (X-5 implementation tier)
- `memory-map` adapter (V-6 ref impl)
- Python wire codegen (IX-2 — Zod → JSON Schema → Pydantic build-time)
- Cross-attempt cumulative budget tracking (cf-X-4)
- M2 CLI carry-forwards: stdin `pk run`, webhook trigger, full cron, `pk scaffold`
- Integration test against real `process-extract` (requires live API key)

**New from M4:**
- `createVersionAwareResolver` caches unconditionally until `invalidate()` rather than probing `inner.stats(name).currentVersion` per `resolve()` call. Benign for M4 ref adapters, but flag for IV-4/5/6 + III-2 M5 audit pass.
- Composer auto-attach of `pk.pii_annotations`: consumers currently must manually attach `JSON.stringify(walkAnnotations(schema))` to spans; Composer should derive and auto-attach from `Process<I,O>` input/output schemas.
- Allowlist redaction mode (VIII-6.g — denylist ships M4; allowlist opt-in deferred to v1.x).
- AWS SDK v3 `fromNodeProviderChain` → `defaultProvider` migration: `secrets-oidc/aws` ships a runtime-detection shim; long-term direction to confirm in M5+.
- OIDC dynamic-import-failure branch not unit-tested (would require peer dep absent while listed in devDeps); documented limitation.
- IV-4/5/6 + III-2 audit (first M5 brain target — may reduce remaining unimplemented ADR count from 8 to fewer).
