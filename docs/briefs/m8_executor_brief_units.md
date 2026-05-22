# M8 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m8_executor_brief.md`](m8_executor_brief.md)):**
> - Unit 1 = `packages/core/src/wire/` (7-9 files, ~600-900 LOC) — NDJSON + LSP codecs, canonical JSON, RFC-3339-ms timestamps, `decode_result`, wire-side trace context.
> - Unit 2 = `@idriszade/cli` `gen-py-schema` subcommand + sample schema + regen-stability CI.
> - Unit 3 = wire spec docs (2 files).
> - Unit 4 = TP-OIDC diagnostic prep (3 files; user-gated execution).
> Read entry brief first for wave sequencing, risk flags, working rules, verification gates.

---

## Unit 1 — IX-1 Wire Framing Module

### Objective

Ship the kit-owned cross-runtime wire spec implementation per ADR IX-1 (NDJSON default + LSP `Content-Length` opt-in). Closes IX-3 (per-frame Result + `decode_result`), IX-4 (W3C Trace Context wire surfaces), and IX-1 itself. Cat IX synthesis at `docs/research-notes-v1-cat-IX.md` is the source-of-truth spec.

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/wire/types.ts` | NEW — `WireMode`, `WireFrame<T>`, `WireDecodeError`, `WireDecodeResult<T>`, `WireEncodeOpts` |
| `packages/core/src/wire/canonical-json.ts` | NEW — RFC 8785 JCS encoder (`canonicalize(value)`) |
| `packages/core/src/wire/timestamp.ts` | NEW — RFC-3339 millisecond-precision validator + encoder |
| `packages/core/src/wire/decode-result.ts` | NEW — `decode_result` helper (ADR IX-3) |
| `packages/core/src/wire/ndjson.ts` | NEW — NDJSON encoder + streaming decoder |
| `packages/core/src/wire/lsp-frame.ts` | NEW — LSP Content-Length encoder + strict streaming decoder |
| `packages/core/src/wire/trace-wire.ts` | NEW — wire-mode trace-context wiring (LSP header form + NDJSON metadata form); integrates with existing `serializable-context.ts` |
| `packages/core/src/wire/index.ts` | NEW — barrel + public re-exports |
| `packages/core/src/index.ts` | EDIT — re-export new wire surface |
| `packages/core/tests/wire/canonical-json.test.ts` | NEW |
| `packages/core/tests/wire/timestamp.test.ts` | NEW |
| `packages/core/tests/wire/decode-result.test.ts` | NEW |
| `packages/core/tests/wire/ndjson.test.ts` | NEW |
| `packages/core/tests/wire/lsp-frame.test.ts` | NEW |
| `packages/core/tests/wire/trace-wire.test.ts` | NEW |
| `packages/core/tests/wire/integration.test.ts` | NEW — end-to-end round-trip + adversarial fixtures |

### Type shapes

```ts
// packages/core/src/wire/types.ts

import type { Result } from '../result.js';

export type WireMode = 'ndjson' | 'lsp';

export interface WireFrame<T = unknown> {
  body: T;
  /** Out-of-band W3C trace context per ADR IX-4. */
  traceparent?: string;
  tracestate?: string;
}

export type WireDecodeErrorCode =
  | 'wire/malformed_line'
  | 'wire/malformed_json'
  | 'wire/truncated_body'
  | 'wire/unknown_header'
  | 'wire/content_length_invalid'
  | 'wire/content_length_missing'
  | 'wire/header_too_large'
  | 'wire/result_ambiguous'
  | 'wire/timestamp_sub_ms_precision'
  | 'wire/timestamp_format_invalid'
  | 'wire/integer_unsafe'
  | 'wire/utf8_invalid';

export interface WireDecodeError {
  code: WireDecodeErrorCode;
  message: string;
  /** Byte offset in stream when relevant (LSP frame parse errors). */
  offset?: number;
  /** Original raw bytes/text near the error site (truncated to ≤ 64 chars). */
  near?: string;
}

export type WireDecodeFrame<T> = Result<WireFrame<T>, WireDecodeError>;
```

```ts
// packages/core/src/wire/canonical-json.ts

/** RFC 8785 JCS — deterministic byte form. Sorts keys; omits whitespace; canonical number form. */
export function canonicalize(value: unknown): string;

