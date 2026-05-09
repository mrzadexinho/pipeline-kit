# Cat IX Spike #3 — JSON-RPC / LSP-Framing Findings

> Spike: 3-atom Result stream framed with LSP-style `Content-Length` headers.
> Branch: `v1-spike-cat-ix-day-3`. Author: Executor — 2026-05-08.
> Companion to: `docs/research-outline-v1.md` § Category IX, `FINDINGS.md` (day-1), `FINDINGS-stream.md` (day-2).
> Status: spike output (NOT a notes file; brain synthesises `notes-v1-cat-IX.md` after all Cat IX spikes).

## What was built

A 3-stage stdio pipe identical in topology to spikes #1 / #2 but with the wire framing swapped from "single Result envelope" (#1) and "newline-delimited JSON" (#2) to **LSP-style `Content-Length` framing**: each Result envelope is preceded by `Content-Length: <decimal>\r\n\r\n`, then exactly that many UTF-8 bytes of JSON body, with frames concatenated back-to-back (no trailing newline).

`node ts/atom-emit-rpc.ts` emits 3 framed `Result<Atom<Job>, E>` envelopes (happy / hour-24 adversarial / salary-inverted). `uv run python3 py/process_rpc.py` reads frames from `sys.stdin.buffer`, parses headers up to a `\r\n\r\n` terminator (bounded at 8 KiB to guard against pathological input), slurps exactly N body bytes, validates each atom via day-1's `schema.Atom` (UNCHANGED), runs `business_rules.run_all` from spike #2 (UNCHANGED), and writes one framed Result envelope per input frame to `sys.stdout.buffer`. `node ts/result-validate-rpc.ts` parses the framed stream into 3 messages, classifies each, and asserts the exact pattern `[OK, ERR(schema), ERR(business_rule)]` — fails loud on any deviation.

Reused verbatim from spike #1 / spike #2 (zero edits, confirmed by `git diff master`):
- `py/schema.py`
- `py/business_rules.py`
- `ts/validate.ts`
- `py/process_atom.py`, `py/process_stream.py`
- `ts/atom-emit.ts`, `ts/atom-emit-stream.ts`
- `ts/result-validate.ts`, `ts/result-validate-stream.ts`
- `run.sh`, `run-stream.sh`
- `FINDINGS.md`, `FINDINGS-stream.md`, `README.md`

New code: 3 source files + 1 shell driver, ~190 LOC code + 18 LOC shell (within the 200/10 LOC budget).

## How to reproduce

```bash
bash research/spikes/cross-runtime/run-rpc.sh
```

Spike #1 + spike #2 still pass on the branch tip:

```bash
bash research/spikes/cross-runtime/run.sh
bash research/spikes/cross-runtime/run-stream.sh
```

## Captured run output — Run A (clean)

Stage 1 (TS → wire) — 3 framed envelopes (CR rendered as `<CR>` for readability; in practice the bytes are concatenated with no separator):

```
Content-Length: 523<CR>
<CR>
{"data":{"id":"pk_atom_06F0MR5XBM89R2HW67113JCZ2E","object":"atom","created_at":"2026-05-09T01:36:12.636Z","metadata":{"spike":"cat-ix-day-3","emitter":"ts/atom-emit-rpc.ts","case":"happy"},"data":{"title":"Senior Backend Engineer","company":"Acme Corp","location":"Remote (EU)","posted_at":"2026-05-01T09:00:00.000Z","salary_min":120000,"salary_max":160000,"remote":"remote","tags":["typescript","distributed-systems","kafka"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_06F0MR5XBGYKVAB5RKD6JA250W"},"error":null}Content-Length: 504<CR>
<CR>
{"data":{"id":"pk_atom_06F0MR5XBMX6P8VR0BP23ED0H1","object":"atom","created_at":"2026-05-08T24:00:00.000Z","metadata":{"spike":"cat-ix-day-3","emitter":"ts/atom-emit-rpc.ts","case":"adversarial-ts"},...},"error":null}Content-Length: 489<CR>
<CR>
{"data":{"id":"pk_atom_...","object":"atom","created_at":"2026-05-09T01:36:12.636Z","metadata":{...,"case":"salary-inverted"},"data":{"title":"Principal Engineer","company":"Beta Inc","location":null,"posted_at":null,"salary_min":200000,"salary_max":100000,"remote":"hybrid","tags":["leadership","platform"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_..."},"error":null}
```

Total stage-1 stdout: 1591 bytes (3 frames, no trailing whitespace). Header sizes: 21 bytes each (`Content-Length: NNN\r\n\r\n` for 3-digit lengths). Body sizes: 523, 504, 489 bytes.

Stage 2 (Python → wire) — 1 OK frame + 2 ERR frames, framed:

```
Content-Length: 589<CR>
<CR>
{"data": {"id": "pk_atom_...", "object": "atom", "created_at": "...", "metadata": {..., "case": "happy", "py_hop": "process_rpc.py"}, "data": {"title": "SENIOR BACKEND ENGINEER", ...}, ...}, "error": null}Content-Length: 213<CR>
<CR>
{"data": null, "error": {"type": "schema", "code": "iso_8601_invalid", "message": "atom pk_atom_...: 1 error(s) at created_at; first: Value error, not ISO 8601: '2026-05-08T24:00:00.000Z'"}}Content-Length: 192<CR>
<CR>
{"data": null, "error": {"type": "business_rule", "code": "salary_inverted", "message": "atom pk_atom_...: salary_max (100000) < salary_min (200000); band is inverted"}}
```

Total stage-2 stdout: 1081 bytes. Python's `json.dumps` defaults to `, ` and `: ` whitespace whereas TS's `JSON.stringify` uses `,` and `:` — that asymmetry mirrors spike #2's "JSON spacing asymmetry" finding.

Stage 3 (TS sink classification + verdict):

```
result-validate-rpc: read 3 frame(s)
  frame 1: OK   atom=pk_atom_06F0MR4B6G9MS5DZCQX06QA8JK
  frame 2: ERR  type=schema code=iso_8601_invalid
  frame 3: ERR  type=business_rule code=salary_inverted
result-validate-rpc: PATTERN OK — 1 OK + 2 ERR(schema, business_rule)

==> spike OK: LSP framing + error-branch round-trip succeeded
```

Exit code 0.

## Findings (per spike question A–C)

### A — Stray-`print()` failure mode under LSP framing

Day-1 + day-2 NDJSON behaviour: any extra `\n` on stdout splits a JSON line into two; any non-JSON line (e.g. a `print()`) becomes a malformed line and the sink's `JSON.parse` rejects it. **Loud failure, but the corruption is at the line level — adjacent valid lines are unaffected.**

Run B (this spike) — single `print("debug: about to process atom 2")` injected mid-loop in `process_rpc.py` between frame 1 and frame 2, no `flush` kwarg:

```
result-validate-rpc: frame parse error at offset 1063: no header terminator after offset 1063
  prior frame 1: ok
  prior frame 2: err
  prior frame 3: err
```

Exit code 3.

**The stray print bytes appeared at the END of the stage-2 stream, not between the frames where the call site lives.** This is a Python stdout buffering artefact: `print()` writes through the text-mode `sys.stdout` (TextIOWrapper, block-buffered when piped), while `_emit_frame` writes raw bytes through `sys.stdout.buffer`. The two share the same fd but have separate buffers. On interpreter exit, the text buffer is flushed *after* all the explicit `sys.stdout.buffer.flush()` calls have already pushed the framed bytes through. Net effect:

```
[frame1 header][frame1 body][frame2 header][frame2 body][frame3 header][frame3 body]debug: about to process atom 2\n
```

The sink reads all 3 frames cleanly (header + body + header + body + header + body, advancing offset correctly), then at offset 1063 sees `debug:...\n` with no `\r\n\r\n` terminator — and bails with exit code 3, surfacing all 3 successfully-parsed prior frames in stderr for diagnosis.

**Verdict for question A:** LSP framing did NOT eliminate the stray-print failure class — it shifted it. The shift has two important properties versus NDJSON:

1. **Localisation is better.** Under NDJSON, a stray print between line 1 and line 2 produces a malformed line at position N+1 that pushes the schema-error line and the business-rule-error line to positions N+2 and N+3 — the sink's positional pattern check (`line[1].kind === 'err' && line[1].errType === 'schema'`) fails at the wrong line, blaming a downstream stage. Under LSP framing the failure is reported at a byte offset, all valid frames before the corruption are surfaced, and the diagnostic clearly says "no header terminator after offset 1063" — operator can scroll back to see what the bytes near offset 1063 are.

2. **Order of emission diverges from order of source.** This is *new* fragility. The actual byte order on the wire is not the source-line order: `print()`'s default text-mode buffering means it lands at end-of-stream, not where the call site sits. A spike-#2-style debugging mental model ("just look for the print line in the output, it'll be near the broken atom") fails here. The print is structurally separated from the frame it was meant to be near.

A **second** Run-B variant — same stray print but with `flush=True` — produced an even more concerning behaviour: the print bytes landed *between* frame 1's body and frame 2's `Content-Length:` header, the sink's header-block search advanced past the print as part of the next header preamble, the regex `/content-length\s*:\s*(\d+)/i` matched the next `Content-Length: 213` line, and **the spike PASSED with exit code 0**. The print bytes were silently absorbed as noise in the header preamble and the verdict claimed `PATTERN OK`. The header parser is too lenient: it skips any non-Content-Length lines without complaint. This is the failure mode the brief warned about — "trade it for a different fragility" — and it's the loudest cross-spike finding here. A stricter parser (reject any unknown header line, or require the FIRST line of the header block to be `Content-Length:`) would close the gap. See Section B-3.

