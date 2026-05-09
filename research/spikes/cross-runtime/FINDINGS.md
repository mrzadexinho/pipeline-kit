# Cat IX Spike #1 — Day 1 Findings

> Spike: single-atom cross-runtime round-trip via stdio JSON.
> Branch: v1-spike-cat-ix-day-1.  Author: Executor — 2026-05-08.
> Companion to: docs/research-outline-v1.md § Category IX.
> Status: spike output (NOT a notes file; brain synthesises notes-v1-cat-IX.md later).

## What was built

A 3-stage stdio pipe: `node ts/atom-emit.ts` produces one `Atom<Job>` wrapped
in `Result<Atom[], Err>` JSON; `uv run python3 py/process_atom.py` reads it,
validates against a hand-written Pydantic v2 model, mutates one field
(`data.title` → uppercase) plus stamps a metadata trace, and re-emits the
same Result envelope; `node ts/result-validate.ts` reads the round-tripped
JSON, validates against the hand-rolled TS validator (zod was unresolvable
from repo root), and exits 0 on success. No imports from `@idriszade/*`.
No new deps in root `package.json`. Pydantic pulled via `uv run --with`.

## How to reproduce

```bash
bash research/spikes/cross-runtime/run.sh
```

## Captured run output

```
==> [1/3] TS emits Atom<Job> wrapped in Result
==> [2/3] Python validates + mutates (title -> UPPER) + re-emits
==> [3/3] TS validates round-tripped Result

result-validate: OK — 1 atom(s) validated round-trip
  - pk_atom_06F0KCRQZCKXEK65RZXRDN7BAF  title="SENIOR BACKEND ENGINEER"

==> spike OK: round-trip succeeded
```

Stage 1 emit (TS → wire), salient fragment:

```json
{"data":[{"id":"pk_atom_06F0KCRQZCKXEK65RZXRDN7BAF","object":"atom","created_at":"2026-05-08T22:26:32.571Z","metadata":{"spike":"cat-ix-day-1","emitter":"ts/atom-emit.ts"},"data":{"title":"Senior Backend Engineer","company":"Acme Corp","location":"Remote (EU)","posted_at":"2026-05-01T09:00:00.000Z","salary_min":120000,"salary_max":160000,"remote":"remote","tags":["typescript","distributed-systems","kafka"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_06F0KCRQZGAPF02KKYVTG594ND"}],"error":null}
```

Stage 2 (Python → wire), same atom after mutation:

```json
{"data":[{"id":"pk_atom_06F0KCRQZCKXEK65RZXRDN7BAF","object":"atom","created_at":"2026-05-08T22:26:32.571Z","metadata":{"spike":"cat-ix-day-1","emitter":"ts/atom-emit.ts","py_hop":"process_atom.py"},"data":{"title":"SENIOR BACKEND ENGINEER","company":"Acme Corp","location":"Remote (EU)","posted_at":"2026-05-01T09:00:00.000Z","salary_min":120000,"salary_max":160000,"remote":"remote","tags":["typescript","distributed-systems","kafka"]},"source_id":"pk_src_spike_emitter","run_id":"pk_run_06F0KCRQZGAPF02KKYVTG594ND"}],"error":null}
```

ID and `created_at` are byte-identical between stages 1 and 2. `data.title`
flips case. `metadata.py_hop` is added. `salary_*` integers preserved exactly.
Final TS validator accepts the result.

## Friction surfaced (per outline question)

### Q1 — Does Result<T,E> survive JSON?

**Yes, with caveats.** The `{data, error}` discriminated union round-trips
cleanly in both directions because both members are first-class JSON values
(arrays + null on the OK branch). The ADR4 shape is structural — there is
no class identity to lose. **However**, the discriminant is a *convention,
not a tag*: the wire format does not encode "this is a Result"; both sides
must independently agree to inspect `error == null`. Stage 2 (Python)
re-asserts the contract by hand: `if payload["error"] is not None: return 5`
(see `py/process_atom.py` lines 32–34). A typo there silently turns errors
into successes. **Friction:** no self-describing tag (e.g. `"object":
"result"` like Stripe envelopes carry) → every cross-runtime hop reimplements
the discriminator check.