/** Convenience: parse-then-canonicalize, for normalizing arbitrary JSON input. */
export function canonicalizeRaw(raw: string): string;
```

```ts
// packages/core/src/wire/timestamp.ts

import type { Result } from '../result.js';
import type { WireDecodeError } from './types.js';

/** Validates RFC-3339 millisecond-precision form: YYYY-MM-DDTHH:mm:ss.sssZ (or with ±HH:mm offset). */
export function validateTimestamp(value: string): Result<string, WireDecodeError>;

/** Encodes Date to canonical wire form (always Z-suffixed millisecond-precision). */
export function encodeTimestamp(date: Date): string;
```

```ts
// packages/core/src/wire/decode-result.ts

import type { Result } from '../result.js';
import type { ErrorEnvelope } from '../envelope.js';
import type { WireDecodeError } from './types.js';

/**
 * Sanctioned cross-runtime Result discriminator. Converts wire-form `{data, error}` into a
 * tagged-value transform so every cross-runtime hop funnels the convention-not-tag check
 * to one helper (ADR IX-3).
 *
 * - `data !== null && error === null` → `ok({ kind: 'ok', value: data })`
 * - `data === null && error !== null` → `ok({ kind: 'err', error })`
 * - both null OR both non-null → `err({ code: 'wire/result_ambiguous' })` (typo guard)
 */
export function decodeResult<T, E = ErrorEnvelope>(
  raw: { data: T | null; error: E | null },
): Result<{ kind: 'ok'; value: T } | { kind: 'err'; error: E }, WireDecodeError>;
```

```ts
// packages/core/src/wire/ndjson.ts

import type { Result } from '../result.js';
import type { WireDecodeError, WireDecodeFrame, WireFrame } from './types.js';

/** Encode one frame to a canonical NDJSON line (no trailing newline; caller concatenates). */
export function encodeNdjsonFrame<T>(frame: WireFrame<T>): string;

/** Encode an array of frames to a single buffer of canonical NDJSON lines. */
export function encodeNdjsonStream<T>(frames: WireFrame<T>[]): string;

/** Decode an NDJSON buffer into a sequence of frame results (lossless: malformed lines surface as err frames). */
export function decodeNdjsonStream<T>(raw: string): WireDecodeFrame<T>[];

/** Async iterator decoder for streaming consumption (line-buffered). */
export function decodeNdjsonAsyncIter<T>(
  source: AsyncIterable<string | Uint8Array>,
): AsyncIterable<WireDecodeFrame<T>>;
```

```ts
// packages/core/src/wire/lsp-frame.ts

import type { Result } from '../result.js';
import type { WireDecodeFrame, WireFrame, WireDecodeError } from './types.js';

/** Encode a single frame to LSP `Content-Length: N\r\n\r\n<body>` form. UTF-8 byte-count enforced. */
export function encodeLspFrame<T>(frame: WireFrame<T>): Uint8Array;

/** Encode a stream of frames; concatenated bytes; no leading/trailing separator. */
export function encodeLspStream<T>(frames: WireFrame<T>[]): Uint8Array;

/**
 * Strict LSP decoder per ADR IX-1:
 * - REJECTS any non-`Content-Length:` header on the FIRST line of the header block (closes spike-3 silent-pass class).
 * - 8 KiB header bound.
 * - Validates `body.byteLength === Content-Length` (closes spike-3 content-length-lying class).
 * - UTF-8 byte-counting (closes spike-3 B-5 latent).
 */
export function decodeLspStream<T>(raw: Uint8Array): WireDecodeFrame<T>[];

export function decodeLspAsyncIter<T>(
  source: AsyncIterable<Uint8Array>,
): AsyncIterable<WireDecodeFrame<T>>;
```

```ts
// packages/core/src/wire/trace-wire.ts

import type { SerializableContext } from '../serializable-context.js';
import type { WireFrame } from './types.js';

/**
 * For LSP mode: traceparent rides as a second header line alongside Content-Length.
 * For NDJSON mode: traceparent rides in atom.metadata.traceparent.
 * This module surfaces both wire forms via the same WireFrame type — adapter authors don't
 * need to know which form is which.
 */
