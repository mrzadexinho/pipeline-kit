# Wire module — implementor reference

> **Summary:** The wire module implements ADRs IX-1 + IX-3 + IX-4 + IX-5 — two wire modes
> (NDJSON default, LSP opt-in), RFC 8785 canonical JSON, RFC 3339 millisecond timestamps,
> a single `decodeResult()` discriminator, and W3C Trace Context propagation. Kit owns the
> cross-runtime primitive; MCP/A2A live at adapter tier per IX-5.

---

## Overview

The wire module provides the cross-runtime streaming primitive for Source ↔ Process ↔ Serve
hops in pipeline-kit. It implements ADR IX-1 (two wire modes), ADR IX-3 (`decode_result`
envelope), ADR IX-4 (W3C Trace Context), and ADR IX-5 (kit owns the spec; MCP/A2A delegate
to adapter tier). Adapter authors building cross-runtime stages (TypeScript ↔ Python,
TypeScript ↔ any) consume this module directly. MCP and A2A protocols, which use JSON-RPC
2.0 internally, operate at adapter tier and do not replace this primitive.

---

## Two wire modes

**NDJSON (default):** one canonical-JSON line per frame, delimited by `\n`. Stream-style
adapters, low-stakes, operator-friendly (wire form is `cat`-able). Choose NDJSON unless you
have a specific reason for LSP.

**LSP `Content-Length` (opt-in):** binary-framed, UTF-8 byte-counted header. Choose LSP for
high-stakes adapters where silent corruption is unacceptable — the strict header parser closes
the `print(flush=True)` silent-pass class documented in spike-3.

```ts
import {
  encodeNdjsonFrame, decodeNdjsonStream,
  encodeLspFrame, decodeLspStream,
} from '@idriszade/core/wire';

// NDJSON round-trip
const line = encodeNdjsonFrame({ body: { id: 'pk_atom_01' } }) + '\n';
const frames = decodeNdjsonStream<{ id: string }>(line);
// frames[0] -> ok({ body: { id: 'pk_atom_01' } })

// LSP round-trip
const bytes = encodeLspFrame({ body: { id: 'pk_atom_01' } });
const lspFrames = decodeLspStream<{ id: string }>(bytes);
// lspFrames[0] -> ok({ body: { id: 'pk_atom_01' } })
```

---

## Canonical JSON (RFC 8785)

The encoder MUST produce deterministic byte-form to enable idempotency-by-wire-hash. RFC 8785
specifies: keys sorted lexicographically, no whitespace, number form per JSON. This closes the
JSON-spacing asymmetry found in spike-2 (Python `json.dumps` emits `, `/ `: ` by default;
`JSON.stringify` emits no whitespace — same logical content, byte-different wire form).

Kit-specific guard: integers outside `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]` are
rejected at encode time. Adapter authors wanting BigInt-style integers MUST pre-convert to
string (`String(bigValue)`) in the schema before encoding.

```ts
import { canonicalize } from '@idriszade/core/wire';

canonicalize({ z: 1, a: 2 }); // -> '{"a":2,"z":1}'  (keys sorted)
```

---

## Timestamps (RFC 3339 millisecond-precision)

Required format: `YYYY-MM-DDTHH:mm:ss.sssZ` (exactly 3 fraction digits, UTC offset `Z`).

Kit rejects sub-millisecond precision LOUD at the boundary. Rationale: spike-2 found that
Python 3.12 `fromisoformat` silently truncates ≥7-digit fractional seconds to microsecond
precision. Kit inverts this — fail loud at the TS boundary so no precision is silently dropped
on the wire.

```ts
import { validateTimestamp, encodeTimestamp } from '@idriszade/core/wire';

encodeTimestamp(new Date());           // -> '2026-05-22T10:30:00.123Z'
validateTimestamp('2026-05-22T10:30:00.123Z');   // -> ok(...)
validateTimestamp('2026-05-22T10:30:00.1234Z');  // -> err({ code: 'wire/timestamp_sub_ms_precision' })
```

---

## decode_result — the only sanctioned discriminator

Every cross-runtime hop MUST funnel the `{data, error}` discriminator through `decodeResult()`
(ADR IX-3). Hand-rolling `error === null` checks in adapters is a typo-footgun that silently
flips ERR to OK (spike-1 evidence: one misread turns a business-rule failure into a success
result).

`decodeResult()` returns a tagged discriminated union and explicitly catches the ambiguous case
(both null OR both non-null — `wire/result_ambiguous`).