### Q2 — Does Atom<T> envelope round-trip?

**Yes, and Atom *does* carry `"object": "atom"` as a tag**, which is the
saving grace — Pydantic's `Literal["atom"]` validator catches a wrong/missing
tag at the boundary (`py/schema.py:Atom.object`). **Friction observed:**
optional fields (`source_id`, `stage_id`, `run_id`) silently drop on the TS
side because `JSON.stringify` omits keys whose value is `undefined`. Verified:

```js
JSON.stringify({ id: 'pk_atom_X', object: 'atom', source_id: undefined })
// => '{"id":"pk_atom_X","object":"atom"}'   // source_id gone, no error
```

The Python side accepts the absence (Pydantic `extra="allow"`), but if
**brain wants strict provenance** (every atom MUST carry source_id once a
pipeline assigns one), the TS Source must emit `null` explicitly, not
`undefined`. ADR-shaped question for later; not resolving here.

### Q3 — Is Zod ↔ Pydantic hand-walkable, or does codegen become required?

**Hand-walkable for *this* size, but the divergence count grows
super-linearly.** Counting concrete gaps between `ts/validate.ts` (49 LOC of
hand-rolled checks) and `py/schema.py` (84 LOC of Pydantic):

1. **ID regex duplicated verbatim** — TS: `/^pk_atom_[A-Z0-9]{26}$/` (validate.ts:13);
   Python: `re.compile(r"^pk_atom_[A-Z0-9]{26}$")` (schema.py:13). One
   character drift would silently pass on one side, fail on the other.
2. **ISO 8601 regex vs. parser** — TS uses a regex (validate.ts:14); Python
   uses `datetime.fromisoformat` (schema.py:18) with a Z-suffix
   normalisation hack. **The two are not equivalent**: the TS regex permits
   formats Python rejects (e.g. `2026-05-08T12:34:56.1234567Z` — 7-digit
   fraction passes the TS regex but Python's fromisoformat tolerates only
   3 or 6). Nobody noticed because the spike data uses the safe overlap.
3. **Enum literal duplication** — `'remote'|'hybrid'|'onsite'|'unknown'`
   appears twice (validate.ts:15 and schema.py:14). Single point of failure.
4. **Length bounds duplicated** — `min_length=1, max_length=200` (Pydantic)
   vs. inline `length < 1 || length > 200` (TS). Order matters; trim
   semantics differ.
5. **`extra="forbid"` vs. `extra="allow"`** — `Job` rejects unknown keys;
   `Atom` allows them (for optional `source_id` etc.). The TS validator
   doesn't model "extra"-key behaviour at all — extras silently pass.
   Asymmetry waiting to bite.
6. **Integer vs. number** — schema says "int"; Pydantic enforces (`int |
   None`); TS hand-roll has to call `Number.isInteger()` separately
   (validate.ts:42). Zod has `.int()` so production code wouldn't have this
   gap, but the gap *exists in this spike's hand-rolled validator*.

**Verdict for v1:** at *this* schema size (1 envelope + 1 payload, 8 fields)
hand-walking is achievable but already loaded with silent-divergence risk.
For real adapters (15+ in M0.5) it stops being responsible.
Codegen-from-single-source (likely Zod or JSON Schema → Pydantic) becomes a
strong v1 candidate. **Brain decides; spike does not propose ADRs.**

### Q4 — Are pk_atom_ ID conventions preserved?