export function attachTraceToFrame<T>(frame: WireFrame<T>, ctx: SerializableContext): WireFrame<T>;
export function extractTraceFromFrame<T>(frame: WireFrame<T>): SerializableContext['trace'] | null;
```

### Implementation rules

- **NDJSON encoder** uses `canonicalize()` from `canonical-json.ts` — sorted keys, no whitespace, RFC 8785-compliant. One JSON document per `\n`-terminated line. NDJSON encoder MUST NOT emit `\r\n` (closes Python text-mode line-ending translation footgun).
- **NDJSON decoder** is line-based; malformed lines (non-parseable JSON OR JSON that fails canonical-form re-encode) yield `err({ code: 'wire/malformed_line', offset, near })`. Valid lines yield `ok(WireFrame)`.
- **LSP encoder** uses binary `Uint8Array` output; `Buffer.byteLength(body, 'utf8')` for the length header. Header form: `Content-Length: NNN\r\n\r\n<body bytes>` (no trailing separator between frames).
- **LSP decoder** is byte-oriented. Header block bounded at 8192 bytes; exceeding emits `wire/header_too_large`. FIRST line MUST match `/^Content-Length:\s*(\d+)\s*$/` — anything else emits `wire/unknown_header`. Subsequent header lines may include `traceparent:` / `tracestate:` and a strict whitelist; any other key emits `wire/unknown_header`. Body length is enforced byte-exact; short-read emits `wire/truncated_body`.
- **`canonical-json.ts`** implements RFC 8785 directly (no external dep). Key sorting: lexicographic by UTF-16 code unit. Numbers: integers stay integer; non-integer numbers use JS canonical form (`String(n)`); reject `NaN` / `Infinity`. Strings escape per RFC 8259 with shortest escape sequences (per RFC 8785 §3.2.2).
- **`timestamp.ts`** validates the form `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$`. Fractional-second part: exactly 3 digits required. ≥4 digits OR no fractional emits `wire/timestamp_sub_ms_precision` (the former) or `wire/timestamp_format_invalid` (the latter). The regex is the loud-failure side of spike-2's silent-truncate finding.
- **`decode_result.ts`** is the ONLY sanctioned discriminator entry — surfaces typo guard via the both-null / both-non-null check (per ADR IX-3 + spike-1 Q1 finding). Adapters MUST use this; document in `wire/README.md` (Unit 3).
- **`trace-wire.ts`** integrates with existing `packages/core/src/serializable-context.ts`. For LSP frames: `attachTraceToFrame` populates `frame.traceparent` / `frame.tracestate`; LSP encoder emits these as second/third header lines. For NDJSON frames: same fields populate; NDJSON encoder injects into `body.metadata.traceparent` / `body.metadata.tracestate` IF body has a `metadata` field (heuristic check via `'metadata' in body`).
- **Integer guard**: `canonical-json.ts` checks integers against `Number.MAX_SAFE_INTEGER` before emission; values above emit `wire/integer_unsafe`. Adapter authors may encode unsafe integers as JSON strings (BigInt-style) — the wire module does NOT auto-convert.
- **No `any` types** in any public signature. Internal helpers may use `unknown` with narrowing.
- **No thrown errors** across the module's public surface — all errors flow via `Result<T, WireDecodeError>`.

### Acceptance criteria

1. NDJSON round-trip property (fast-check): for `Atom<unknown>[]` of size 1–20 with arbitrary JSON-safe payloads, `decodeNdjsonStream(encodeNdjsonStream(atoms)).map(r => r.data!)` equals `atoms.map(a => ({ body: a }))`.
2. NDJSON adversarial: stray text mid-stream (`{atom1}\ndebug line\n{atom2}\n`) decodes to 3 results: `[ok, err({code: 'wire/malformed_line'}), ok]`.
3. LSP round-trip property (fast-check): same as #1 but using `encodeLspStream` / `decodeLspStream`.
4. LSP silent-pass-closer (no-flush spike-3 fixture): input `<frame1><frame2><frame3>debug bytes\n` (debug bytes at end of stream) decodes 3 ok frames + 1 err `{code: 'wire/unknown_header', offset: <bytes-into-stream>}`.
5. LSP silent-pass-closer (`flush=True` spike-3 fixture): input `<frame1>debug bytes\n<frame2>` decodes to `[ok(frame1), err({code: 'wire/unknown_header'})]`. Decoder does NOT silently absorb the debug bytes (the spike-3 silent-pass class is CLOSED).
6. LSP content-length-lying fixture (`Content-Length: 100\r\n\r\n<50 body bytes><Content-Length: 200\r\n\r\n<200 body bytes>`) emits `err({code: 'wire/truncated_body'})` for the first frame.
7. RFC-3339-ms boundary: `validateTimestamp('2026-05-08T12:34:56.123Z')` returns `ok`; `validateTimestamp('2026-05-08T12:34:56.1234567Z')` returns `err({code: 'wire/timestamp_sub_ms_precision'})`; `validateTimestamp('2026-05-08T24:00:00.000Z')` returns `err({code: 'wire/timestamp_format_invalid'})` (hour 24 fails the validator).
8. Canonical JSON idempotent property: `canonicalize(JSON.parse(canonicalize(x))) === canonicalize(x)` for `x: unknown` with JSON-safe shapes.
9. Canonical JSON key sorting: `canonicalize({b:1,a:2})` equals `canonicalize({a:2,b:1})` (lexicographic order).
10. `decode_result` typo guard: `decode_result({data: null, error: null})` returns `err({code: 'wire/result_ambiguous'})`; `decode_result({data: 'x', error: { type: 'e', code: 'c', message: 'm' }})` returns `err({code: 'wire/result_ambiguous'})`.
11. UTF-8 byte-count: encode + decode an atom containing emoji (`🎉`) and CJK (`日本語`); round-trip equal. Test specifically that LSP `Content-Length` matches `Buffer.byteLength(body, 'utf8')` not `body.length`.
12. Integer guard: `canonicalize({n: Number.MAX_SAFE_INTEGER + 1})` returns through a documented mechanism (either throws an Error pre-emission OR caller-side check; document in README which path is taken). Acceptance: round-trip via NDJSON of `{n: 9007199254740993}` either fails at encode OR decode emits `wire/integer_unsafe`.
13. Trace-context wire integration: `extractTraceFromFrame(attachTraceToFrame(frame, ctx))` returns the same `traceparent` / `tracestate` strings as `ctx.trace`.
14. End-to-end integration test (`integration.test.ts`): emit 5 atoms with traceparent on each via NDJSON; decode + verify trace context survives; repeat with LSP mode.

### Dependencies

Wave 1. Independent of Unit 4. Wave 2 (Units 2 + 3) depends on Unit 1 surface being committed.

### ADR ref

IX-1 (wire framing) + IX-3 (decode_result + per-frame Result) + IX-4 (W3C Trace Context wire surfaces, completing the surface already partially shipped via `serializable-context.ts`).

### Industry reference points

- **RFC 8785** (JSON Canonicalization Scheme — JCS) — deterministic byte-form spec.
- **RFC 3339** (Date and Time on the Internet) — millisecond-precision timestamp form.
- **LSP Specification** §"Base Protocol" — `Content-Length: N\r\n\r\n<body>` framing; kit-internal mode deliberately diverges (strict first-line; no `Content-Type` permitted).
- **W3C Trace Context** Recommendation — `traceparent` / `tracestate` header forms.
- **`@xmldom/jsdom` `Buffer.byteLength`** — UTF-8 byte counting reference.
- Cat IX synthesis: `docs/research-notes-v1-cat-IX.md` — the binding spec for this module.
- Spike FINDINGS: `research/spikes/cross-runtime/FINDINGS.md` (single-atom) + `FINDINGS-stream.md` (NDJSON) + `FINDINGS-rpc.md` (LSP) — empirical fragility classes the module closes.

---

## Unit 2 — IX-2 Python Codegen Pipeline

### Objective

Ship the Zod → JSON Schema (Draft 2020-12) → Pydantic v2 codegen chain as a `@idriszade/cli` subcommand per ADR IX-2. Includes regen-stability CI gate and a sample-schema smoke test.

### Files touched

| File | Action |
|------|--------|
| `packages/cli/src/commands/gen-py-schema.ts` | NEW — CLI handler |
| `packages/cli/src/lib/zod-to-json-schema.ts` | NEW — thin wrapper over `zod-to-json-schema` npm package |
| `packages/cli/src/lib/datamodel-codegen.ts` | NEW — child_process invocation of `uv run --with 'datamodel-code-generator[http]' datamodel-codegen --input <schema.json> --output <out.py>` |
| `packages/cli/src/lib/feature-gap-check.ts` | NEW — detect Zod features without JSON Schema equivalents (`.refine`, `.transform`, `.brand`, `.preprocess`) — emit warnings + exit non-zero |
| `packages/cli/src/index.ts` | EDIT — wire `gen-py-schema` into the command dispatcher |
| `packages/cli/tests/gen-py-schema.test.ts` | NEW — smoke test |
| `packages/cli/fixtures/wire-schemas/sample-atom.ts` | NEW — sample Zod schema |
| `packages/cli/fixtures/wire-schemas/__snapshot__/sample-atom.py` | NEW — committed snapshot Pydantic output (regen-stability anchor) |
| `package.json` | EDIT — add `"gen-py-schema:check"` workspace script |

### CLI signature

```
pk gen-py-schema --in <ts-file-exporting-zod-schemas> --out <pydantic-output-file>
                 [--check]                # exit non-zero on drift; do not write
                 [--strict-features]      # default ON; reject .refine/.transform/.brand
