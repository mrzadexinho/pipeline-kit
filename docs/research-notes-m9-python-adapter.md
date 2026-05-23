# M9 Research Notes — Python Adapter (adapter-python-process)

> M9 pre-brief synthesis. Author: Brain — 2026-05-23.
> Inputs: internal codebase research (wire module, codegen, Node adapter pattern) +
> external industry research (uv, pydantic v2.13.4, MCP SDK stdio pattern, CI).
> Anchors: ADR-v1-IX-1..IX-5 (Cat IX synthesis 2026-05-09) + M8 master tip 7640603.
> Status: synthesis complete; 8 scope decisions locked; 7 open questions for brief author.

---

## Summary

- **Toolchain pick:** uv 0.7.x + pytest 9.x + pydantic 2.13.4; no Poetry; `requires-python = ">=3.12"`.
- **Layout:** `packages/adapter-python-process/` — sibling to TS packages, per-package `pyproject.toml`, NOT a uv workspace member of the pnpm root.
- **Publish path:** vendor-in-repo for M9; PyPI via `uv publish` + OIDC pending publisher deferred to M10. Configure pending publisher now (zero cost, no token).
- **Wire scope (M9):** `idempotencyKey` crossing only (`x-pipeline-idempotency-key` LSP header or `body.metadata.idempotencyKey` NDJSON). Memory + signal cancellation deferred to M10. Addresses Cat IX cf #1 partially.
- **First artifact M9 must ship:** `decode_result()` Python helper — namedtuple-based, mirrors ADR IX-3 shape. Not yet implemented anywhere in repo.
- **Discriminated-union gap:** `z.discriminatedUnion()` → `datamodel-code-generator` translation is untested. Add fixture + snapshot test in M9 to prevent M10 surprise.
- **Stdio model:** fully async via anyio + UTF-8 re-wrap + per-frame `await stdout.flush()`. Mirror MCP Python SDK `stdio.py`. No `print()` to stdout — ever.
- **CI:** parallel Python job (matrix `["3.12","3.13"]`, `ubuntu-latest`) added to `.github/workflows/ci.yml` or new `python.yml`; `astral-sh/setup-uv@v8.1.0` pinned to commit `08807647`.
- Wave 2 (TP-OIDC) is out of scope for this note; artifacts already at `docs/development/tp-oidc-claim-diagnosis.md` (09e8832).

---

## Source artifacts

### Internal (this repo, master tip 7640603)

| Path | Role |
|---|---|
| `packages/core/src/wire/types.ts` | `WireFrame<T>`, `WireDecodeError`, `WireDecodeErrorCode` union |
| `packages/core/src/wire/ndjson.ts` | NDJSON encode/decode — `encodeNdjsonFrame`, `decodeNdjsonAsyncIter` |
| `packages/core/src/wire/lsp-frame.ts` | LSP encode/decode — `encodeLspFrame`, `decodeLspAsyncIter` |
| `packages/core/src/wire/canonical-json.ts` | RFC 8785 canonicalizer (sorted keys, no whitespace) |
| `packages/core/src/wire/timestamp.ts` | `validateTimestamp`, `encodeTimestamp` — RFC 3339 ms-exact boundary |
| `packages/core/src/wire/decode-result.ts` | `decodeResult()` — ADR IX-3 sanctioned discriminator |
| `packages/core/src/wire/trace-wire.ts` | `attachTraceToFrame`, `extractTraceFromFrame` — W3C Trace Context |
| `packages/core/src/wire/README.md` | Full implementor reference; error catalogue lines 172-186 |
| `packages/cli/src/commands/gen-py-schema.ts` | `pk gen-py-schema` CLI entry; loader + feature-gap detection + codegen orchestration |
| `packages/cli/src/lib/datamodel-codegen.ts` | `uv run datamodel-code-generator` wrapper |
| `packages/cli/fixtures/wire-schemas/sample-atom.ts` | Zod input fixture (no `z.discriminatedUnion` — a gap) |
| `packages/cli/fixtures/wire-schemas/__snapshot__/sample-atom.py` | Reference Pydantic v2 output snapshot |
| `packages/process-extract/src/extract-process.ts` | Node reference adapter — primary pattern to mirror in Python |
| `docs/research-notes-v1-cat-IX.md` | Cat IX synthesis (5 ADRs, 5 carry-forwards) |
| `docs/briefs/m8_executor_brief.md` | M8 shape reference (213 lines entry) |
| `docs/development/tp-oidc-claim-diagnosis.md` | TP-OIDC Wave 2 artifacts (09e8832) |

