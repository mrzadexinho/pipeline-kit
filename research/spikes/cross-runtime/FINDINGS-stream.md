# Cat IX Spike #2 — NDJSON Streaming + Error Path Findings

> Spike: 3-atom NDJSON stream with adversarial timestamp + business-rule rejection.
> Branch: v1-spike-cat-ix-day-2.  Author: Executor — 2026-05-08.
> Companion to: docs/research-outline-v1.md § Category IX, FINDINGS.md (day-1).
> Status: spike output (NOT a notes file; brain synthesises notes-v1-cat-IX.md after all Cat IX spikes).

## What was built

A 3-stage stdio pipe identical in topology to day-1 but with NDJSON line-per-atom granularity. `node ts/atom-emit-stream.ts` emits 3 Result envelopes (one per line): a happy atom, an envelope-level adversarial timestamp (hour 24), and a schema-valid Job whose salary band is inverted. `uv run python3 py/process_stream.py` reads NDJSON, validates each atom against day-1's `schema.Atom` (UNCHANGED), runs business rules from `py/business_rules.py`, and emits one Result-per-line. `node ts/result-validate-stream.ts` classifies the 3 lines and verifies the exact pattern `[OK, ERR(schema), ERR(business_rule)]` — fails loud on any deviation.

## How to reproduce

```bash
bash research/spikes/cross-runtime/run-stream.sh
```

Day-1 still passes:

```bash
bash research/spikes/cross-runtime/run.sh
```

## Captured run output

Stage 1 (TS → wire) — 3 NDJSON lines:

```
{"data":{"id":"pk_atom_06F0KK5EQMF7T4BJTKN6HKTV39","object":"atom","created_at":"2026-05-08T22:54:29.564Z","metadata":{"spike":"cat-ix-day-2","emitter":"ts/atom-emit-stream.ts","case":"happy"},"data":{"title":"Senior Backend Engineer", ... ,"tags":["typescript","distributed-systems","kafka"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_..."},"error":null}
{"data":{"id":"pk_atom_06F0KK5EQMYYDFDZZH2X1HY0XK","object":"atom","created_at":"2026-05-08T24:00:00.000Z","metadata":{...,"case":"adversarial-ts"},"data":{"title":"Staff Backend Engineer", ... },"source_id":"pk_src_spike_emitter","run_id":"pk_run_..."},"error":null}
{"data":{"id":"pk_atom_06F0KK5EQM0TMCAN0GW0SESANG","object":"atom","created_at":"2026-05-08T22:54:29.564Z","metadata":{...,"case":"salary-inverted"},"data":{"title":"Principal Engineer","company":"Beta Inc","location":null,"posted_at":null,"salary_min":200000,"salary_max":100000,"remote":"hybrid","tags":["leadership","platform"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_..."},"error":null}
```

Stage 2 (Python → wire) — 1 OK + 2 ERR, one per line:

```
{"data": {"id": "pk_atom_...", "object": "atom", "created_at": "...", "metadata": {..., "case": "happy", "py_hop": "process_stream.py"}, "data": {"title": "SENIOR BACKEND ENGINEER", ...}, ...}, "error": null}
{"data": null, "error": {"type": "schema", "code": "iso_8601_invalid", "message": "atom pk_atom_...: 1 error(s) at created_at; first: Value error, not ISO 8601: '2026-05-08T24:00:00.000Z'"}}
{"data": null, "error": {"type": "business_rule", "code": "salary_inverted", "message": "atom pk_atom_...: salary_max (100000) < salary_min (200000); band is inverted"}}
```

Stage 3 (TS sink classification + verdict):

```
result-validate-stream: read 3 line(s)
  line 1: OK   atom=pk_atom_06F0KKEEE0HDAJVAG0M9XGAQGM
  line 2: ERR  type=schema code=iso_8601_invalid
  line 3: ERR  type=business_rule code=salary_inverted
result-validate-stream: PATTERN OK — 1 OK + 2 ERR(schema, business_rule)

==> spike OK: NDJSON stream + error-branch round-trip succeeded
```

## Findings (per spike question A–E)

### A — NDJSON framing fragility

