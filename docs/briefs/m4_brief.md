# Brief — M4 Secrets + Redaction Closure (3 new packages + 2 extensions)

> **Summary:** PII redaction default-on at Zod boundary (VIII-6, must-have 3-of-3); reference
> adapter trio ships (`secrets-env` / `secrets-sops` / `secrets-oidc`). Closes the last v1 must-have
> from the 4-tier/no-customer rule. 8 ADRs implemented (VIII-1..VIII-6, VIII-6.f, VIII-6.g).
> 17 tasks across 4 phases.

> **Branch:** `m4-secrets-redaction`
> **Author (brain):** 2026-05-19
> **Estimated executor effort:** 16–22 hours (1–2 sessions)
> **Status:** Ready for executor pickup. Branches off `master` tip `68d3766`.
> **Predecessor:** M3 shipped at `68d3766` (7 ADRs, 824 tests, observe + eval packages).
> **Scope:** 2 of 55 v1 ADRs (VIII-5 + VIII-6). Ships `@idriszade/secrets-env`, `@idriszade/secrets-sops`,
> `@idriszade/secrets-oidc`; extends `@idriszade/core` + `@idriszade/observe`.

## V1 must-have closure anchor

Must-haves from `feedback_pipeline_kit_4tier_no_customer.md`:
- eval — shipped M3
- local-prod-seam — shipped M2 (Inngest step runtime + CLI)
- PII redaction — ships M4 (this milestone)

## What M4 ships

- **`@idriszade/core` extension** — `markRedact(schema)` + `markSecret(schema)` ergonomic helpers
  wrapping `.describe('@redact')` / `.describe('@secret')`; annotation-walker utility (recursive
  for `@redact`, leaf-only for `@secret`) exported for reuse by `observe` SpanProcessor.
- **`@idriszade/observe` extension** — custom `SpanProcessor` wrapping `BatchSpanProcessor`;
  rewrites span attributes before OTel export using annotation walker; built-in
  known-sensitive-attribute table (`gen_ai.prompt` / `gen_ai.completion` auto-treated as
  `@secret`); `<redacted:N>` and `<secret:<8hex>>` formatters; `@idriszade/observe-vercel` parity
  carried.
- **`@idriszade/secrets-env`** — `SecretsResolver` backed by `process.env` + Zod validation at
  construction time. T3 Env / envalid pattern. No runtime dep beyond Zod.
- **`@idriszade/secrets-sops`** — `SecretsResolver` backed by `sops` CLI binary via
  `child_process.spawn('sops', ['-d', file])`. No JS wrapper — raw CLI, least-lag. README
  documents Lambda/serverless caveat (binary must be on PATH).
- **`@idriszade/secrets-oidc`** — single package, three submodule exports:
  `secrets-oidc/gcp` / `secrets-oidc/aws` / `secrets-oidc/azure`. Each submodule has its own
  peer dep (optional — consumer installs only what they use).

## Package surface

| Package | Tier | New / Extend | Version |
|---------|------|-------------|---------|
| `@idriszade/core` | 1 | extend | 0.2.x → 0.3.0 |
| `@idriszade/observe` | 2 | extend | 0.1.x → 0.3.0 |
| `@idriszade/observe-vercel` | 2 | extend (parity) | 0.1.x → 0.3.0 |
| `@idriszade/secrets-env` | 3 | new | 0.1.0 |
| `@idriszade/secrets-sops` | 3 | new | 0.1.0 |
| `@idriszade/secrets-oidc` | 3 | new | 0.1.0 |
| `@idriszade/secrets` | 1 | patch if needed | patch |

## ADR locks

### VIII-6 — PII redaction at Zod boundary (7 micro-locks)

- **VIII-6.a Annotation channel** = Zod `.describe('@redact')` / `.describe('@secret')`. NOT
  branded types. Runtime-readable via `.description`; no brand-typing complexity; ergonomic at
  schema-author site.
- **VIII-6.b Secret hash** = SHA-256 truncated to 8 hex chars (32-bit collision space). Node
  `crypto.createHash('sha256')` — no new dep.
- **VIII-6.c Output formats** = `<redacted:N>` (N = original char length) for `@redact`;
  `<secret:<8hex>>` for `@secret`. Redacted preserves length for sanity; secret hashes for
  cross-span correlation.
- **VIII-6.d Application point** = `@idriszade/observe` SpanProcessor consumes annotations before
  OTel span export. NOT at Zod parse — parse-time mutation would corrupt downstream
  `Process<I,O>` signatures. Defense-in-depth model: OTel Collector `redactionprocessor` is the
  primary egress enforcement (documented in README, not implemented in kit); kit's SpanProcessor is
  the secondary application-side layer.