**Yes, perfectly.** `pk_atom_06F0KCRQZCKXEK65RZXRDN7BAF` appears
byte-identical in stages 1, 2, and the final validator. ULIDs are
ASCII-safe; no escape interaction with JSON. `pk_run_…` likewise survives.
No friction. The only risk vector is *generation* (the TS spike rolls a
fake ULID; a real impl might use a Python ULID library that disagrees on
Crockford-32 rules — but that's beyond a single-atom echo test).

### Q5 — Is timestamp format locked anywhere?

**Implicitly, not formally.** TS emits `new Date().toISOString()` which is
locked to `YYYY-MM-DDTHH:mm:ss.sssZ` (3-digit fraction, Z suffix, UTC).
Python's `_parse_iso` (schema.py:18) accepts that and re-emits via
`model_dump(mode="json")` which preserves the string verbatim (Pydantic
treats it as `str`, not `datetime`, in this spike). **The format is locked
*by accident*** — both sides happen to agree. A real Source emitting
`+00:00` instead of `Z`, or fractional precision other than milliseconds,
would pass TS validation (regex permits both) but the *byte equality*
between hops would break, defeating any naive idempotency-key scheme that
hashes the wire form. **Friction:** spec-api-surface.md line 89 says
`created_at: string` with no format constraint. ADR-shaped gap; flagging,
not deciding.

## Unexpected friction (not asked but found)

- **JS Number precision vs. Python int**: tested with
  `salary_min: 9007199254740993` (`2**53 + 1`). Python `json.loads` reads it
  as `9007199254740993` exactly and re-emits it verbatim. **Node's
  `JSON.parse` silently truncates to `9007199254740992`** with no error.
  Round-tripping a Python-generated int through TS *cannot* be lossless for
  values above `Number.MAX_SAFE_INTEGER`. The schema says "int" with no
  upper bound. Salary fields in this spike are safe; latency-ns counters or
  byte counts would not be. Real-world risk for any cross-runtime metric
  Source.
- **`undefined` vs `null` semantics**: `JSON.stringify` drops keys with
  `undefined` values entirely; Pydantic with `extra="allow"` accepts the
  absence. So an Atom that *had* a `source_id: undefined` on the TS side
  arrives at Python with the key missing — distinguishable from "explicitly
  null" only if the consumer cares. ADR4-adjacent: pipeline-kit needs a
  convention here (always emit `null`, never `undefined`?).
- **Pydantic v2 `model_dump(mode="json")` is opinionated**: it re-orders
  nothing (Python dict preserves insertion order ≥ 3.7), but it *would*
  coerce `datetime` → ISO if the field were typed as `datetime`. We kept
  `created_at: str` to avoid that coercion mid-hop, which side-steps the
  format-drift risk noted in Q5 but only by *not validating semantics on
  the wire*. Real adapters will face the trade.
- **Hook environment friction**: a session hook rewrites `python3` to
  `uv run python3`, which means `run.sh` must invoke Python via `uv run
  --with` *anyway* for dependency resolution. Coincidentally aligned for
  the spike. For a future Python-side daemon (long-lived process, not pipe),
  the `uv run` cold-start cost becomes a per-process tax worth measuring.

## Recommendations for spike #2 (Cat IX continuation)

- **Test multi-atom + streaming**: the single-atom path hides any
  newline-delimited-JSON (NDJSON) framing decisions. Spike #2 should pipe N
  atoms and surface whether `iter()` semantics survive (backpressure,
  partial reads, mid-stream errors).
- **Inject a deliberate schema-drift case**: emit an atom that satisfies
  TS validation but breaks Python (e.g. 7-digit fractional timestamp, see
  Q3 #2). Document whether the Process stage fails fast or silently
  half-validates.
- **Probe error-branch round-trip**: this spike only exercised the OK
  branch. Have Python *return* `Result.err({type, code, message})` and
  confirm TS sink distinguishes pipeline error from infra error.
- **Try one alternative wire format** (e.g. JSON-RPC framing, or
  length-prefixed JSON) to see whether stdio-bare-JSON's framing fragility
  (one stray `console.log` in TS would corrupt the pipe) is a deal-breaker.

## What this spike does NOT prove

- Nothing about **bidirectional** RPC — this is a one-way pipe with one
  Process hop. Real cross-runtime needs `iter()` and possibly callbacks.
- Nothing about **performance**: one atom, one process spawn each side.
  Hot-path cost (per-atom serialise/parse, daemon vs. spawn-per-batch)
  unmeasured.
- Nothing about **PipelineContext crossing the wire**: `signal`, `trace`,
  `idempotencyKey`, `memory` were explicitly out of scope. A real Python
  Process that needs to honour `signal.aborted` mid-batch is a separate
  spike.
