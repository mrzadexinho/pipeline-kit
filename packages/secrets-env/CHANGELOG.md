# @idriszade/secrets-env

## 0.2.0

### Minor Changes

- e899b17: M4 — Secrets + Redaction Closure (closes last v1 must-have)

  **PII Redaction (VIII-6)** ships default-on at the OTel SpanProcessor
  layer:

  - `@idriszade/core`: `markRedact`/`markSecret` annotation helpers,
    `walkAnnotations` schema traverser, `formatRedacted`/`formatSecret`
    formatters
  - `@idriszade/observe`: `RedactingProcessor` wraps any inner
    SpanProcessor; rewrites attributes via known-sensitive table
    (`gen_ai.prompt` + `gen_ai.completion` auto-`@secret`) and via
    schema-derived hints (`pk.pii_annotations`)
  - `@idriszade/observe-vercel`: parity exports

  **Reference secrets adapter trio (VIII-5)** — three new packages
  implementing the M1 SecretsResolver contract:

  - `@idriszade/secrets-env`: env-var-backed, Zod-validated at
    construction (T3 Env pattern)
  - `@idriszade/secrets-sops`: SOPS CLI subprocess via
    `node:child_process` (no JS wrapper dep)
  - `@idriszade/secrets-oidc`: workload-identity OIDC tokens — `./gcp`
    (google-auth-library), `./aws` (@aws-sdk/credential-provider-node),
    `./azure` (@azure/identity); each peer dep optional

  ADRs: VIII-5, VIII-6 (with .a–.g micro-locks). Closes v1 must-have
  3-of-3 (eval → M3, local-prod-seam → M2, PII redaction → M4).

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0