- **VIII-6.e Scope rules** = `@redact` applies recursively through nested objects/arrays; `@secret`
  is leaf-only. Redact = "don't log this subtree"; secret = "hash this value".
- **VIII-6.f GenAI conventions** = `gen_ai.prompt` / `gen_ai.completion` attribute keys (OTel
  semconv v1.37+) auto-treated as `@secret` (hashed) out of the box. Built-in
  known-sensitive-attribute table in `@idriszade/observe`.
- **VIII-6.g Mode default** = denylist (only annotated values processed). Allowlist mode deferred
  to v1.x.

### VIII-5 — Reference adapter trio implementation locks

- **`@idriszade/secrets-env`** — read `process.env` + Zod validate at adapter construction.
  T3 Env / envalid pattern. No runtime dep beyond Zod (already a kit dep).
- **`@idriszade/secrets-sops`** — shell out to `sops` CLI binary via
  `child_process.spawn('sops', ['-d', file])`. Reject JS wrappers (`@figedi/sops` etc.) — they
  wrap the CLI and lag the binary. Document Lambda/serverless caveat in README.
- **`@idriszade/secrets-oidc`** — single package, three submodule exports:
  - `secrets-oidc/gcp` → `gcpWif()` via `google-auth-library` (peer dep)
  - `secrets-oidc/aws` → `awsIrsa()` via `@aws-sdk/credential-provider-node` (peer dep)
  - `secrets-oidc/azure` → `azureWif()` via `@azure/identity` `WorkloadIdentityCredential` (peer dep)
  - Each peer dep optional — consumer installs only what they use.

## Tasks (18 total)

**Phase A — Core PII annotation helpers (serial; unblock phases B + C):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| A1 | `packages/core/src/redact.ts` | `markRedact(schema)` + `markSecret(schema)` wrapping `.describe()`; annotation-walker utility (recursive redact, leaf secret); export both from core index | VIII-6.a / VIII-6.e |
| A2 | `packages/core/src/redact.ts` | `formatRedacted(value: string): string` → `<redacted:N>`; `formatSecret(value: string): string` → `<secret:<8hex>>` via `crypto.createHash('sha256')` | VIII-6.b / VIII-6.c |
| A3 | `packages/core/src/redact.ts` | Unit tests: tag detection on flat + nested schemas; walker recursion; `@secret` leaf-only enforcement; formatter output shape | VIII-6 |

Acceptance: typecheck + all 824 tests green + ~20 new tests.

**Phase B — Observe SpanProcessor + redactor (depends on A; B1–B4 serial; B5 parallel after B4):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| B1 | `packages/observe/src/redacting-processor.ts` | Custom `SpanProcessor` wrapping `BatchSpanProcessor`; calls annotation walker on span attributes before delegating to inner | VIII-6.d |
| B2 | `packages/observe/src/known-sensitive.ts` | Built-in table: `gen_ai.prompt` + `gen_ai.completion` → `@secret`; table consumed by `RedactingProcessor` before annotation walk | VIII-6.f |
| B3 | `packages/observe/src/redacting-processor.ts` | Integration test against in-memory OTel exporter: span carrying `@redact` field shows `<redacted:N>`; `gen_ai.prompt` shows `<secret:<8hex>>`; raw values absent | VIII-6 |
| B4 | `packages/observe-vercel/src/index.ts` | Parity: `RedactingProcessor` available for import from `observe-vercel`; same SpanProcessor pattern carried | VIII-6.d |
| B5 | `packages/observe/README.md` | Section: "OTel Collector `redactionprocessor` as recommended egress enforcement (defense-in-depth)"; describe kit SpanProcessor as secondary layer; link OTel Collector docs | VIII-6.d |

Acceptance: redaction integration test shows `<redacted:N>` / `<secret:<8hex>>` in span output, not raw values. This is a hard gate (see Section 7).