```

### Implementation rules

- **Dep:** `zod-to-json-schema@^4` (npm). Already TS-pure.
- **Python tool:** `datamodel-code-generator` invoked via `uv run --with 'datamodel-code-generator[http]>=0.25' datamodel-codegen` — no local Python pin required. Capture stdout + stderr; surface stderr lines on failure.
- **Feature gap check** runs on each top-level Zod export before codegen. Detect via Zod's runtime introspection (`_def.typeName` traversal). Unsupported features: `ZodEffects` (refine/transform), `ZodBranded`, `ZodPipeline`. Each emits a warning line + counts toward exit code.
- **Regen-stability mode (`--check`):** runs codegen to a temp file; diffs against the committed `<out>.py`; exit 0 iff byte-identical.
- **CI integration:** add `gen-py-schema:check` to root `package.json` workspaces script: `pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema --in packages/cli/fixtures/wire-schemas/sample-atom.ts --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-atom.py --check`. Wire into the existing CI flow (run after `pnpm typecheck` in `release.yml` and any PR-validation workflow).
- **Sample schema (`sample-atom.ts`):** export a minimal Zod schema representing the wire Atom shape — `id`, `object: z.literal('atom')`, `created_at` (validated via timestamp regex), `data: z.object({title, salary_min, salary_max})`. NO `.refine` / `.transform` (will be caught by feature-gap check if added).
- **Snapshot Pydantic (`sample-atom.py`):** the committed Pydantic v2 output of running `datamodel-codegen` against the schema. CI verifies this file stays in sync via `--check`.

### Acceptance criteria

1. `pk gen-py-schema --in fixtures/wire-schemas/sample-atom.ts --out tmp/out.py && uv run python -m py_compile tmp/out.py` exits 0 — the emitted Python file parses cleanly.
2. `pk gen-py-schema --check ...` exits 0 when committed snapshot matches; exits non-zero on artificial drift (test edits snapshot, asserts exit non-zero, reverts).
3. Feature-gap check: a fixture schema with `.refine` triggers a warning + exit non-zero unless `--no-strict-features` passed.
4. CLI help text describes the three flags; `--out -` (dash) means stdout.
5. CI step `gen-py-schema:check` runs in `release.yml` after typecheck; fails the workflow on drift.
6. README addition in `packages/cli/README.md` documenting the subcommand + the `uv run` Python dep.

### Dependencies

Wave 2. Sequenced after Unit 1 commits to `m8-wire-framing` (Unit 2 may import `WireMode` types if relevant; the sample schema is illustrative and self-contained but reading the wire-module README is a prerequisite).

### ADR ref

IX-2 (Zod → JSON Schema → Pydantic build-time codegen).

### Industry reference points

- **`zod-to-json-schema`** npm package — TS-pure Zod → JSON Schema Draft 2020-12 converter.
- **`datamodel-code-generator`** Python package — JSON Schema → Pydantic v2 model emitter; CLI is `datamodel-codegen`.
- **`uv run --with`** — Astral's Python tool runner; already used in spike scripts (`research/spikes/cross-runtime/run*.sh`) and proven across spike #1-#3.
- **JSON Schema Draft 2020-12** specification.

---

## Unit 3 — Wire Spec Docs

### Objective

Two markdown docs that make the wire module operable: a Reference README co-located with the impl, and a kit-internal protocol spec under `docs/api-surface/`.

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/wire/README.md` | NEW — implementor reference (~150 lines) |
| `docs/api-surface/wire.md` | NEW — kit-internal protocol spec (~200 lines) |