**NDJSON-over-stdio holds when both sides discipline their stdout, but the discipline is implicit.** The clean 3-line run above proves the happy path: each `process.stdout.write(... + '\n')` on the TS emitter and each `sys.stdout.write(... + '\n'); sys.stdout.flush()` on the Python middle stage produce exactly the lines the sink expects, in order, line-aligned. There is no length-prefix, no sentinel, no escape rule. The framing contract is *every* stdout byte must be JSON-then-newline; nothing else. See section "NDJSON framing controlled experiment" below for evidence of how loud the failure becomes when that contract breaks.

A smaller framing-adjacent observation: `sys.stdout.flush()` is necessary, not optional. Python defaults stdout to line-buffered when isatty, but block-buffered when piped — without an explicit flush the consumer sees the lines arrive in big chunks at exit time, which obscures mid-stream errors and would defeat any backpressure design.

### B — Error/OK discrimination at scale

**Day-1's "convention not tag" finding (Q1) holds and gets sharper.** With per-line Result envelopes the sink runs the discriminator check (`error !== null`) 3 times, once per line. The check works deterministically — `null` and an object literal are JSON-distinguishable — but every line costs a runtime test the wire format does not enforce. The sink classified all 3 lines correctly: 1 OK, 2 ERR, and the ERR lines further sub-classified by `error.type` (`"schema"` vs `"business_rule"`). All three ERR-side type codes appear verbatim in the sink output: `code=iso_8601_invalid` and `code=salary_inverted`.

What spike #1's single-atom case hid: at scale, **a single typo in the discriminator (`error == null` instead of `error === null`, JS coercion-permissive) would silently turn one ERR line into an OK and the entire stream's verdict into "passed"**. ADR4's `{data, error}` shape has no self-describing tag (e.g. `"object": "result"`) — every consumer reimplements the gate.

### C — Schema-drift fail-fast on adversarial timestamp

**Python fails fast, names the offending atom, but the original adversarial fixture (7-digit fractional seconds) was wrong.** Day-1 FINDINGS Q3 #2 claimed Python's `datetime.fromisoformat` "tolerates only 3 or 6 digits" and would reject `2026-05-08T12:34:56.1234567Z`. Probing in this spike's environment (Python 3.12.0):

```
PASS: '2026-05-08T12:34:56.1234567Z'    -> 2026-05-08 12:34:56.123456+00:00   # 7-digit
PASS: '2026-05-08T12:34:56.12345678Z'   -> 2026-05-08 12:34:56.123456+00:00   # 8-digit
PASS: '2026-05-08T12:34:56.123456789Z'  -> 2026-05-08 12:34:56.123456+00:00   # 9-digit
PASS: '2026-05-08T12:34:56.1234Z'       -> 2026-05-08 12:34:56.123400+00:00   # 4-digit
```

`fromisoformat` **silently truncates** to microsecond precision rather than raising. This is itself the most important finding of spike #2 — see "Unexpected friction" #1.

After substituting a genuinely TS-passes / Python-fails fixture (`2026-05-08T24:00:00.000Z`, hour 24 — TS regex does not validate numeric ranges, Python `fromisoformat` does), the schema branch behaves correctly: Pydantic raises a `ValidationError` at `created_at`, the Process catches it, emits `{"type":"schema","code":"iso_8601_invalid","message":"atom pk_atom_<id>: 1 error(s) at created_at; first: Value error, not ISO 8601: '2026-05-08T24:00:00.000Z'"}`, and the offending atom's ID is preserved in the message. **Diagnostic round-trip works**; what is not yet machine-friendly is the `code`: it is heuristically derived (string-match `not ISO 8601` in the pydantic message). A real adapter would need an enumerated error catalogue, not message-sniffing.

### D — Mid-stream error semantics

**Atoms #1 and #3 both succeeded despite atom #2's schema failure.** Stage 2's loop emits one Result-per-line and never raises across the loop boundary; each `_process_line` call is a pure transformation and returns either an OK or ERR envelope. The sink confirmed: line 1 OK, line 2 ERR(schema), line 3 ERR(business_rule). Crucially, the ERR on line 2 did NOT cause line 3 to be dropped or re-classified — line 3's `salary_inverted` business-rule check ran independently. **Mid-stream errors are isolating, not contagious.**

