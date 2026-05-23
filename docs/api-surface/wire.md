# Wire surface — kit-internal protocol spec

> **Summary:** Kit owns the cross-runtime streaming primitive (NDJSON + LSP). ADRs IX-1..IX-5
> ratified. Wire frame is `WireFrame<T>` carrying `{body, traceparent?, tracestate?}`. Canonical
> JSON (RFC 8785) + RFC 3339 millisecond timestamps + `decodeResult()` discriminator + W3C Trace
> Context propagation. MCP/A2A delegated to adapter tier.

---

## Status

Status: **ratified**. ADRs IX-1 + IX-2 + IX-3 + IX-4 + IX-5 (all of Cat IX). Phase 2 spec
lock (2026-05-15). Kit implementation shipped in M8 (`packages/core/src/wire/`).

---

## Wire frame envelope

Every cross-runtime hop carries frames in the `WireFrame<T>` shape:

```ts
interface WireFrame<T = unknown> {
  body: T;
  /** W3C traceparent header value, per ADR IX-4. */
  traceparent?: string;
  tracestate?: string;
}
```

Per-frame `Result<Atom, E>` is the canonical streaming wire shape (ADR IX-3). Each frame is
independent — an ERR on frame N does not poison frame N+1. Batch `Result<Atom[], E>` is valid
for closed-batch endpoints (e.g. single-shot Source fetch) where the entire response is a
discrete unit.

---

## NDJSON wire format

**Byte form:** each frame is `canonicalize(body)` followed by `\n`. Concatenated frames; no
leading/trailing separator beyond the per-line `\n`.

**Encoding rules:**
- Body MUST be canonical JSON per RFC 8785 (sorted keys, no whitespace, deterministic numbers).
- Timestamps within body MUST be RFC 3339 millisecond-precision (`validateTimestamp` enforces).
- `print()` / `console.log()` style stdout writes in stage code are **FORBIDDEN** — they corrupt
  the wire by injecting non-JSON bytes between frames (spike-2 evidence: malformed line at
  call-site, exit code 3).

**Framing rules:**
- Decoder splits on `\n` only; no other delimiter is recognized.
- Empty lines surface as `err({ code: 'wire/malformed_line' })`.
- JSON parse failures surface as `err({ code: 'wire/malformed_json' })`.
- Well-formed adjacent frames continue uninterrupted — mid-stream errors are isolating, not
  contagious.

**Trace context in NDJSON:** `traceparent` rides in `body.metadata.traceparent`. The NDJSON
encoder serializes only the body; there is no wire-layer header channel for out-of-band fields.
Use `attachTraceToFrame` / `extractTraceFromFrame` rather than setting `metadata` manually.

---

## LSP wire format

**Exact byte form:**
```
Content-Length: <decimal>\r\n
[traceparent: <w3c-traceparent>\r\n]
[tracestate: <w3c-tracestate>\r\n]
\r\n
<body bytes — exactly Content-Length UTF-8 bytes>
```
No separator between consecutive frames.

**Header rules (strict — diverges from LSP spec):**
- The FIRST line of every header block MUST match `^Content-Length:\s*\d+\s*$`
  (case-insensitive). Anything else, including stray `print()` output → `wire/unknown_header`.
- After `Content-Length`, ONLY `traceparent:` and `tracestate:` are permitted. Any other key
  → `wire/unknown_header`.
- Header block is bounded at 8 KiB; exceeding the bound → `wire/header_too_large`.

**Body rules:**
- `Content-Length` value MUST equal `Buffer.byteLength(body, 'utf-8')` exactly (UTF-8 bytes,
  not Unicode character count).
- Fewer bytes available than `Content-Length` → `wire/truncated_body` (closes the
  content-length-lying class documented in spike-3 §B-4).
- Body bytes MUST decode as valid UTF-8; invalid sequences → `wire/utf8_invalid`.

---

## Canonical JSON (RFC 8785)

Kit-impl follows RFC 8785 with these kit-specific clarifications:

- **Numbers:** `JSON.stringify`-compatible default form for finite floats; integers stay as
  integer literals (no trailing `.0`).
- **Strings:** minimal escape per RFC 8259 §7 (only mandatory escape sequences).
- **Key order:** lexicographic by Unicode code point, recursively.
- **Integer bound:** values outside `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`
  are rejected (`wire/integer_unsafe`). Adapter authors requiring larger integers MUST encode
  them as JSON strings before passing to the canonicalizer.