### `packages/core/src/wire/README.md` content sections

1. **Overview** — what the module does + which ADRs it implements (IX-1 + IX-3 + IX-4).
2. **Two wire modes** — NDJSON (default) vs LSP (opt-in). When to choose which.
3. **Canonical JSON** — RFC 8785 summary + why kit requires it (idempotency-by-wire-hash).
4. **Timestamps** — RFC-3339 millisecond-precision; sub-ms rejected loud; rationale (spike-2 Python silent-truncate evidence).
5. **`decode_result` — the only sanctioned discriminator** — code example; warning about typo guard.
6. **Integer safety** — Number.MAX_SAFE_INTEGER boundary; BigInt-as-string escape hatch.
7. **UTF-8 byte counting** — LSP `Content-Length` MUST be UTF-8 bytes.
8. **Trace context** — both wire forms; `attachTraceToFrame` / `extractTraceFromFrame`.
9. **Error catalogue** — `WireDecodeErrorCode` enumerated table.
10. **Why LSP decoder is strict (not LSP-compatible)** — deliberate divergence; spike-3 silent-pass evidence.

### `docs/api-surface/wire.md` content sections

1. **Status** — ratified ADRs (IX-1..5); kit owns this spec.
2. **Wire frame envelope** — `WireFrame<T>` shape; per-frame Result.
3. **NDJSON wire format** — exact byte form; encoding rules; framing rules.
4. **LSP wire format** — exact byte form; header rules (strict); body rules; error conditions.
5. **Canonical JSON** — RFC 8785 conformance + kit-specific clarifications.
6. **Timestamp grammar** — formal RFC-3339-ms subset.
7. **Result envelope** — `{data, error}` discriminator + `decode_result` contract.
8. **Trace context** — W3C Trace Context propagation in both wire forms.
9. **MCP / A2A delegation** — kit owns the streaming primitive; MCP/A2A live at adapter-tier (IX-5).
10. **Wire mode declaration** — `package.json` `pipeline_kit.wire` field (NDJSON | LSP | mcp-via-source-mcp | a2a-via-serve-a2a).

