---
'@idriszade/core': minor
'@idriszade/cli': minor
---

M8 — cross-runtime wire framing module (IX-1), pk gen-py-schema codegen pipeline (IX-2), TP-OIDC 404 diagnosis prep.

**`@idriszade/core` (minor):** New wire module at `packages/core/src/wire/` — NDJSON + LSP Content-Length codecs (`encodeNdjsonStream` / `decodeNdjsonStream` / `encodeLspStream` / `decodeLspStream` + async-iter variants), canonical JSON encoder per RFC 8785, RFC-3339 millisecond-precision timestamp validator, `decodeResult` cross-runtime discriminator helper per ADR IX-3, W3C Trace Context wire surfaces via `attachTraceToFrame` / `extractTraceFromFrame` per ADR IX-4. Closes the spike-3 `print(flush=True)` silent-pass class via strict LSP header parsing; closes the content-length-lying class via byte-exact body validation; closes the Python `fromisoformat` silent-truncate class via loud RFC-3339-ms boundary rejection.

**`@idriszade/cli` (minor):** New `pk gen-py-schema` subcommand — Zod → JSON Schema Draft 2020-12 → Pydantic v2 build-time codegen per ADR IX-2. Feature-gap check rejects `.refine` / `.transform` / `.brand` / `.preprocess` / `.pipe` by default; opt out with `--no-strict-features`. `--check` mode gates CI on snapshot drift.