### External (industry, 2026)

- uv 0.7.x docs — [astral.sh/uv](https://docs.astral.sh/uv/), workspace + lock semantics
- pydantic 2.13.4 release notes (2026-05-06) — `model_validate_json` + jiter backend
- `astral-sh/setup-uv@v8.1.0` (commit `08807647e7069bb48b6ef5acd8ec9567f424441b`) — GHA action
- pytest 9.x + pytest-asyncio (`asyncio_mode = "auto"`) documentation
- MCP Python SDK `stdio.py` — anyio task-group + UTF-8 re-wrap reference (verbatim snippet below)
- PyPI Trusted Publishers (OIDC pending publisher) — zero-cost pre-configuration
- PEP 740 — build provenance attestations (`uv publish` sidecar support)

---

## Recommended stack

| Decision | Pick | Why | Citation |
|---|---|---|---|
| Toolchain | uv 0.7.x; `requires-python = ">=3.12"` | 75M monthly PyPI downloads, overtook Poetry 2026; first-class PyCharm 2026.1.1 support; single `uv.lock` at workspace root | uv docs |
| Test | pytest 9.x + pytest-asyncio `asyncio_mode = "auto"` + coverage.py + pytest-cov | Standard 2026 async-capable stack; anyio test backend available | pytest 9.x docs |
| Pydantic style | pydantic 2.13.4; `model_validate_json(raw_bytes, strict=True)` inbound; `model_dump_json(by_alias=True, exclude_unset=True)` outbound; `Field(discriminator="type")` for unions | jiter Rust backend measurably faster than `model_validate(json.loads(...))`; strict mode catches coercion at boundary; `exclude_unset=True` prevents spurious nulls | pydantic 2.13.4 release notes |
| CI setup action | `astral-sh/setup-uv@v8.1.0` pinned to commit `08807647`; NOT `actions/setup-python` | uv manages Python; built-in cache via `enable-cache: true` + `cache-dependency-glob` | setup-uv v8.1.0 |
| CI matrix | `["3.12", "3.13"]` on `ubuntu-latest`; parallel sibling job to Node | 3.14 too new for library coverage; 3.12 min per ADR IX fromisoformat finding | M8 CI pattern |
| Publish path | Vendor M9; `uv publish` + OIDC pending publisher M10; PEP 740 attestations M11 | Zero-cost pending publisher configured now eliminates token-bootstrap requirement later; mirrors npm OIDC direction | PyPI TP docs |
| Layout | `packages/adapter-python-process/` with per-package `pyproject.toml` | Mirrors `packages/process-extract/` naming; not a uv workspace member of pnpm root — separate tool trees | LanceDB / Pulumi monorepo precedent |
| Stdio | anyio task group; `TextIOWrapper(sys.stdin.buffer, encoding="utf-8")`; `await stdout.flush()` per frame; no `print()` to stdout | Closes spike-3 silent-pass + Windows CP1252 encoding trap; closes spike-2 block-buffering finding | MCP SDK `stdio.py` |

---

## Wire-protocol Python implementor map

For each kit-side primitive, what the Python adapter must implement and which library best fits.

### NDJSON codec (`packages/core/src/wire/ndjson.ts`)

Kit encodes one canonical-JSON line per `\n` (`ndjson.ts:6-7`). `traceparent`/`tracestate` are NOT in the NDJSON envelope wire field — they ride in `body.metadata.traceparent` (`trace-wire.ts:53-62`, `ndjson.ts:30-33`). The NDJSON encoder strips those fields from the outer frame entirely (`ndjson.ts:8-11`).

Python implementor must:
1. Read `sys.stdin.buffer` line-by-line (binary).
2. Parse each line with `model_validate_json(line, strict=True)` — passes raw bytes directly to jiter, avoids intermediate `json.loads` cost.
3. Emit outbound frames with `model_dump_json(by_alias=True, exclude_unset=True)` + `separators=(',', ':')` + `sort_keys=True` if hand-building JSON (see canonical-json section below).
4. Call `await stdout.flush()` after every written frame.

The MCP Python SDK `stdio.py` pattern is the de-facto modern reference for this shape:

```python
import anyio
from io import TextIOWrapper

stdin = anyio.wrap_file(TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"))
stdout = anyio.wrap_file(TextIOWrapper(sys.stdout.buffer, encoding="utf-8"))

async def stdin_reader():
    async for line in stdin:
        message = types.jsonrpc_message_adapter.validate_json(line, by_name=False)
        await read_stream_writer.send(message)

async def stdout_writer():
    async for msg in write_stream_reader:
        json = msg.model_dump_json(by_alias=True, exclude_unset=True)
        await stdout.write(json + "\n")
        await stdout.flush()
```

Kit adapter replaces `jsonrpc_message_adapter` with the Pydantic frame model and `decode_result()` dispatch. Reader + writer run as anyio task-group coroutines; no threading.

### LSP codec (`packages/core/src/wire/lsp-frame.ts`)

Kit LSP format: `Content-Length: N\r\n[traceparent: ...\r\n][tracestate: ...\r\n]\r\n<N UTF-8 body bytes>`. First header line MUST be `Content-Length:` — strict (`lsp-frame.ts:1-10`, `README.md:189-201`). Only `traceparent` and `tracestate` are allowed additional header lines; any other key → `wire/unknown_header`. 8 KiB header bound; body byte-exact against header length.

Python implementor must:
- Read `sys.stdin.buffer` (binary) header line-by-line until `\r\n\r\n` terminator.
- Reject if first header line is not `Content-Length:` — this is what closes the `print(flush=True)` silent-pass (spike-3).
- Count Content-Length in UTF-8 bytes (`lsp-frame.ts:28`); Python equivalent: `len(body.encode("utf-8"))`, not `len(body)`.
- Extract `traceparent` from header line 2 if present; pass to OTel span context.
- Library fit: hand-rolled async reader on `sys.stdin.buffer` (anyio); no third-party LSP library — `pygls` uses asyncio+threading hybrid, too heavy for this boundary.

### `decode_result()` (`packages/core/src/wire/decode-result.ts`)

Kit's TS helper returns `Result<DecodedResult<T,E>, WireDecodeError>` — the outer `Result` wrapper matters; the Python equivalent must replicate it, not just the inner `{kind}` discriminant.

Python namedtuple shape per ADR IX-3:

```python
from typing import Generic, NamedTuple, TypeVar, Union
T = TypeVar("T")
E = TypeVar("E")

class Ok(NamedTuple):
    kind: str  # "ok"
    value: object

class Err(NamedTuple):
    kind: str  # "err"
    error: object

def decode_result(frame: dict) -> Union[Ok, Err]:
    if frame.get("error") is None:
        return Ok(kind="ok", value=frame["data"])
    return Err(kind="err", error=frame["error"])
```

First artifact M9 must ship. Not yet implemented anywhere in repo. Adapter authors MUST call this; hand-rolling the discriminant check is prohibited.

### `trace-wire` (`packages/core/src/wire/trace-wire.ts`)

`attachTraceToFrame` requires a `SerializableContext` argument (`trace-wire.ts:39`). Python has no `SerializableContext` type. Python adapter authors are responsible for OTel SDK setup per ADR IX-4 — kit ships no Python OTel shim.

Python implementor picks up `traceparent` from inbound frame (`body.metadata.traceparent` for NDJSON; `traceparent` header for LSP) and starts a child span under it:

```python
from opentelemetry.propagate import extract
from opentelemetry import trace

carrier = {"traceparent": frame_metadata.get("traceparent", "")}
ctx = extract(carrier)
tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span("adapter.process", context=ctx):
    # ... run processing logic
```

Kit ships only the wire plumbing; OTel SDK exporter configuration is the adapter author's responsibility.

### `canonical-json` (`packages/core/src/wire/canonical-json.ts`)

RFC 8785: sorted keys, no whitespace, specific numeric constraints. Integers capped at `[-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER]`; outside this → `wire/integer_unsafe` (`README.md:57-59`).

Python implementor:

```python
import json

def canonical_json(obj: object) -> bytes:
    return json.dumps(
        obj, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
```

No third-party library needed for v1. `json.dumps` with `separators=(',',':')` matches kit's zero-whitespace requirement. `sort_keys=True` satisfies RFC 8785 key ordering. `ensure_ascii=False` preserves non-ASCII UTF-8 codepoints without `\uXXXX` escaping (matches JS `JSON.stringify` default). Integers exceeding `MAX_SAFE_INTEGER` (9007199254740991) must be validated pre-emit.

### `timestamp` (`packages/core/src/wire/timestamp.ts`)

Kit boundary: RFC 3339, millisecond-exact (`YYYY-MM-DDTHH:mm:ss.sssZ`). Sub-millisecond precision rejected. Python 3.12 `fromisoformat` silently truncates ≥7-digit fractional seconds (spike-2 finding; `research-notes IX:63-74`).

Python implementor must enforce the millisecond-only constraint with a `field_validator`:

```python
@field_validator("created_at", mode="before")
@classmethod
def normalize_ts(cls, v: object) -> object:
    if isinstance(v, str) and "." in v:
        base, frac = v.rsplit(".", 1)
        suffix = ""
        for ch in ("Z", "+", "-"):
            if ch in frac:
                idx = frac.index(ch)
                suffix = frac[idx:]
                frac = frac[:idx]
                break
        v = f"{base}.{frac[:3]}{suffix}"  # truncate to 3 digits (ms)
    return v
```

Truncating to 3 digits (not 6) enforces the kit ms-boundary, not just Python's us-boundary.

---

## Friction findings & mitigations

**Convergence note:** Cat IX's 3 empirical spikes identified 5 friction classes via controlled experiments. External industry research (MCP SDK, pydantic docs, anyio docs) validates these findings — no contradiction. The spike-derived list maps 1:1 onto known Python-subprocess gotchas documented in each library's FAQ. The findings reinforce each other.

### Finding 1 — `print(flush=True)` silent-pass (Cat IX spike-3)

`print(flush=True)` between frames drops bytes between LSP frames. A lax `Content-Length:` regex absorbs the noise as header preamble; sink exits 0 with `PATTERN OK`. Kit's strict-first-line LSP parser closes this class (`lsp-frame.ts:1-10`).

Mitigation: Python adapter MUST never write to `sys.stdout` (text mode). All output through `sys.stdout.buffer` (binary) or anyio-wrapped equivalent. Enforce with a lint rule or module-level `sys.stdout = None` assignment after wrapping.

### Finding 2 — Python 3.12 `fromisoformat` silent truncation (Cat IX spike-2)

≥7-digit fractional seconds silently truncated to microsecond precision. Wire-hash idempotency diverges between TS and Python hops (`research-notes IX:63-74`).

Mitigation: `field_validator` on all timestamp fields truncating to 3 fractional digits before `fromisoformat`. See `timestamp` section above.

### Finding 3 — JSON-spacing asymmetry (Cat IX spike-2)

`json.dumps` defaults to `', '` / `': '` separators. `JSON.stringify` emits no whitespace. Same logical content = different bytes = broken wire-hash idempotency (`research-notes IX:65`).

Mitigation: always `json.dumps(obj, separators=(',',':'), sort_keys=True)`. Never rely on default separators in any wire-path code. Test vector: emit from Python, parse in TS, re-emit, byte-compare.

### Finding 4 — Stdout block-buffering on pipes (Cat IX spike-2)

Python stdout is line-buffered on tty, block-buffered when stdout is a pipe. Without explicit flush, mid-stream error frames are invisible until process exit (`research-notes IX:64`).

Mitigation: `await stdout.flush()` after every frame in the anyio stdout writer coroutine. Binary mode (`sys.stdout.buffer`) with anyio wrapping bypasses the TextIOWrapper buffer entirely; the flush still matters for kernel-level pipe flushing.

### Finding 5 — `undefined`→`null` key-omission (Cat IX spike-1)

`JSON.stringify` omits keys with `undefined` values. Pydantic `Optional[T]` fields default to omitting the key on `model_dump`. ADR IX-3 mandates `null`, never key-omission, for all optional fields (`research-notes IX:37`).

Mitigation: codegen uses `exclude_unset=True` on output — which omits unset fields. For optional fields that MUST appear as `null`, adapter must hand-set them to `None` before serialization. Not enforceable by codegen alone; semantic contract per ADR IX-3 that adapter authors must honor.

### Finding 6 — `model_validate_json` vs `model_validate(json.loads(...))` performance (NEW)

Calling `json.loads(line)` then `model_validate(dict)` bypasses jiter, pydantic's Rust JSON backend. At high atom-per-second rates the difference is measurable.

Mitigation: always pass raw bytes or str directly: `Model.model_validate_json(line, strict=True)`. No intermediate `json.loads`. The raw bytes path from `sys.stdin.buffer` plugs directly into `model_validate_json`.

### Finding 7 — anyio task-group vs threading for async I/O (NEW)

The MCP SDK and pygls both handle stdio, but pygls uses an asyncio+threading hybrid for LSP framing complexity. The threading approach creates two stdout writers that can interleave bytes.

Mitigation: single anyio task group with dedicated reader coroutine and writer coroutine sharing a memory channel. No threading. Writer coroutine is the sole stdout writer — serialization guaranteed. KeyboardInterrupt handled by anyio task-group cancellation; no `signal.signal` needed.

### Finding 8 — UTF-8 stdin/stdout re-wrap for Windows safety (NEW)

Python's default text stream encoding is platform-dependent (`cp1252` on Windows, `utf-8` on Linux/macOS). Multi-byte payloads (Unicode field values) corrupt silently under `cp1252`.

Mitigation: re-wrap before entering the anyio event loop:

```python
import sys
from io import TextIOWrapper

sys.stdin = TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
sys.stdout = TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
```

CI runs `ubuntu-latest` only, so this is a latent cross-platform bug; implement unconditionally.

### Finding 9 — Multiprocessing inherits stdout fd (NEW)

Python's `multiprocessing` module forks stdout into child processes. If any adapter code (or test infrastructure) spawns subprocesses via `multiprocessing`, child stdout output leaks onto the wire stream.

Mitigation: redirect subprocess stdout to stderr or `subprocess.DEVNULL` unconditionally. Document in adapter author guide. Tests must mock subprocess boundaries so no live child inherits the wire stdout fd. This is a pit-of-failure risk in test suites that exercise the full stdio stack.

### Finding 10 — Per-frame `await stdout.flush()` discipline (NEW)

anyio's `wrap_file` returns an async-compatible file object, but `write()` does not auto-flush. Without explicit `await stdout.flush()`, frames accumulate in the underlying buffer and may not reach the TS parent until the Python process exits.

Mitigation: `await stdout.flush()` is not optional — it is load-bearing after every `await stdout.write(frame + "\n")`. Mirror MCP SDK verbatim. Add an integration test that reads from the Python process mid-stream (before exit) to verify frames arrive promptly.

---

## Scope decisions (brain-directed)

These are recommendations; binding lock happens in `docs/briefs/m9_*.md` after user review.

**Layout:** `packages/adapter-python-process/` as a direct sibling to TS packages under `packages/`. Per-package `pyproject.toml` at that directory. The uv workspace root lives inside `packages/adapter-python-process/` — it is NOT a member of any uv workspace rooted at the pnpm root. Separate tool trees; pnpm and uv do not cross.

**Publish:** vendor-in-repo for M9; PyPI publish deferred to M10. Configure the PyPI pending publisher (OIDC) now — zero cost, no token needed, prevents token-bootstrap requirement on first publish. M10 publish uses `uv publish` with `permissions: id-token: write` at JOB scope (not workflow) and `environment: pypi`. PEP 740 attestations deferred to M11.

**`PipelineContext` crossing:** ship `idempotencyKey` only for M9. Wire shape: LSP header `x-pipeline-idempotency-key: <value>` for LSP framing mode; `body.metadata.idempotencyKey` for NDJSON mode. Memory adapter context crossing and `signal.aborted` / cancellation crossing deferred to M10. Addresses Cat IX carry-forward #1 partially.

**Discriminated-union codegen fixture:** ADD a fixture `packages/cli/fixtures/wire-schemas/sample-union.ts` exercising `z.discriminatedUnion()`, plus a committed snapshot `sample-union.py`, plus a `--check`-mode CI step in M9. Current `sample-atom.ts` does not exercise this path. `datamodel-code-generator` behavior on `anyOf` discriminated unions is untested in this codebase — an M10 surprise if skipped.

**`decode_result()` Python helper:** SHIP in M9 as the first foundational primitive. Mirror ADR IX-3 namedtuple shape (`Ok(kind, value)` / `Err(kind, error)`). Unit tests: `{data: {...}, error: null}` → `Ok`; `{data: null, error: {...}}` → `Err`; missing-key edge cases. Adapter authors MUST use it; hand-rolling the discriminant check is prohibited.

**OTel Python:** NO kit-side shim per ADR IX-4. Reference adapter demonstrates OTel Python SDK direct usage: extract `traceparent` from inbound frame (`body.metadata.traceparent` for NDJSON, header for LSP), call `opentelemetry.propagate.extract(carrier)`, start a child span under the extracted context. Kit provides no `SerializableContext` Python type — adapter authors own OTel setup.

**Stdio:** fully async with anyio. Re-wrap `sys.stdin.buffer` and `sys.stdout.buffer` in `TextIOWrapper(encoding="utf-8")` before entering anyio event loop. Read NDJSON frames line-by-line. `await stdout.flush()` after every frame. No threading. No `print()` to stdout under any circumstances. Debug and diagnostic logs to stderr exclusively.

**Bun-compat skipped tests:** NOT in M9 scope. 15 `TODO(M9)` markers noted in M8 report-back exist across `packages/core/tests/` — carry to M10 as a separate unit. M9 is scoped to the Python adapter; TS core cleanup is a separate concern.

**`extra='forbid'` + optional-as-`null` enforcement:** the Python adapter MUST hand-emit `None` (serialized as `null`) for all absent optional fields. Codegen emits `Optional[T]` with `exclude_unset=True` which omits the key — the wrong wire behavior per ADR IX-3. This is a semantic contract the codegen cannot enforce; adapter author responsibility, documented in the adapter's inline comments and the M9 wire guide.

---

## Open questions for brief author

1. **Reference adapter shape — `process-extract` or `process-classify` first?** `process-extract` (`extract-process.ts`) has the fuller pattern (OTel spans, StageErrorCode taxonomy, LLM-call shape) but is more complex. `process-classify` is simpler. Brief author should pick one canonical mirror for M9 and note why.

2. **`idempotencyKey` exact wire shape.** LSP header name confirmed as `x-pipeline-idempotency-key` (brain call above); NDJSON key confirmed as `body.metadata.idempotencyKey`. Bikeshed-resolve and freeze in the brief before any code lands — changing these after the Python adapter ships breaks wire compatibility.

3. **PyPI pending publisher — configure in M9 or defer entirely to M10?** Zero-code workflow step in M9 (add the pending publisher config on npmjs.com... err, on PyPI) vs pure deferral. If M9 executor is expected to configure the pending publisher, the brief needs the exact PyPI project name and GitHub repo/workflow path to specify.

4. **`pk gen-py-schema` dev-env invocation.** `pnpm exec pk` fails in current dev environment (`pk` not globally linked). Two candidates: `pnpm --filter @idriszade/cli exec pk` or `node packages/cli/dist/cli.js gen-py-schema`. Brief verification gate must specify the exact command. Codegen output in M8 was verified via committed snapshot, not a live run.

5. **Bun-skipped tests carry-forward.** Carry to M10 as a separate named unit in the M10 brief, or fold into M9 Wave 2 as a cleanup chore? Brief author should decide and note the disposition so M9's scope boundary is unambiguous.

6. **CI structure.** Add a Python job to `.github/workflows/ci.yml` (alongside the existing Node job) or create a new `.github/workflows/python.yml`? The parallel-sibling-job pattern in `ci.yml` is already established; a new file adds clarity but splits workflow history.

7. **Reference adapter LOC budget.** What is the upper bound for "demonstrates IX-1+IX-2 end-to-end" without becoming a product? A rough target (e.g., ≤ 250 LOC excluding tests) helps the executor draw the line between a demonstration and a feature build.

---

## Carry-forward dispositions (Cat IX)

Matching `docs/research-notes-v1-cat-IX.md` disposition style.

| CF # | Topic | Disposition | Rationale |
|---|---|---|---|
| cf #1 | PipelineContext crossing (`signal.aborted`, `idempotencyKey`, `memory`) | RESOLVED-partial | M9 ships `idempotencyKey` only (LSP header + NDJSON metadata key). Memory crossing and cancellation remain open → M10. |
| cf #2 | Cancellation semantics across runtimes (pipe-close vs `signal.aborted`) | DEFER → M10 | No stdio control channel designed; anyio task-group cancellation on pipe-close is the Python-side default. Full spec deferred. |
| cf #3 | Performance (per-atom parse cost, daemon-vs-spawn, `uv run` cold-start) | DEFER → M10 | `model_validate_json` jiter path chosen; cold-start tax not measured. First adapter perf budget is M10 scope. |
| cf #4 | Bidirectional RPC / callbacks | NOT-APPLICABLE | M9 is unidirectional process adapter. Surfaces only if M10 adapters need agent-tier callbacks; MCP-tier delegation per ADR IX-5 remains the plan. |
| cf #5 | Error-code enumerated taxonomy (`code` is message-sniffed) | DEFER → M10 | ADR IX-3 error shape adopted; `type`+`code` from `extract-process.ts:46-135` is the Python mirror. Full enumeration is a Cat VI / M10 carry. |

---

*End of M9 research notes. 8 scope decisions locked; 7 open questions for brief author; 5 Cat IX carry-forwards dispositioned. Next: M9 brief (`docs/briefs/m9_*.md`) after user review.*

*Author: Brain — 2026-05-23. Inputs: internal codebase research (A) + external industry research (B). Master tip at synthesis: 7640603.*