- **Rejected values:** `NaN`, `Infinity`, `-Infinity`, `undefined` — all throw at encode time.

---

## Timestamp grammar

All timestamps carried on the wire MUST conform to:

```
timestamp   ::= date 'T' time fraction offset
date        ::= YYYY '-' MM '-' DD
time        ::= hh ':' mm ':' ss
fraction    ::= '.' DDD            (exactly 3 digits)
offset      ::= 'Z' | sign hh ':' mm
sign        ::= '+' | '-'
```

- Sub-millisecond precision (>3 fraction digits) is **REJECTED loud**
  (`wire/timestamp_sub_ms_precision`). Rationale: Python 3.12 `fromisoformat` silently
  truncates ≥7-digit fractions to microseconds; kit inverts this — fail loud at the TS
  boundary instead of silently dropping precision on the wire (spike-2 evidence).
- Zero or undefined fractional digits are **REJECTED loud** (`wire/timestamp_format_invalid`).
- Calendar validation is enforced: month 1–12; day per-month (including leap year); hour ≤ 23;
  minute ≤ 59; second ≤ 59.

---

## Result envelope

`decodeResult()` is the ONLY sanctioned way to inspect the `{data, error}` discriminator
(ADR IX-3). Do not hand-roll the discriminator check in adapter code.

Discriminator semantics:
- `data !== null && error === null` → OK frame.
- `data === null && error !== null` → ERR frame.
- Both `null` OR both non-null → ambiguous; `decodeResult` returns
  `err({ code: 'wire/result_ambiguous' })`.

The ambiguity guard exists to catch the typo class discovered in spike-1: a single `!= null`
vs `=== null` inversion silently flips ERR to OK at every cross-runtime hop.

---

## Trace context (W3C Trace Context)

`traceparent` + optional `tracestate` are propagated out-of-band of Atom data (ADR IX-4):

- **LSP mode:** `traceparent` as a second header line after `Content-Length`. Strict parser
  whitelists `traceparent` + `tracestate`; any other key → `wire/unknown_header`.
- **NDJSON mode:** `traceparent` in `body.metadata.traceparent` (the `metadata` field is
  `Record<string, unknown>` per v0 ADR and is not part of Atom `data`).
- `attachTraceToFrame(frame, ctx)` handles both forms correctly; `extractTraceFromFrame(frame)`
  is the inverse.
- Python-side adapter authors are responsible for their own OTel SDK configuration and exporter
  setup. Kit ships no Python OTel shim.

---

## MCP / A2A delegation (ADR IX-5)

Kit owns the streaming primitive (NDJSON + LSP framing). MCP and A2A are HIGHER-level protocols
served by adapter-tier packages:

- `@idriszade/source-mcp` / `@idriszade/serve-mcp` — kit ↔ MCP boundary (JSON-RPC 2.0
  internally, tool-call shaped, NOT streaming pipeline primitive).
- Future `@idriszade/serve-a2a` — kit → A2A agent-handoff boundary.

These adapters use MCP's / A2A's JSON-RPC 2.0 framing **internally**. They do NOT replace
the kit cross-runtime primitive — they sit above it. Adapter authors building kit-internal
cross-runtime stages (TS ↔ Python) consume `@idriszade/core/wire` directly, not MCP/A2A.

---

## Wire mode declaration

Cross-runtime adapter packages MUST declare their wire mode in `package.json`:

```json
{
  "pipeline_kit": {
    "wire": "ndjson"
  }
}
```

Valid values:
- `ndjson` — NDJSON-over-stdio (default for stream-style adapters).
- `lsp` — LSP `Content-Length` framing (opt-in, high-stakes adapters).
- `mcp-via-source-mcp` — kit speaks MCP as a Source via `@idriszade/source-mcp`.
- `a2a-via-serve-a2a` — kit speaks A2A as a Serve via the future `@idriszade/serve-a2a`.

This field is the single source of truth for operators inspecting an adapter's wire contract.

---

*Wire surface stabilized in M8 (commit m8-wire-framing → master). Phase 1 Cat IX synthesis at docs/research-notes-v1-cat-IX.md is the spec source-of-truth.*