Caveat: this depends on the Process author writing the loop in catch-emit-continue style. A naive `for atom in atoms: validate(atom); mutate(atom); emit(atom)` with bare `raise ValidationError` would halt the whole stream on atom #2. The framework needs to make catch-emit-continue the *easy* path; it currently isn't.

### E — Result-granularity shift (batch vs stream)

**Going from `Result<Atom[], E>` (day-1) to `Result<Atom, E>` (spike #2) surfaces a v1 spec gap.** Day-1's batch envelope conflated two failure modes: (1) "the whole batch failed" (e.g. upstream Source died) and (2) "every atom in the batch was processed but some had problems" — there was no place to put per-atom errors except by overloading `data` with a sentinel or carrying a parallel error array.

Per-line Result<Atom, E> dissolves that conflation: each line is its own success/failure verdict, and the *batch* is whatever the consumer counts at the end of the stream. This is closer to how real iter()/AsyncIterable adapters work. But day-1's `ResultOk` Pydantic model (in `py/schema.py`) is typed `data: list[Atom]` — that shape is now wrong for streaming. Day-1's middle stage (`py/process_atom.py`) reads `sys.stdin.read()` (whole-buffer slurp) — also wrong for streaming.

Spike #2 sidestepped both by writing a parallel `process_stream.py` that reads stdin line-by-line and never imports `ResultOk`. **The v1 spec needs to declare batch-vs-stream as an explicit ADR-shaped choice**, not leave it implicit in the wire format. Brain decides; spike does not propose.

## NDJSON framing controlled experiment

Per the brief, ran the deliberate-stray-`print()` experiment. Inside `py/process_stream.py`'s main loop, between atom #1's emit and atom #2's processing, inserted a single `print("debug: about to process atom 2")`. Re-ran `bash run-stream.sh`. Output:

```
result-validate-stream: read 4 line(s)
  line 1: OK   atom=pk_atom_06F0KK9Z9GM1CMXZPCE9MW3XW7
  line 2: MALFORMED  raw=debug: about to process atom 2...
  line 3: ERR  type=schema code=iso_8601_invalid
  line 4: ERR  type=business_rule code=salary_inverted
result-validate-stream: 1 malformed line(s) — framing broken
EXIT=3
```

**One stray `print()` corrupts the wire.** The sink read 4 lines instead of 3, identified line 2 as JSON-unparseable (raw text `debug: about to process atom 2`), and exited non-zero. Note that atoms #1, #3, #4 are still individually well-formed — the data is recoverable in principle — but the *contract* (one envelope per line, all valid JSON) is broken, so the sink fails loud rather than guess. Reverted the print; clean run restored.

Implication: any future Python middle stage that uses `print()` for debugging (the most common Python idiom) silently breaks the wire format. A v1 stdio-based cross-runtime adapter must (a) reroute Python `print()` to stderr by default, or (b) require an explicit framing layer (length-prefix, JSON-RPC) so a stray text line cannot be mistaken for an envelope.

## Cross-spike comparison (vs day-1)

- Day-1 only exercised the OK branch; spike #2 confirms the ERR branch round-trips just as well *structurally*, but exposes that the type/code taxonomy is undeclared (`"type": "schema"` vs `"business_rule"` are spike-invented strings, not v1-spec'd).
- Day-1 said Python's `fromisoformat` would reject 7-digit fractions. **Spike #2 disproves this.** Python 3.12 silently truncates to microseconds. Cross-runtime byte-equality on `created_at` is therefore not preserved if a TS Source emits sub-microsecond precision (browsers don't, but `process.hrtime.bigint()`-derived timestamps could).
- Day-1's `Result<Atom[], E>` batch envelope worked for one atom; spike #2 shows the per-line `Result<Atom, E>` granularity is a different shape entirely, and day-1's Pydantic `ResultOk` model is unusable for streaming.
- Day-1 noted "a single `console.log` in TS would corrupt the pipe" as a recommendation for spike #2; **confirmed** by the framing experiment. The failure mode is loud (sink exits non-zero), not silent — that's a small mercy.
- Day-1's hand-walk gap (six divergences between `ts/validate.ts` and `py/schema.py`) inherits to spike #2 unchanged: the spike chose to NOT extend either file (preserving the comparison baseline) and instead added validators in a parallel file (`py/business_rules.py`). The hand-walk gap is now seven, not six — the new business rule exists in Python only, with no TS-side mirror. ADR-shaped friction (codegen vs hand-walk) gets sharper at every adapter.

