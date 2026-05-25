# v1 Research Notes — Cat IX: Cross-Runtime / Cross-Language Interop

> Phase 1 v1 synthesis. Author: Brain — 2026-05-09.
> Inputs: 3 spike FINDINGS files (`research/spikes/cross-runtime/`).
> Friction anchor: F-INTEROP (catalog top-15 #1, 5/9 projects) + F-X-langbridge (#15).
> Status: synthesis complete; 5 ADR candidates locked direction; 5 carry-forwards.

---

## Sources reviewed

### Spike evidence (this kit, 3 throwaway spikes — empirical truth)
- Spike #1 (`fc2b287`, 2026-05-08) — single-atom stdio JSON round-trip. TS → Python → TS. Pydantic v2 hand-written + TS hand-rolled validator. 5 outline-Q findings; 4 unexpected-friction findings.
- Spike #2 (`6f5329d`, 2026-05-08) — NDJSON streaming + error-branch + adversarial timestamps. 3-atom stream; mid-stream error isolation; controlled stray-`print()` experiment. **Falsified spike-1 Q3 #2** (Python `fromisoformat` does NOT reject ≥7-digit fractions; silently truncates).
- Spike #3 (`26f98de`, 2026-05-08) — LSP `Content-Length` framing comparison. Same topology, framing swap. Headline: framing did NOT fix `print()` fragility — `print(flush=True)` shifts loud-failure to silent-pass; 6 new fragility classes.

### External sources (per outline; modern industry standards)
- W3C Trace Context (`traceparent` / `tracestate`) — locked OTel propagation primitive across runtimes.
- RFC 8785 — JSON Canonicalization Scheme (JCS); deterministic byte-form for wire-hash idempotency.
- RFC 3339 — date-time format; constrains the ISO 8601 superset to a wire-safe subset.
- JSON Schema Draft 2020-12 — schema-bridge intermediate format.
- `zod-to-json-schema` (TS) — Zod → JSON Schema codegen, build-time.
- `datamodel-code-generator` (Python) — JSON Schema → Pydantic v2 codegen, build-time.
- Model Context Protocol (MCP, JSON-RPC 2.0 framing) — tool-call boundary; NOT a streaming-pipeline primitive.
- A2A (agent-to-agent, JSON-RPC over HTTP/SSE) — agent-handoff protocol; same delegation as MCP.

---

## Spike #1 — single-atom stdio JSON round-trip

### What was built
TS emits one `Result<Atom<Job>[], E>`; Python validates with Pydantic v2, mutates one field, re-emits; TS validates round-trip. No `@idriszade/*` imports. Stdio bare-JSON, single-shot.

### What it revealed
1. **Result<T,E> is convention-not-tag.** Discriminator `error == null` works structurally but is reimplemented at every cross-runtime hop. One typo silently turns ERR into OK. (Q1)
2. **Atom carries `"object": "atom"` tag — saving grace.** Pydantic `Literal["atom"]` catches drift. (Q2)
3. **Optional fields drop silently** — `JSON.stringify` omits `undefined` keys; Pydantic accepts absence. Provenance fields (`source_id`) cannot survive `undefined` round-trip. (Q2)
4. **Hand-walk schema gap is 6 divergences at 2 schemas, 8 fields** — ID regex / ISO 8601 / enums / length bounds / extra-key behaviour / int-vs-number all diverge silently. (Q3)
5. **`pk_atom_<ulid>` IDs round-trip byte-identical** — ULIDs are ASCII-safe. (Q4)
6. **Timestamp format locked by accident.** TS `toISOString()` and Python `fromisoformat` happen to overlap on 3-digit-fraction-Z form. Spec doesn't constrain. (Q5)
7. **JS Number precision lossy at `2**53 + 1`.** Python int → JS Number silently truncates above `MAX_SAFE_INTEGER`. Latency-ns / byte-counts unsafe.
8. **Pydantic `model_dump(mode="json")` re-spaces.** Byte form differs from `JSON.stringify`. Idempotency-by-wire-hash diverges between hops.

### Code snippet — discriminator-without-tag friction
```python
# py/process_atom.py — every cross-runtime hop reimplements this
payload = json.loads(line)
if payload["error"] is not None:
    return 5  # one typo here silently flips ERR to OK
```

---

## Spike #2 — NDJSON streaming + error-branch + adversarial timestamps

### What was built
3-atom NDJSON stream (happy / hour-24 adversarial timestamp / inverted salary band). Per-line `Result<Atom, E>` envelope. Catch-emit-continue middle stage. Sink classifies + asserts `[OK, ERR(schema), ERR(business_rule)]`. Stray-`print()` controlled experiment.

### What it revealed
1. **NDJSON framing is loud-only-with-discipline.** Stray `print()` between frames produces a malformed line at the call site; sink fails loud at exit code 3. Position of corruption is diagnostically meaningful. (A)
2. **Mid-stream errors are isolating, not contagious** — atom #3's business-rule check ran independently of atom #2's schema failure. (D)
3. **Per-line `Result<Atom, E>` dissolves the batch-vs-stream conflation.** Spike-1's `Result<Atom[], E>` envelope conflates "whole batch failed" with "some atoms failed"; per-frame envelope removes the conflation. (E)
4. **Python 3.12 `fromisoformat` silently truncates ≥7-digit fractional seconds** to microsecond precision. Spike-1 Q3 #2 was wrong; this is the inverse failure mode (fail-quiet, not fail-loud). Wire-hash-based idempotency diverges between hops. **Most important finding of spike #2.**
5. **Python stdout buffering is mode-dependent** — line-buffered on tty, block-buffered on pipe. Without explicit `sys.stdout.flush()`, mid-stream errors invisible until process exit.
6. **JSON-spacing asymmetry — TS `JSON.stringify` no-space vs Python `json.dumps` default `, `/`: `.** Same logical content, byte-different wire form. Body sizes differ ~10%.
7. **Error `code` is heuristic message-sniffing.** Spike emits `code=iso_8601_invalid` by string-matching `not ISO 8601` in the Pydantic message. Real adapters need an enumerated taxonomy.

### Code snippet — silent-truncate finding
```python
# Python 3.12.0 — all PASS, silently dropping precision
datetime.fromisoformat('2026-05-08T12:34:56.1234567Z')
# -> 2026-05-08 12:34:56.123456+00:00  (7-digit input, 6-digit output)
datetime.fromisoformat('2026-05-08T12:34:56.123456789Z')
# -> 2026-05-08 12:34:56.123456+00:00  (9-digit input, 6-digit output)
```

---

## Spike #3 — LSP Content-Length framing

### What was built
Same topology; wire-format swap to `Content-Length: N\r\n\r\n<body>` per envelope. Binary stdio (`sys.stdin.buffer` / `sys.stdout.buffer`). 8 KiB header bound. Two stray-`print()` runs: no-flush vs `flush=True`.

### What it revealed
1. **Run B no-flush — bytes land at end-of-stream, not call-site.** Python text-mode `print()` writes through `sys.stdout` (TextIOWrapper, block-buffered) while `_emit_frame` writes raw bytes through `sys.stdout.buffer`. Two buffers, one fd; text buffer flushes after binary at exit. Sink reads all 3 frames cleanly, then chokes at offset 1063 with `no header terminator`. Exit 3. **Loud, but call-site debugging worse than NDJSON.**
2. **Run B `flush=True` — bytes land BETWEEN frames; sink SILENTLY PASSES.** The `flush=True` print drops bytes between frame-1 body and frame-2 `Content-Length:` header. Sink's regex `/content-length\s*:\s*(\d+)/i` skips the print bytes as header preamble noise; the next `Content-Length: 213` matches; **verdict claims `PATTERN OK`, exit 0.** Header parser is too lenient.
3. **Strict header parser closes the silent-pass class.** Reject any non-`Content-Length:` line on the FIRST line of the header block. LSP-compat divergence (LSP permits multiple headers like `Content-Type`); kit-internal mode justifies the divergence.
4. **Content-Length lying — silent corruption potential.** Hand-crafted frame with `Content-Length: 100` but only 50 body bytes followed by next frame's header eats the next header. Catastrophic. No kit defence in current implementation.
5. **UTF-8 byte-vs-char trap (latent).** Both spike sides count bytes; one `len(s)` away from drift on any non-ASCII payload.
6. **Header parse cost ~5× NDJSON.** ~50 LOC vs ~10. Per-frame ops ~10 vs ~3 (plus ~50 micro-reads in pure Python).
7. **Header overhead 21 bytes vs NDJSON's 1 byte.** ~20× per-frame; negligible at atom-size payloads, meaningful at 100-byte heartbeat scale (~21% overhead).
8. **Binary stdout is a forcing function.** `print()` becomes obviously misbehaved (wrong-time bytes); the "no print() in stage code" rule self-enforces.

### Code snippet — the silent-pass attack surface (run-B `flush=True`)
```
[frame1 hdr][frame1 body]debug: about to process atom 2\n[frame2 hdr][frame2 body]...
                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                          absorbed by lax header-block search → exit 0, PATTERN OK
```

---

## Open questions answered (5 outline questions)

### Q1 — Cross-runtime answer: wire protocol, binding, or both?
**Wire protocol.** Two co-existing modes — NDJSON-over-stdio (default) for stream-style adapters; LSP `Content-Length` framing (opt-in) for high-stakes adapters where silent corruption is unacceptable. Bindings (e.g. `pyo3` / N-API) are out of scope — kit stays library-tier; native bindings break the "any-runtime adapter" reach Phase 0 demands. (See ADR-v1-IX-1.)

### Q2 — How does Result<T,E> translate? (Python has no discriminated unions.)
**Discriminator `{data, error}` stays unchanged (no v0 ADR4 amendment).** Kit ships a sanctioned `decode_result()` helper per runtime — the ONLY entry point cross-runtime adapters use to inspect the discriminant. Consolidates the convention-not-tag friction at one function instead of every hop. Per-frame `Result<Atom, E>` is the streaming wire shape; batch `Result<Atom[], E>` retained for closed-batch endpoints. (See ADR-v1-IX-3.)

### Q3 — How do Zod schemas reach Python — codegen or JSON Schema bridge?
**JSON Schema bridge, build-time codegen.** Zod is source-of-truth (TS-primary per v0). `zod-to-json-schema` emits JSON Schema Draft 2020-12 at adapter package build; `datamodel-code-generator` consumes the schema and emits Pydantic v2 at the same build step. Hand-walk gap is already 7 divergences at 2 schemas + 1 ruleset (spike #2 §"Cross-spike comparison"); 15+ ref adapters in v1 makes hand-walk irresponsible. (See ADR-v1-IX-2.)

### Q4 — Cross-runtime OTel context propagation?
**W3C Trace Context (`traceparent` / `tracestate`), out-of-band of Atom data.** LSP-mode: `traceparent` as a second header line alongside `Content-Length`. NDJSON-mode: `metadata.traceparent` on each Atom envelope. Never mutate Atom `data` shape. Kit ships only the wire plumbing; Python-side OTel SDK setup is the adapter author's responsibility — kit ships no Python OTel shim. (See ADR-v1-IX-4.)

### Q5 — Does kit own the cross-runtime spec, or delegate to MCP / A2A?
**Kit OWNS the wire-format spec for Source ↔ Process ↔ Serve cross-runtime hops.** Spec = framing (NDJSON | LSP) + canonical JSON (RFC 8785) + RFC 3339 timestamp subset + per-frame Result envelope + JSON Schema bridge + W3C Trace Context. MCP and A2A are HIGHER-level protocols kit speaks via dedicated adapters (`source-mcp` / `serve-mcp` / future `agent-a2a`) — they are NOT the cross-runtime pipeline primitive. MCP's JSON-RPC 2.0 framing fits tool-call boundary; wrong shape for streaming pipelines. (See ADR-v1-IX-5.)

---

## Open questions unresolved (carry-forwards)

1. **PipelineContext crossing the wire** (`signal.aborted`, full trace plumbing, `idempotencyKey`, `memory`) — out of scope spikes #1-#3. Cross-cuts Cat VI (two-plane / control-plane). Carry to Cat VI synthesis or a dedicated spike if friction surfaces in M2.
2. **Cancellation semantics across runtimes** — does Python honour pipe-close as `signal.aborted`? Bidirectional control channel needed or stderr-as-signal sufficient? Same Cat VI cross-cut.
3. **Performance** — per-atom serialise/parse cost, daemon-vs-spawn-per-batch, cold-start `uv run` tax. All unmeasured. Defer to first cross-runtime adapter perf budget in M2.
4. **Bidirectional RPC / callbacks** — out of scope; surfaces only if M2 adapters need agent-tier callbacks. Opens MCP-tier delegation per ADR-v1-IX-5.
5. **Error-code enumerated taxonomy** (spike-2 finding 7) — `code` is currently message-sniffed string-match. Carry-forward to **Cat VI synthesis** (stage-model error semantics is a stage-model concern, not cross-runtime-specific).

### Falsification note (epistemic hygiene)
Spike-1 Q3 finding #2 claimed Python's `fromisoformat` rejects ≥7-digit fractional seconds. **Spike-2 falsified this** — Python 3.12 silently truncates to microseconds. This synthesis uses the corrected version; the original wrong-direction finding is preserved in spike-1's FINDINGS.md for audit trail.

---

## ADR candidates

### ADR-v1-IX-1 — Cross-runtime wire format: NDJSON default + LSP opt-in

**Status:** v1 candidate (synthesis 2026-05-09). Awaiting brain v1 spec lock.

**Context:** Half the constellation is Python (pursuit / agent-forge / cole-obsidian / gatewerk SDK dual). v0 left cross-runtime undefined. Spikes #1-#3 probed three wire formats (single-atom, NDJSON, LSP) and surfaced fragility classes for each.

**Decision:** Kit ships TWO cross-runtime wire modes co-existing:
1. **NDJSON-over-stdio (default).** One JSON envelope per `\n`-terminated line. Binary stdio enforced (`stdin.buffer` / `stdout.buffer` Python; node default). `print()` redirected to stderr by adapter convention. Canonical JSON per RFC 8785 (compact, sorted keys, no whitespace). Timestamps RFC 3339 + millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`); sub-millisecond precision SHALL be rejected at the boundary.
2. **LSP `Content-Length` framing (opt-in).** Per-envelope `Content-Length: N\r\n\r\n<N body bytes>`. Strict header parser: reject any non-`Content-Length` line on the FIRST line of the header block (closes spike-3 silent-pass class). 8 KiB header bound. Body length validated against header; partial-frame-on-EOF emits `wire/truncated_body` and exits non-zero.

**Alternatives considered:**
- *JSON-RPC 2.0 bidirectional (used by MCP).* Rejected as kit primitive — surface too large; bidirectional callbacks are agent-tier, not streaming-pipeline. Available via `source-mcp` / `serve-mcp` adapters per ADR-v1-IX-5.
- *Length-prefixed binary framing (varint + body).* Rejected — operator-unfriendly (no `cat`-able wire form), no dominant standard, opaque to debug tools.
- *Single mode (NDJSON-only OR LSP-only).* Rejected — NDJSON's framing fragility (spike #2) is unacceptable for high-stakes adapters; LSP's per-frame cost (spike #3) is unjustified for low-stakes streaming. Two modes acknowledge the trade.

**Reference:** RFC 8785 (JCS); RFC 3339 (date-time); LSP Specification §"Base Protocol"; spike #2 + spike #3 FINDINGS.

**Consequences:**
- Spike-3 `print(flush=True)` silent-pass closed by strict-header-parser load-bearing requirement.
- Spike-2 Python `fromisoformat` silent-truncate closed by RFC-3339-millisecond-only timestamp constraint at the boundary.
- Spike-2 JSON-spacing asymmetry closed by RFC 8785 canonical JSON requirement.
- Spike-1 Number-precision lossy: kit MUST disallow integers > `Number.MAX_SAFE_INTEGER` in cross-runtime fields, OR require string encoding (BigInt-style).
- Per-frame `Result<Atom, E>` is the canonical streaming shape; batch `Result<Atom[], E>` valid for closed-batch endpoints.
- Adapter authors choose framing per-adapter; kit ships both parsers + helpers.
- LSP mode rejects unknown header lines — divergence from LSP spec, justified for kit-internal use.
- UTF-8 byte-vs-char latent bug (spike-3 B-5): kit byte-counters MUST count UTF-8 bytes, not chars; document.

### ADR-v1-IX-2 — Schema bridge: Zod → JSON Schema → Pydantic, build-time codegen

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike-1 surfaced 6 hand-walk divergences between TS and Python schemas at 1 envelope + 1 payload (8 fields). Spike-2 added a business-rule layer Python-only — gap grew to 7. v1 ships 15+ reference adapters. Hand-walk is irresponsible at scale.

**Decision:** Zod is source-of-truth (TS-primary per v0). At adapter package build time:
1. `zod-to-json-schema` emits JSON Schema Draft 2020-12 (`schemas/<adapter>.schema.json`).
2. `datamodel-code-generator` consumes the JSON Schema and emits Pydantic v2 model (`<adapter>_py/models.py`).
3. Both outputs version-locked to the Zod source; CI verifies regen-stability (output byte-identical to committed copy).

**Alternatives considered:**
- *Hand-written-twice.* Rejected — 7 divergences at 2 schemas; non-responsible at v1 scale.
- *Runtime codegen (parse Zod → emit Pydantic per request).* Rejected — defeats type narrowing; per-call cost; brittle.
- *Pydantic-as-source.* Rejected — kit is TS-primary per v0; reversing source-of-truth would invert SDK ergonomics.
- *Custom kit-defined schema DSL.* Rejected — invents a third format with no ecosystem; Zod + Pydantic are dominant.

**Reference:** JSON Schema Draft 2020-12; `zod-to-json-schema`; `datamodel-code-generator`; spike-1 §Q3; spike-2 §"Cross-spike comparison".

**Consequences:**
- Adapter package build adds a codegen step; CI must enforce regen-stability.
- Zod features without JSON Schema equivalents (refinements, transforms, `.brand()`) MUST be flagged at codegen time and either hand-translated or moved to runtime validators.
- Python adapter consumers depend on Pydantic v2 (kit-pinned major version).
- A divergence between regen output and committed copy is a CI failure — schema drift cannot ship silently.
- Business-rule layer (spike #2's `business_rules.py`) is NOT in JSON Schema scope; remains hand-walked OR moves to a kit-defined post-validation hook (out of scope here; flag for Cat VI).
- Codegen-from-single-source PoC deferred to first cross-runtime adapter implementation in M2; ADR direction is defensible from spike-evidence shape alone.

### ADR-v1-IX-3 — Result<T,E> cross-runtime: keep `{data, error}`, ship `decode_result()` helper, per-frame envelope

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike-1 Q1 + spike-2 §B established that `{data, error}` discriminator works structurally across runtimes but is convention-not-tag — every cross-runtime hop reimplements the discriminator check; one typo flips ERR to OK silently. Spike-2 also showed batch `Result<Atom[], E>` vs streaming `Result<Atom, E>` conflate two failure modes.

**Decision:**
1. Discriminator stays `{data, error}` shape (no v0 ADR4 amendment per outline rule).
2. Kit ships a sanctioned `decode_result()` helper per runtime — TS / Python at v1, Rust / Go if adapter pressure surfaces. The helper is the ONLY sanctioned way for cross-runtime adapters to inspect the discriminant; it returns a tagged value (`{kind: 'ok', value} | {kind: 'err', error}` in TS; `Ok(value) | Err(error)` namedtuple in Python).
3. Per-frame `Result<Atom, E>` is the canonical streaming wire shape (one envelope per frame, ERR-on-frame-N does not poison frame-N+1).
4. Batch `Result<Atom[], E>` retained for closed-batch endpoints (e.g. Source single-shot fetch).
5. Adapter selection of per-frame vs batch is documented in the adapter's wire-format declaration.

**Alternatives considered:**
- *Add `"object": "result"` self-describing tag.* Rejected — violates "no v0 ADR amendment during v1" rule. Surface as v1 spec open question for next-phase brain decision; do not ship as v1 ADR.
- *Force per-frame everywhere.* Rejected — closed-batch endpoints suffer no batch-vs-stream conflation; per-frame adds wire-format ceremony for no friction reduction.
- *Force batch everywhere.* Rejected — spike-2 §E proved batch envelope conflates "whole batch failed" with "some atoms failed"; streaming adapters need per-frame.

**Reference:** v0 ADR4 (`Result<T,E>`); spike-1 §Q1; spike-2 §B + §E.

**Consequences:**
- Convention-not-tag friction is funneled to one helper per runtime — typo damage bounded.
- Adapter authors MUST use `decode_result()` and not hand-roll the discriminator check; lint rule + code review enforce.
- Cross-runtime test suites verify `decode_result()` round-trip; falsification of discriminator semantics fails CI.
- Per-frame envelope removes batch conflation but adds per-frame parse overhead — measured per-adapter, not pre-emptively optimised.
- `null`-vs-`undefined` semantics (spike-1 §"Unexpected friction"): kit cross-runtime sources MUST emit `null` for absent optional fields, never omit the key.
- Future v1.x: re-evaluate self-describing tag if open-question pressure grows; not v1.0.

### ADR-v1-IX-4 — Cross-runtime OTel: W3C Trace Context, out-of-band

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** v0 ships OTel-native traces in-process (TS-only). Cross-runtime hops need trace continuity — Python-side process spans must parent off the TS-side caller span. Atom shape is locked (v0 ADR); cannot mutate `data`.

**Decision:** W3C Trace Context (`traceparent` + optional `tracestate`) propagated out-of-band:
- **LSP-framing mode:** `traceparent` as a second header line alongside `Content-Length`. Strict parser accepts `Content-Length` as line 1; `traceparent` (if present) as line 2; rejects unknown headers thereafter. Frame-level granularity.
- **NDJSON mode:** `metadata.traceparent` on each Atom envelope (allowed by v0 ADR — `metadata` is `Record<string, unknown>` and NOT part of Atom `data`). Frame-level granularity.
- Kit ships only the wire plumbing. Python-side adapter authors MUST configure their own OTel SDK exporter; kit ships no Python OTel SDK shim.

**Alternatives considered:**
- *In-band: add `traceparent` to Atom data shape.* Rejected — mutates v0 ADR-locked Atom shape; Atom data is user-domain, trace-context is infra-cross-cut.
- *Sidecar control channel (stderr structured logs / second pipe / unix socket).* Rejected as primary mechanism — adds a second wire format and OS-level coupling for one cross-cut. Reconsider if PipelineContext crossing (carry-forward #1) needs a control channel; trace context could co-locate.
- *No cross-runtime trace context.* Rejected — F-INTEROP top-15 #1 evidence demands operational visibility; debugging cross-runtime hops without trace continuity is unacceptable.

**Reference:** W3C Trace Context Recommendation; OpenTelemetry Specification §Context; spike-1 / spike-2 / spike-3 §"What this spike does NOT prove".

**Consequences:**
- Atom shape unchanged — v0 compat preserved.
- LSP-mode strict header parser must whitelist `traceparent` + `tracestate` alongside `Content-Length`.
- NDJSON-mode envelopes carry trace context as Atom `metadata` — adapter consumers extract via standard OTel SDK.
- Python adapter authors bear OTel SDK setup cost — kit's "library beneath workflow engines" stance.
- No cross-runtime span linkage spec beyond W3C Trace Context — kit punts to the OTel ecosystem.
- Carry-forward #1 (PipelineContext crossing) may add a sidecar control channel; if it does, trace context MAY relocate to the sidecar. Re-evaluate at Cat VI synthesis.

### ADR-v1-IX-5 — Kit owns wire-format spec; MCP / A2A delegated to adapter-tier

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** v1 outline §Cat IX Q5: "Does kit own the cross-runtime spec, or delegate to MCP / A2A?" MCP and A2A are emerging industry standards (2024-26) for tool-call and agent-handoff respectively. Both use JSON-RPC 2.0. Question: are they kit's cross-runtime primitive, or one-tier-up adapters?

**Decision:** Kit OWNS the cross-runtime wire-format spec for Source ↔ Process ↔ Serve hops. Spec = ADR-v1-IX-1 framing + RFC 8785 canonical JSON + RFC 3339 timestamp subset + per-frame Result envelope (ADR-v1-IX-3) + JSON Schema bridge (ADR-v1-IX-2) + W3C Trace Context (ADR-v1-IX-4). MCP and A2A are delegated to adapter-tier:
- `source-mcp` (already v0) — kit speaks MCP as a Source.
- `serve-mcp` (already v0) — kit speaks MCP as a Serve.
- Future `agent-a2a` — kit speaks A2A as an agent-handoff Serve.

These adapters use MCP's / A2A's JSON-RPC 2.0 framing internally. They do NOT replace the kit cross-runtime primitive.

**Alternatives considered:**
- *Delegate cross-runtime entirely to MCP.* Rejected — MCP's JSON-RPC 2.0 is request/response with `id` correlation, designed for tool-call boundary; wrong shape for streaming Source/Process/Serve pipelines (no streaming primitive in MCP base spec).
- *Delegate cross-runtime entirely to A2A.* Rejected — A2A is agent-to-agent handoff, not data-pipeline primitive; over-fits to agent use cases and under-fits to data ETL.
- *Kit owns wire format AND ships an MCP-compat shim where every adapter exposes itself as MCP.* Deferred — auto-MCP exposure is a Cat IX-adjacent concern (v0 cat-IX synthesis raised it as open question; carries forward). Kit can ship `pk gen-mcp` codegen later without changing the cross-runtime primitive.

**Reference:** MCP Specification (Anthropic); A2A Specification (Google); JSON-RPC 2.0; v0 cat-IX synthesis open questions.

**Consequences:**
- Kit's cross-runtime primitive is small and pipeline-shaped — does not chase MCP / A2A surface area.
- `source-mcp` / `serve-mcp` adapters bridge kit to the MCP ecosystem at adapter-tier; users compose them with kit adapters using kit's wire format internally.
- Future agent-handoff (Cat II) compositions will likely add `serve-a2a` and possibly `process-agent-a2a` per Cat II ADRs; ADR-v1-IX-5 establishes the delegation pattern.
- Auto-MCP codegen (`pk gen-mcp`) remains an open question; not blocked by ADR-v1-IX-5.
- Kit's cross-runtime adapter packages MUST declare which mode they use (NDJSON | LSP | MCP-via-source-mcp | A2A-via-serve-a2a) in their `package.json` `pipeline_kit.wire` field — single source of truth for operators.

### ADR IX-6 — idempotencyKey wire-shape (cross-adapter canonical)

**Status:** Accepted 2026-05-25 (Wave 2 U4 ratification).

**Context:**
M9 (2026-05-23) shipped the idempotencyKey wire convention informally when the Python `process-classify` adapter began consuming it. At that time the ratification gate was phrased as "2nd JS adapter consumes the wire shape" — deferred through M9 → M12 because no 2nd JS adapter materialized.

M13 U3 adds `process-extract` Python (a 2nd Python adapter). With `process-classify` Python (M9) + `process-extract` Python (M13) = 2 adapter consumers of the wire shape.

Gate relaxed at M13 to "2nd adapter (any language)" — rationale: the wire shape is language-neutral by design (NDJSON envelope + LSP Content-Length framing per ADR IX-1); cross-adapter consensus is what the gate was probing for, not language-specific shape divergence. Two Python consumers exercising the spec without divergence is sufficient evidence the contract is well-formed.

**Decision:**
- `SerializableContext` interface (defined at `packages/core/src/serializable-context.ts:8-12`) is the canonical wire shape for cross-adapter idempotency.
- LSP header: `x-pipeline-idempotency-key`.
- NDJSON body field: `body.metadata.idempotencyKey`.
- Wire shape is language-neutral by design (NDJSON + LSP framing inherited from ADR IX-1).

**Alternatives considered:**
- *Wait for a 2nd JS adapter.* Rejected at M13 — the original gate was probing cross-adapter consensus, not language enforcement; two Python consumers without divergence meets that bar.
- *Embed idempotencyKey in Atom data shape.* Rejected — idempotencyKey is infra-cross-cut, not user-domain data; same reasoning as W3C Trace Context out-of-band per ADR IX-4.
- *Separate idempotency header per-framing-mode.* Rejected — single `SerializableContext` field is framing-mode-neutral; both NDJSON and LSP modes derive their representation from the same contract.

**Consequences:**
- Positive: formal spec for cross-runtime idempotency; one less informal-spec carry-forward; the M9 wire convention becomes load-bearing rather than provisional.
- Negative: codifies the language-neutral assumption — revisit if a JS-specific wire concern surfaces (e.g., a future JS adapter discovers a TC39 stream behavior that diverges from Python's NDJSON parser).
- No code changes required — `SerializableContext` already exists as canonical TS interface.

**Revisit triggers:**
1. Future Source/Serve adapter discovers idempotency edge cases not covered by `SerializableContext`.
2. A 2nd JS adapter materializes and surfaces a JS-specific divergence in wire-shape interpretation.
3. The LSP framing or NDJSON envelope ADRs (IX-1 / IX-2) get revised.

**Cross-references:**
- ADR IX-1 — wire framing (NDJSON + LSP Content-Length)
- ADR IX-2 — Zod → JSON Schema → Pydantic build-time
- ADR IX-3 — decode_result helper + per-frame Result
- ADR IX-4 — W3C Trace Context out-of-band
- ADR IX-5 — kit owns wire-spec; MCP+A2A delegated to adapter-tier
- `packages/core/src/serializable-context.ts:8-12` — canonical TS interface
- M9 executor brief — where informal convention was first shipped

---

*End of v1 Cat IX research notes. 6 ADR candidates locked direction (IX-6 ratified M13 U4 2026-05-25); 5 carry-forwards; epistemic-hygiene falsification preserved. Next-next-session candidate: Cat VIII synthesis (anchoring cleared by this synthesis); next: brain decides.*

*Author: Brain — 2026-05-09. Inputs: spike #1 `fc2b287` / spike #2 `6f5329d` / spike #3 `26f98de`. Branch: `v1-cat-IX-synthesis-notes`. Master tip at synthesis: `f6c0695`. ADR IX-6 appended 2026-05-25 by M13 U4 executor.*