### Acceptance criteria

1. Both files exist with all listed sections.
2. Code examples in `wire/README.md` import from `@idriszade/core` (not from relative paths) — proves the public surface is correctly re-exported.
3. `docs/api-surface/wire.md` cross-references Cat IX synthesis (`docs/research-notes-v1-cat-IX.md`) for ADR derivation.
4. Combined doc size ≤ 400 lines (per `feedback_document_line_limits` T3 soft 300; summary header at top of each acceptable).

### Dependencies

Wave 2. Parallel with Unit 2. Reads Unit 1's public surface (post-commit).

### ADR ref

IX-1 + IX-3 + IX-4 + IX-5 (delegation pattern).

### Industry reference points

- LSP Specification §"Base Protocol" — for the divergence callout.
- RFC 8785 — JCS spec.
- RFC 3339 — date-time spec.
- W3C Trace Context Recommendation.

---

## Unit 4 — TP-OIDC 404 Diagnosis Prep

### Objective

Produce the diagnostic infrastructure that lets the user (under OTP elevation) capture the npm Trusted Publishing claims AND the GitHub Actions OIDC token claims, diff them, and identify why TP-OIDC publish PUT returns 404. Per `feedback_npm_tp_oidc_404`. Executor produces the tools; user executes the OTP-elevated steps.

### Files touched

| File | Action |
|------|--------|
| `.github/workflows/oidc-token-debug.yml` | NEW — manual-dispatch workflow that prints the GitHub OIDC token claims |
| `scripts/npm-trust-introspect.sh` | NEW — bash script wrapping `npm trust list --json` for each `@idriszade/*` package |
| `docs/development/tp-oidc-claim-diagnosis.md` | NEW — step-by-step recipe + claim-diff template + expected fix paths |

### `.github/workflows/oidc-token-debug.yml`