**Phase C — Secrets adapter trio (parallel across C1/C2/C3 after A; C1a/C2a/C3a = impl; C1b/C2b/C3b = tests + README):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| C1a | `packages/secrets-env/src/index.ts` | `createEnvSecretsResolver(schema: ZodObject)` — reads `process.env`, Zod-validates at construction; `resolve(name)` returns `Result<string, SecretsError>`; `invalidate()` + `stats()` per VIII-2 contract | VIII-5 |
| C1b | `packages/secrets-env/src/index.test.ts` | Tests: valid env resolves; missing key → err; Zod mismatch → err; `invalidate()` bumps version; integration against `createVersionAwareResolver` wrapper | VIII-5 |
| C2a | `packages/secrets-sops/src/index.ts` | `createSopsSecretsResolver(filePath: string)` — shells out via `child_process.spawn('sops', ['-d', filePath])`; parses NDJSON/JSON output; maps spawn errors → `SecretsError`; no JS wrapper dep | VIII-5 |
| C2b | `packages/secrets-sops/src/index.test.ts` | Tests: valid mock sops output resolves; non-zero exit → err; missing binary → err; integration contract test | VIII-5 |
| C3a | `packages/secrets-oidc/src/{gcp,aws,azure}.ts` | Three submodule exports: `gcpWif()` / `awsIrsa()` / `azureWif()`; each peer dep optional; token returned as `resolve(name)` string; `invalidate()` + `stats()` per contract | VIII-5 |
| C3b | `packages/secrets-oidc/src/*.test.ts` | Each submodule mocks provider SDK; validates `SecretsResolver` contract; README per submodule | VIII-5 |

**Phase D — Wire + ship (serial; depends on B + C):**

| # | Task | Key constraint |
|---|------|---------------|
| D1 | End-to-end integration test | Pipeline reads secret via `SecretsResolver` → flows through `Process` → log/span shows `<secret:<8hex>>`, not raw value. Hard gate. |
| D2 | Changesets | `pnpm changeset` for all new + bumped packages; commit `.changeset/*.md` |
| D3 | Root README + docs update | Note M4 closure of last v1 must-have; link new packages |
| D4 | Gates verification | typecheck / test / lint / build / coverage all green; PII hard gate confirmed |
| D5 | Report-back doc | `docs/briefs/m4_report_back.md` — executor writes on completion |

## Sequencing

```
A1 → A2 → A3
              ↓
         B1 → B2 → B3 → B4 → B5
         C1a ∥ C2a ∥ C3a
              ↓
         C1b ∥ C2b ∥ C3b
              ↓
         D1 → D2 → D3 → D4 → D5
```

## Gates (5 standard + 1 M4-specific hard gate)

```
pnpm typecheck / pnpm lint / pnpm test (baseline 824) / pnpm test:types / pnpm build
```

M4 hard gate: PII redaction integration test MUST show `<redacted:N>` / `<secret:<8hex>>` in
span output — raw values must be absent. Test fails = milestone blocked.

Test count target: **890+** (824 baseline + ~30 Phase A + ~20 Phase B + ~20 Phase C + ~5 Phase D).

## ADR coverage

| ADR | Covered by | Status delta |
|-----|-----------|--------------|
| VIII-5 Reference-adapter trio (env / sops / oidc) | C1a/b, C2a/b, C3a/b | candidate → ratified+implemented |
| VIII-6 PII redaction default-on at Zod boundary | A1–A3, B1–B5, D1 | candidate → ratified+implemented |

2 ADRs ratified + implemented. Brings total from 45/55 → **47/55**.

VIII-1 (SecretsAdapter placement B), VIII-2 (rotation: invalidate + version-aware resolver), VIII-3 (TTL composition wrapper), and VIII-4 (naming + scoping + deps shape) were ratified by the Cat VIII synthesis (2026-05-09) and implemented in M1's `@idriszade/secrets` package. M4's reference adapters consume the M1-shipped SecretsAdapter contract; they do not re-implement it.

## Out-of-scope (carry to M5+)

- V-6 memory adapter trio (`memory-map` reference impl)
- X-4 `@idriszade/cost` pricing pack (cost-derivation adapter tier)
- X-5 rate-limit RunGuard wiring
- IX-2 Python wire codegen (Zod → JSON Schema → Pydantic)
- IV-4/5/6 + III-2 audit — M5 brain resolves first (may reduce unimplemented ADR count)
- M2 CLI carry-forwards: stdin `pk run`, webhook trigger, full cron, `pk scaffold`
- cf-X-4 cross-attempt cumulative budget tracking
- Allowlist redaction mode (denylist ships first; allowlist is v1.x opt-in per VIII-6.g)

M5 brain note: IV-4/5/6 + III-2 audit is the first resolution target — IV-4/5/6 + III-2 audit — M5 brain resolves first (may reduce the remaining 8 unimplemented to fewer than 8 if some of these are already partially shipped).

---

*M4 brief locked 2026-05-19. 2 ADRs (VIII-5 + VIII-6). 3 new packages + 2 extensions. Closes last v1 must-have.*

## Ready for executor session

Fresh executor session should invoke `superpowers:executing-plans` against this brief.
Confirm 824-test baseline green before starting Phase A. Phases B and C can be dispatched
in parallel after A3 completes.