### B — New fragilities introduced by framing

**B-1. Partial-frame-on-EOF.** Tested by truncating stage-1 output mid-body (separate probe, not in committed code): the Python `_read_header_block` returns header bytes; `stdin.read(n)` returns fewer than `n` bytes; the implementation emits `wire/truncated_body` once and exits 4. Loud failure. **Acceptable**, but only because the implementation explicitly checks `len(body) != n`. Default `BufferedReader.read(n)` returns short on EOF without raising — a careless implementation would silently process a half-message body, which would either fail JSON parsing (probably loud) or, worse, parse if the JSON happens to be syntactically complete at the truncation point (silent corruption). The "exactly N bytes" contract is *not* enforced by stdlib; it has to be coded by hand.

**B-2. Header parse cost & complexity.** Spike #2's framing parser is `for raw in sys.stdin: ... json.loads(raw)`. Spike #3's is: read byte-by-byte until `\r\n\r\n`, bound size, parse a multi-line header block, find `Content-Length` (case-insensitive), validate digit-only, slurp body, then `json.loads`. ~5x more code (~50 lines vs ~10) and ~5x more parse steps per message. Per-frame overhead is dominated by the byte-by-byte read loop in pure Python; for a 3-atom run it's invisible, but at scale this becomes a real cost (not measured in this spike — out of scope).

**B-3. Header-block laxity is a new attack surface.** As surfaced in section A's `flush=True` variant: the `_parse_content_length` implementation skips any header line that isn't `Content-Length:`. LSP itself permits multiple headers (e.g. `Content-Type`), so a strict "only Content-Length allowed" rule would diverge from LSP. But for kit-internal use, **rejecting unknown headers** would have caught the silent-print-corruption variant. This is a design choice (LSP-compatible vs strict); **flag for spec phase**.

**B-4. Content-Length lying.** Tested by hand-crafting a frame with `Content-Length: 100` but only 50 body bytes followed by a new `Content-Length: 200`: the Python parser slurps 100 bytes, which eats the next frame's header. Catastrophic, silent if the body happens to JSON-parse, loud (json_parse_error) if it doesn't. Mirrors a known LSP-server bug class. **No defence in current implementation** — Content-Length is trusted unconditionally.

**B-5. Multi-byte UTF-8 byte-vs-char trap (latent, not triggered).** The TS emitter uses `Buffer.from(json, 'utf8').length` for byte-count — correct. The Python parser reads `n` bytes from `sys.stdin.buffer` (binary) before `decode('utf-8')` — correct. Both sides count bytes, not characters. Had either side counted characters (e.g. `json.length` in TS or reading `sys.stdin` in text mode) and the payload contained any non-ASCII (CJK, emoji, accented chars), the count would mismatch and frames would slip by one or more bytes per message. **Not triggered in this spike** (all-ASCII fixtures), but the failure mode is one `len(s)` away.

**B-6. Bound on header block.** The implementation caps headers at 8 KiB. Without this, a runaway producer (or hostile peer in a non-pipe context) could exhaust memory. NDJSON has no equivalent bound; a runaway non-newline producer hangs the consumer until OOM. **Net win for LSP framing**, but only because the implementation added the bound — it's not free.

### C — Framing overhead vs NDJSON

**Per-frame header bytes:**
- LSP: `Content-Length: <decimal>\r\n\r\n` — 19 bytes for 1-digit length, 21 bytes for 3-digit, 22 for 4-digit. Stage-1 frames here: 21 bytes header × 3 = 63 bytes overhead.
- NDJSON: 1 byte (`\n`) × 3 = 3 bytes overhead.
- **LSP framing overhead is ~20× NDJSON's per-frame.** Negligible at the 3-atom scale (63 / 1591 ≈ 4%); meaningful at high-frequency small-payload scale (e.g. 100-byte heartbeats: 21% overhead).

**Parse step count per frame:**
- NDJSON: `for raw in sys.stdin` (1 syscall per line via stdlib buffering) → `strip` → `json.loads`. 3 ops.
- LSP: byte-by-byte `read(1)` until `\r\n\r\n` (~50 syscalls for a 21-byte header in pure Python; could be optimised with a buffered scanner) → split lines → find Content-Length → digit-validate → `read(n)` → decode → `json.loads`. ~10 ops + ~50 micro-reads per header.
- **LSP is dramatically more expensive per-frame in this implementation.** A buffered scanner would close most of the gap (read-then-split-on-`\r\n\r\n`). Not done here — out of scope.