```yaml
name: OIDC Token Debug (manual)

on:
  workflow_dispatch:
    inputs:
      audience:
        description: 'OIDC token audience'
        required: false
        default: 'npm:registry.npmjs.org'

permissions:
  id-token: write
  contents: read

jobs:
  print-claims:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const token = await core.getIDToken(context.payload.inputs.audience);
            const [, payload] = token.split('.');
            const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
            core.info('OIDC token claims (DO NOT share publicly):');
            core.info(JSON.stringify(claims, null, 2));
```

### `scripts/npm-trust-introspect.sh`

Bash script that:
1. Accepts a package name argument OR loops over all `@idriszade/*` packages.
2. Runs `npm trust list <pkg> --json` and captures output.
3. Writes JSON output to `tmp/tp-oidc-diagnosis/<pkg-without-scope>.json`.
4. Notes in stdout: "If output is empty, see `feedback_npm_trust_list_lag` — read-after-write delay; retry in 5 minutes."

### `docs/development/tp-oidc-claim-diagnosis.md` content sections

1. **Symptom** — copy from `feedback_npm_tp_oidc_404` ("Symptom" paragraph).
2. **Diagnosis steps** (5 steps with executable commands):
   - Step 1: Run `gh workflow run oidc-token-debug.yml -F audience=npm:registry.npmjs.org` from a `master` branch checkout; capture the output.
   - Step 2: Under OTP elevation, run `bash scripts/npm-trust-introspect.sh @idriszade/core` and capture `tmp/tp-oidc-diagnosis/core.json`.
   - Step 3: Diff the two captured claims. Specifically compare: `sub`, `aud`, `ref`, `repository`, `workflow_ref`, `workflow`, `event_name`, `runner_environment`, and any `permissions` array.
   - Step 4: Identify the mismatch. Likely candidates per `feedback_npm_tp_oidc_404` alternative hypotheses (createPackage vs updatePackage permission; workflow_ref full path vs filename; ref claim).
   - Step 5: Re-run `npm trust github` with corrected permissions/claims (interactive — OTP-gated); confirm with `npm trust list` (expect `feedback_npm_trust_list_lag` delay).
3. **Expected fix paths** — three likely fixes per hypotheses (createPackage→include updatePackage; workflow_ref full path; explicit ref).
4. **Re-test instructions** — Once corrected, remove `NODE_AUTH_TOKEN` from `release.yml`, push a no-op changeset, observe the publish step pick up OIDC + 200 OK instead of 404.
5. **Rollback** — keep `NODE_AUTH_TOKEN` available as fallback in the secret store; only remove from `release.yml`; revoke + recreate TP config if claim revision needed.

### Acceptance criteria

1. `.github/workflows/oidc-token-debug.yml` exists + is syntactically valid (YAML lint clean).
2. `scripts/npm-trust-introspect.sh` exists, is `chmod +x`, and runs against an arbitrary package name without erroring (output may be empty per the lag-feedback memory).
3. `docs/development/tp-oidc-claim-diagnosis.md` exists with all 5 sections; step commands are executable as-written.
4. Executor MUST NOT run any `npm trust` mutating command. Diagnostic-only.
5. PR description for the M8 close-out commit notes Unit 4 deliverables + the gated user-action checklist.
6. `.gitignore` includes `tmp/tp-oidc-diagnosis/` — diagnostic captures (which include parsed OIDC token claims + npm trust list output) MUST NOT be committed to the repo.

### Dependencies

Wave 1. Independent of Unit 1 (operates on infra surface only). User executes the OTP-elevated diagnostic steps post-merge; the actual TP-OIDC fix becomes an M9+ carry-forward.

### ADR ref

Long-standing carry-forward from M0.5b; M7 cf TP-OIDC 404 (see `feedback_npm_tp_oidc_404`).

### Industry reference points

- npm Trusted Publishing docs — claim names, permission scopes.
- GitHub Actions OIDC docs — `actions/github-script` `core.getIDToken(audience)` flow.
- `feedback_npm_tp_oidc_404` (kit memory) — symptom + hypotheses + 5-step recipe (source).
- `feedback_npm_trust_cli_bug` + `feedback_npm_trust_list_lag` (kit memory) — known CLI quirks Unit 4 documentation should reference.

---

*Drilldown companion to m8_executor_brief.md. Working rules, wave sequencing, risk flags, and verification gates are in the entry brief.*