## Unexpected friction (not asked but found)

- **Python 3.12 `datetime.fromisoformat` silently truncates >=7-digit fractional seconds to 6.** This contradicts day-1 FINDINGS Q3 #2 directly. The implication is severe: a TS Source emitting microsecond-or-finer-precision timestamps round-trips through Python with the original byte form lost. Any naive idempotency-key scheme that hashes `created_at` would diverge between the TS-emitted form and the Python-re-emitted form. The TS regex `\.\d+` is the *fail-open* side of this asymmetry.
- **Python's stdout buffering is mode-dependent.** With `isatty()`-stdout it is line-buffered; with piped-stdout it is block-buffered. Without explicit `sys.stdout.flush()` after each line, the consumer can see all output arrive in a single chunk at process exit, defeating any "atom #1 succeeded so I can start downstream work" claim. The fix (`-u` flag or per-line flush) is one line, but it is not the default and silently degrades streaming semantics.
- **JSON.stringify omits `undefined` keys but Python `json.dumps` cannot emit `undefined`** (only `null` or absence). A round-trip that originated TS-side with `source_id: undefined` and is mutated Python-side will return as `source_id` *missing entirely* (Pydantic `extra="allow"` + `model_dump` drops the key). Day-1 noted this for `undefined`; spike #2 confirms it survives multi-atom streaming unchanged — there is no per-line "remember the original key set" mechanism.
- **Pydantic v2's `model_dump(mode="json")` re-orders nothing but re-spaces everything.** Stage-1 emit (TS `JSON.stringify`) produces `{"data":{...}}` with no spaces; stage-2 emit (Python `json.dumps`) produces `{"data": {...}}` with spaces after `:` and `,`. Functionally equivalent JSON, byte-different wire form. Hashing the wire form for idempotency keys would diverge between the two hops *even when no semantic change occurred*. Real adapters need either canonical JSON (RFC 8785) or a structural-hash scheme that ignores formatting.

## Recommendations for spike #3 (Cat IX continuation)

- **Probe `iter()` semantics + cancellation.** Spike #2 used a closed batch of 3 atoms; the v1 outline's Cat IX questions about long-running iteration (backpressure, partial reads, mid-iter abort via `signal`) remain unanswered. A spike where TS sends 100+ atoms over a slow stream and TS-side cancels mid-flight would surface whether Python honours pipe-close as a cancellation signal cleanly.
- **Try one alternative wire format.** Spike #2 confirmed that bare-stdio NDJSON's framing fragility is real (one stray `print()` breaks the contract). Worth one spike measuring whether JSON-RPC framing or length-prefixed JSON eliminates the class of failure or just trades it for another (e.g. partial-frame-on-EOF). Brief constraints prevented this in spike #2.
- **Codegen-from-single-source proof-of-concept.** The hand-walk gap (now 7 divergences across `ts/validate.ts` + `py/schema.py` + `py/business_rules.py`) is approaching responsible-engineering territory. A spike taking one schema (Zod or JSON Schema) and codegen'ing both sides would let brain compare the two paths concretely before any v1 ADR.
- **PipelineContext crossing.** Out of scope for spikes #1-#2; will need its own spike before any real Python-side Process can honour `signal.aborted` or attach to a `trace`. Likely needs a sidecar control channel (stderr? second pipe? unix socket?) — not just stdio.

## What this spike does NOT prove

- Nothing about **performance**: 3 atoms in one process spawn each side. Per-atom serialise/parse cost, daemon-vs-spawn-per-batch, and cold-start `uv run` tax remain unmeasured.
- Nothing about **bidirectional** RPC or **iter() back-pressure**: spike #2 is one-way pipe with closed input. Real cross-runtime needs `iter()` and cancellation (signal), which are spike #3 territory.
- Nothing about **alternative wire formats**: bare-stdio NDJSON only. Whether JSON-RPC framing, length-prefix, or unix-socket-delimited eliminates the framing fragility is untested.
- Nothing about **PipelineContext crossing**: `signal`, `trace`, `idempotencyKey`, `memory` were explicitly out of scope. A cancellation spike is a separate experiment.