```ts
import { decodeResult } from '@idriszade/core/wire';

const decoded = decodeResult({ data: { id: 'pk_atom_01' }, error: null });
// -> { kind: 'ok', value: { id: 'pk_atom_01' } }

const errDecoded = decodeResult({ data: null, error: { message: 'fail' } });
// -> { kind: 'err', error: { message: 'fail' } }
```

**Do NOT hand-roll `error === null` checks in adapters — always use `decodeResult`.**

---

## Integer safety

Kit enforces the `Number.MAX_SAFE_INTEGER` boundary (`2^53 - 1 = 9_007_199_254_740_991`).
Any integer outside `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]` MUST be represented
as a JSON string in the wire schema. Encode using `String(bigValue)` before passing to the
canonicalizer.

```ts
// Latency-ns and byte-counts can exceed MAX_SAFE_INTEGER:
const payload = { latency_ns: String(BigInt('9999999999999999')) };
// -> wire-safe; round-trips byte-identical across runtimes
```

---

## UTF-8 byte counting

LSP `Content-Length` MUST count UTF-8 bytes, not Unicode characters (spike-3 §B-5 latent bug
class). A single emoji is 4 bytes; naively using `str.length` (char-count) undercounts by 3.

- **Node:** `Buffer.byteLength(str, 'utf8')`
- **Universal (any runtime):** `new TextEncoder().encode(str).byteLength`

The kit encoder uses `TextEncoder` internally and is correct. This note is for adapter authors
writing custom frame inspection or logging code that reconstructs a Content-Length header.

```ts
const str = 'hello \u{1F600}';   // 'hello 😀' — 10 chars, 13 UTF-8 bytes
Buffer.byteLength(str, 'utf8');   // -> 13  (correct)
str.length;                       // -> 10  (WRONG for Content-Length)
```

---

## Trace context

Both wire modes surface W3C Trace Context per ADR IX-4. `attachTraceToFrame(frame, ctx)` is
the single entry point — it handles both modes transparently. `extractTraceFromFrame(frame)`
is the inverse for the consuming side.

- **LSP mode:** `traceparent` rides as a second header line (after `Content-Length`). The strict
  parser whitelists `traceparent` and `tracestate`; any other header key is rejected.
- **NDJSON mode:** `traceparent` rides in `body.metadata.traceparent`. This is because NDJSON
  serializes only the body — there is no wire-layer header channel.

```ts
import { attachTraceToFrame, extractTraceFromFrame } from '@idriszade/core/wire';

const frame = attachTraceToFrame(
  { body: { id: 'pk_atom_01' } },
  { traceparent: '00-abc...', tracestate: undefined },
);
const ctx = extractTraceFromFrame(frame);
// ctx.traceparent -> '00-abc...'
```

---

## Error catalogue

| Code | Meaning | Mode |
|------|---------|------|
| `wire/malformed_line` | Empty line in NDJSON stream | NDJSON |
| `wire/malformed_json` | `JSON.parse` failure on line or body | Both |
| `wire/truncated_body` | Body shorter than `Content-Length`, or stream ended mid-header | LSP |
| `wire/unknown_header` | First header line is not `Content-Length:`, or disallowed header key | LSP |
| `wire/content_length_invalid` | `Content-Length` value is non-numeric or negative | LSP |
| `wire/content_length_missing` | No `Content-Length` header found | LSP |
| `wire/header_too_large` | Header block exceeds 8 KiB | LSP |
| `wire/result_ambiguous` | Both `data` and `error` are null, OR both are non-null | Both |
| `wire/timestamp_sub_ms_precision` | Fractional seconds have more than 3 digits | Both |
| `wire/timestamp_format_invalid` | Timestamp does not match RFC 3339 millisecond form | Both |
| `wire/integer_unsafe` | Integer outside `[-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER]` | Both |
| `wire/utf8_invalid` | Body bytes are not valid UTF-8 | LSP |

---

## Why LSP decoder is strict (not LSP-compatible)

Per ADR IX-1: kit's LSP decoder rejects any non-`Content-Length:` content on the FIRST line
of the header block. This deliberately diverges from the LSP specification, which permits
additional headers such as `Content-Type`.

Rationale: spike-3 proved that a lax header-block search (regex scanning for
`Content-Length:` anywhere in the header region) silently absorbs stray `print(flush=True)`
bytes from Python stages, causing the sink to exit with code 0 and `PATTERN OK` — a silent
correctness failure. Strict-first-line parsing closes this entire class of silent-pass attacks.

Adapter authors building kit-internal cross-runtime pipes MUST NOT assume LSP-spec header
parity. Kit's wire mode is deliberately stricter for operability reasons.