**Latency / buffering observation:**
- NDJSON works with text-mode line-buffered stdout (Python's default when isatty, but block-buffered when piped — spike #2 had to add `sys.stdout.flush()` after every emit).
- LSP needs `sys.stdout.buffer` (binary) so it can write raw `\r\n` without text-mode line-ending translation. This **forces explicit `flush()`** by construction, which is actually cleaner — the framing format and the buffer-mode choice align. The footgun shifts: you can't accidentally use `print()` because `print()` uses the text wrapper and ends up with the print-bytes-end-up-anywhere bug from section A.

## Cross-spike comparison (vs spike #2 NDJSON)

What changed:
- Wire format: `<json>\n` per atom → `Content-Length: N\r\n\r\n<json bytes>` per atom.
- Stdin/stdout mode: text → binary (`sys.stdin.buffer` / `sys.stdout.buffer`).
- Per-frame parse complexity: ~3 steps → ~10 steps (and ~50 micro-reads in current impl).
- Header overhead per frame: 1 byte → ~21 bytes.
- Stray-print failure mode: malformed line at the call-site position → bytes-at-end-of-stream OR silent absorption into the next header preamble (depending on `flush` kwarg).
- New explicit safety check: 8 KiB header bound (no NDJSON equivalent).

What stayed the same:
- Topology: TS → Python → TS, three-stage stdio pipe, `set -euo pipefail` driver.
- Schema validation (`schema.Atom` UNCHANGED) and business rules (`business_rules.run_all` UNCHANGED).
- Result envelope shape: `{"data": ..., "error": null}` for OK, `{"data": null, "error": {...}}` for ERR.
- ADR4 discriminator pattern (`error == null`) — spike #2's "convention not tag" finding (Q1) holds.
- The TS sink's positional pattern check (`[OK, ERR(schema), ERR(business_rule)]`) and exit-code-per-violation discipline.
- `JSON.stringify` (no spaces) vs `json.dumps` (default `, ` and `: ` spacing) asymmetry — body sizes differ by ~10% for the same logical content.
- Pydantic / uv invocation: `uv run --quiet --with 'pydantic>=2' python3 ...`.

## Unexpected friction (not asked but found)

1. **`print()` corruption is BUFFERING-dependent in a way that flips the failure mode silently.** No-flush print → bytes at end-of-stream → loud failure (sink's tail parse fails). `flush=True` print → bytes between frames → SILENT pass (sink absorbs them as header noise). This is the worst kind of fragility: the same source code can fail loudly OR pass silently depending on a kwarg. Operators debugging a downstream-product issue might add `print(..., flush=True)` to "make sure I see the debug" and accidentally hide the bug. **For kit, this argues for a strict header parser that rejects anything before `Content-Length:` on the FIRST header line.** Brain to consider for spec phase.

2. **`sys.stdout.buffer` is a forcing function for cleanliness.** Once you commit to binary stdout for framing, `print()` in process code stops being a casual choice — it crosses an abstraction boundary (text wrapper → buffered byte writer) that has subtle semantics. This is a *good* thing for kit: it makes the "no print() in stage code" rule self-enforcing-ish, since any `print()` will obviously show up at the wrong time.

3. **Header parser footprint is non-trivial in Python.** ~50 lines to do safely (size bound, EOF handling, digit validation, multi-line tolerance). For comparison, the NDJSON parser is ~5 lines. Kit's `StdioRpcAdapter` (if/when it exists) needs to ship this parser — it's not "5 lines and you're done."

4. **The mid-loop debug-print → end-of-stream behaviour is the OPPOSITE of what NDJSON does.** Under NDJSON, a `print("debug: ...")` mid-loop produces a debug line at the call site (interleaved with the JSON output, which makes its position diagnostically meaningful). Under LSP framing in binary mode, the same `print()` produces bytes at end-of-stream — diagnostically useless for "which atom triggered the print?". This is a regression in debuggability for the common dev case, even though it improves machine-readability.

5. **The header `Content-Length` is case-insensitive in LSP.** Implementation respects this. But this means a typo like `Content-length` works, while `content_length` (underscore) silently fails. The contract is "HTTP-header-style names" — kit consumers from a JSON-RPC background may bring different conventions. **Document.**

## What this spike does NOT prove

- Performance at scale (multi-atom large-N timing not measured; single 3-atom run only).
- Bidirectional RPC (callbacks back from Python to TS — out of scope).
- `iter()` / `AsyncIterable` cancellation via signal.
- `PipelineContext` crossing the wire.
- Codegen-from-single-source (Zod / JSON Schema → Pydantic).
- LSP-style `id` correlation (request/response matching) — not part of the spike's framing-only scope.
