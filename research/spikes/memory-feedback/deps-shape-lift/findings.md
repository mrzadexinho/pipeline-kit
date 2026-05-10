# Cat V Spike #1 — `deps-shape-lift` Findings

> Spike: single-cell, single-run lift test of Cat VIII deps-shape default
> (`deps: { secrets }`) onto memory's R+W contract (`deps: { memory }`),
> using orchestr8 (npm direct import) as the empirical backend.
> Branch: `worktree-agent-a02ca67c534f48345`. Author: Executor — 2026-05-09.
> Companion to: `docs/research-outline-v1.md` § Category V (Memory / State /
> Feedback) Q5 (placement) only. Q1 / Q2 / Q3 / Q4 EXPLICITLY deferred.
> Status: spike output (NOT a notes file; brain synthesises a
> notes-v1-cat-V.md later, after additional spikes).
> Friction anchor: `F-MEMORY` — top-15 #4, 4 incompatible memory shapes.
> Comparison target: `docs/research-notes-v1-cat-VIII.md` ADR-v1-VIII-1.

## 1. SETUP

A single kit-shaped pipeline, single run:

- **Source<{key,value}>** emits 1 atom: `{key:'pk_atom_v_1',
  value:'hello-from-source'}`.
- **Process<{key,value}, {readBack,wroteAtomId,readAtomId}>** splits into
  2 internal atoms in one `apply()` invocation:
  - **atom-A:** `await deps.memory.write(composedKey, value)` →
    `Result<void, MemoryError>`.
  - **atom-B:** `await deps.memory.read(composedKey)` →
    `Result<string|null, MemoryError>`. Must observe atom-A's write.
- **Serve<{readBack}>** prints `readBack` to stdout.
- Atom payloads carry through the `Atom<T>` envelope (id / object /
  created_at / metadata / data) per kit conventions.
- `PipelineContext` carries only `run_id` + `signal` — secrets/memory
  NOT here, mirroring ADR-v1-VIII-1.

**Adapter wiring path used: orchestr8-mcp npm direct import (option (b)
per brief).** Reasoning:

- Option (a) MCP boundary calls (`mcp__orchestr8__memory_*`) are
  reachable only from the calling Claude tool runtime, not from a
  child `bun run spike.ts` process. Wrapping them in MemoryAdapter
  shape would have required either a hand-rolled MCP-stdio child
  process or an in-process call shim — both of which would put a wire
  layer between the spike and the adapter shape, contaminating the
  ergonomic measurement Cat V Q5 cares about.
- Option (b) is the cleanest empirical test of the Phase 0 finding
  "orchestr8 already kit-shaped". `orchestr8-mcp` exports
  `SQLiteBackend` from `./memory/index.js` with an `IMemoryBackend`
  interface (initialize / store / retrieve / query / update / delete /
  close). Wrapped behind a 2-verb `MemoryAdapter` in 18 LOC. The wrap
  is non-trivial enough to surface real friction (see §5).
- Option (c) Map fallback rejected — would have falsified the load-
  bearing Phase 0 claim by avoiding it.

**LOC count.** `spike.ts` — 305 lines total; ~150 LOC pure code (the rest
is the comment block at top + interface definitions + blank lines).
`package.json` — 12 lines. No README needed; run command is
`bun run spike.ts` from the spike directory.

**Run command + output.**

```
$ cd research/spikes/memory-feedback/deps-shape-lift && bun run spike.ts
### Cat V spike #1 — deps-shape-lift (single cell, single run) ###
[driver] orchestr8 SQLiteBackend (:memory:) wired as MemoryAdapter
[proc] atom-A WROTE key='spike-1-pk_atom_v_1' value='hello-from-source'
[proc] atom-B READ  key='spike-1-pk_atom_v_1' got='hello-from-source'
[serve] readBack='hello-from-source' (from atom-B observing atom-A's write)
[driver] atomsEmitted=1 observedReadBack=true
[driver] OK: R+W round-trip held in single run
```

Strict TS typecheck (`tsc --strict --types node`) is clean. No `any` in
spike code. All errors via `Result<T,E>`.

## 2. CALL-SITE SHAPE CARRYOVER

> Does `deps.memory.read/write` mirror `deps.secrets.resolve`?

Yes — at the iterator-call-site level the shape lifts cleanly:

```ts
// Cat VIII (read-only secrets):
const tokenResult = await deps.secrets.resolve('apify-token');
if (tokenResult.error !== null) return err(tokenResult.error);
const token = tokenResult.data;

// Cat V Day-1 (R+W memory):
const wResult = await deps.memory.write(composedKey, input.data.value);
if (wResult.error !== null) { yield err(wResult.error); return; }
const rResult = await deps.memory.read(composedKey);
if (rResult.error !== null) { yield err(rResult.error); return; }
const value = rResult.data; // string | null
```

The early-return-on-error shape, the `Result<T,E>` payload, and the
construction-site contract `createXProcess({ args, deps: { memory } })`
all transfer verbatim from Cat VIII variant B. **One verb count change
only:** Cat VIII has 1 verb (`resolve`); Cat V has 2 verbs (`read`,
`write`). The contract surface widens, but the deps-shape pattern
itself does not.

**No new friction surfaced** at the call site that wasn't already
present in Cat VIII spike #1 (variant B) and spike #6 (deps-shape leg-3).

## 3. R+W ASYMMETRY PROBE

> Does `write` returning `Result<void, _>` create deps-shape friction?

**No structural friction at deps-shape level.** Three observations:

1. **Generic propagation.** `Result<void, MemoryError>` and
   `Result<string|null, MemoryError>` share an identical error arm; the
   only difference is the success-arm payload type. The early-return
   block treats them identically (`if (r.error !== null) ...`). No
   discriminated-union widening; no friction at the construction-site
   contract.
2. **Idempotency observation.** Memory `write` is implicitly the kit's
   "mutating-side" verb at the same level Source-fan-out semantics treat
   `Serve.emit`. CLAUDE.md mandates idempotency keys on Serve adapters
   mutating external state — by lift, memory `write` SHOULD adopt the
   same convention. **Spike did NOT exercise this** (single-run, no
   retry); flagged as carry-forward. Day-1 cell uses the input atom's
   `id` as composite key (`${keyPrefix}-${input.data.key}`) which
   provides natural idempotency by construction, but the contract does
   not enforce it.
3. **Read returning `string | null`.** Mirrors `Map.get`-style "absent
   sentinel" rather than splitting into a third Result variant
   (`{ data: null, error: 'not_found' }`). Pragmatic at single-verb
   scale; spike found this matched orchestr8's own
   `retrieve(): Promise<MemoryEntry | undefined>` shape directly. The
   verbs disagree only on `null` vs `undefined`; trivial wrap. No call-
   site friction from the asymmetry.

**Verdict (§3):** asymmetry is real (write returns void, read returns
maybe-string) but does NOT propagate to the deps-shape contract. Both
verbs ride the same `deps.memory` reference, the same Result envelope,
the same MemoryError type.

## 4. ASYNC-FACTORY ERGONOMICS

> Does R+W change anything about Cat VIII's already-locked async factory?

**No new constraint.** The factory shape `await
createMemProcess({ args, deps: { memory } })` returns
`Promise<Result<Process<I,O>, MemoryError>>`, identical to Cat VIII spike
#3's factory return type and Cat VIII spike #6's `createApifySource`.

Three sub-observations:

1. **Day-1 process factory is sync-safe.** This spike's factory does not
   read memory at construction time — it captures `memory` and uses it
   inside `apply()`. Async-ness is preserved purely as a future-proofing
   for factory-time reads (e.g. a `bootstrap` lookup that pre-loads
   recent feedback into closure cache). This is the exact mirror of Cat
   VIII spike #3 §2 ("real ergonomic change but not a deal-breaker").
2. **No new factory-site friction from R+W.** Cat VIII's "factory
   resolve" pattern (read at construction-time → close over) does not
   have an obvious memory analogue at this stage. Memory factory-time
   reads would feel like "preload working set"; that's a Cat V Q1 (full
   verb-set) concern, not a deps-shape concern. Day-1 deferred.
3. **No re-entry trigger for Cat VIII variant A or C.** The async
   factory + adapter-dep pattern handles R+W out of the box; no shape
   in Cat VIII's locked decision was challenged. Variant B (deps) is
   strict-fit.

## 5. MCP/ORCHESTR8 BOUNDARY FRICTION

> Any new ergonomic pain not surfaced in mock-based Cat VIII spikes?

**Two new pain points; one enabler.** All three are real-backend
artefacts that mock-only Cat VIII spikes could not have surfaced.

### 5.1 Subpath import friction

`orchestr8-mcp`'s package.json does not publish `exports` map; the only
way to reach `SQLiteBackend` is via the deep subpath
`orchestr8-mcp/dist/memory/index.js`. This works under Bun + Node
(NodeNext resolution) but flags a v1 packaging concern: any kit
reference impl wrapping orchestr8 should pin the deep path or PR
orchestr8 to add an `exports` map. **Carry-forward.**

### 5.2 Backend lifecycle (close()) NOT in MemoryAdapter day-1

orchestr8's `IMemoryBackend` includes `initialize()` + `close()` —
proper resource lifecycle. The day-1 MemoryAdapter exposes only
`read/write`; the spike's adapter factory had to return a tuple
`{ memory, close }` to honour the underlying backend's lifetime
contract. Two structural questions raised (carry-forwards):

- Does `MemoryAdapter` need a `close()` verb on the contract
  (parallel to how some `SecretsResolver` wrappers might want
  `dispose()`), or does kit's Composer take ownership of adapter
  lifetimes via a separate `Disposable` interface?
- Does `initialize()` need a parallel call-site signal, or is async-
  factory-returns-Promise sufficient (current spike: sufficient)?

This is the single biggest signal that R+W lift is NOT a no-op of Cat
VIII's read-only contract. Resource-bearing memory implementations
(SQLite, vector indexes, network-backed stores) carry lifetime; pure
secrets resolvers typically don't. **Cross-cuts Cat VI (stage model
extension) — `close()` is plausibly a control-plane concern, not a
data-plane verb on MemoryAdapter.**

### 5.3 Embedding / vector concerns NOT surfaced day-1

orchestr8's `MemoryEntryInput` accepts an optional `embedding?:
number[]` and the backend supports semantic queries. The day-1 2-verb
adapter ignores both. The lift question (deps-shape) holds at this
narrow contract. **Q4 deferred:** pgvector composition would either (a)
widen MemoryAdapter's verb set (Q1) or (b) compose via an additional
adapter (e.g. `deps: { memory, embeddings }`). Both options are
deps-shape-compatible.

### 5.4 Enabler — Phase 0 finding empirically validated

**`SQLiteBackend.store/retrieve` map 1:1 onto kit's R+W verbs.** No type
gymnastics; no semantic mismatch. The wrap is 18 LOC including imports
and the close()-tuple plumbing. The Phase 0 claim "orchestr8 already
kit-shaped" survives empirical contact at the deps-shape level.

## 6. VERDICT

**PASS** — Cat VIII deps-shape default lifts to memory's R+W contract
unchanged at the deps-shape axis (§2-§4 evidence). Spike #1 is
defensible as a pass-through lift; no new structural friction at the
deps-shape level emerged.

**Justified by run output.** Atom-B observed atom-A's write
(`readBack='hello-from-source'`); single run; orchestr8 SQLiteBackend
boundary; Result<T,E> envelope clean both arms; no thrown errors; no
ctx.signal abort; observedReadBack=true; exit code 0.

**Caveat (axis-explicit):** verdict is at the deps-shape axis only (Q5
placement). Resource-lifecycle (§5.2 close/initialize) is NEW friction
relative to Cat VIII spike #1, but it is orthogonal to deps-shape — it
asks "what verbs does MemoryAdapter expose?" (Q1), not "where does the
adapter live?" (Q5). Carry-forward 1 names this explicitly.

**Next-spike scope** (Cat V outline § Q1-Q4 may now be probed independently):

- **Cross-run persistence + Q1 verb-set extension** (immediate next
  candidate). Does the lift hold when memory is written in run-1 and
  read in run-2 (real persistence vs `:memory:` ephemerality)? What
  verbs does run-2 need beyond `read/write`? (search? list? forget?)
- **Q3 EditableField feedback loop** (deferred-friendly). Does
  `wasEdited` flow back through `deps.memory` cleanly, or does it want
  a richer envelope (e.g. `{key, value, signals: {wasEdited: bool}}`)?
- **Q2 scoping unit** (deferred-friendly). `scope(prefix)` lift —
  parallels Cat VIII ADR-v1-VIII-4 — does it hold for memory at multi-
  pipeline scale?

## 7. CARRY-FORWARDS

Anchored to outline § Cat V Q1-Q5 (and flagged where they cross-cut
Cat VI / Cat I / Cat VIII).

1. **Resource lifecycle on MemoryAdapter** (Q5/Q1, cross-cuts Cat VI). Does
   the contract grow `close()` / `initialize()`, or does kit's Composer take
   ownership of adapter lifetimes via a separate `Disposable` interface?
   §5.2 is the load-bearing observation. Likely the sharpest day-2 question.
2. **Idempotency convention on `write`** (Q1, cross-cuts Cat I durable +
   Cat VIII ADR-v1-VIII-1). CLAUDE.md mandates idempotency keys on Serve
   adapters mutating external state. Memory writes are mutating; should
   the contract require an `idempotencyKey?` parameter, or is composite
   key sufficient by convention? §3.2.
3. **Cross-run persistence empirical probe** (Q1/Q5). `:memory:` is a
   single-run probe. Real lift question: does atom-B in run-2 observe
   atom-A's write from run-1 with the same MemoryAdapter contract? Spike
   #2 candidate.
4. **Subpath-import packaging concern** (Cat VIII ADR-v1-VIII-5 packs §3,
   cross-cuts packs roster). Wrapping orchestr8 cleanly requires either
   a deep subpath import or a PR to add `exports` map. Either way: any
   `@pipeline-kit/memory-orchestr8` reference adapter at v1 must
   document this. §5.1.
5. **Embedding / vector concerns at the verb-set boundary** (Q1/Q4, cross-
   cuts Cat VI). orchestr8 supports embeddings + semantic queries; day-
   1 MemoryAdapter ignores both. Decision: widen verbs (Q1) or compose
   adapters (`deps: { memory, embeddings }`). §5.3. Probably wants its
   own spike before Q1 ADR.
6. **EditableField feedback flow shape** (Q3). Spike did NOT exercise
   `wasEdited` back-propagation; outline names it as a Q3 must-answer.
   Probably wants a dedicated spike where Process emits an
   `EditableField<T>` and the next run's memory-read consults the
   delta.
7. **Composer-level retry interaction with R+W splits** (cross-cuts Cat
   I durable). If atom-A succeeds and atom-B fails, what's the retry
   semantics? Per atom (replay write)? Per process invocation
   (idempotent under composite key)? §3.2. Day-1 not exercised; carry.
8. **`memory` vs `memory[]` deps-shape-at-N** (Q4-equivalent, mirror of
   Cat VIII spike #6). At what N (multi-namespace? short+long-term
   split?) does the flat `deps: { memory }` grow into either
   `deps: { memory: { short, long } }` or `deps: { workingMemory,
   episodicMemory }`? Spike-#6-of-Cat-V candidate. Day-1 not exercised.

## 8. OPEN QUESTIONS (for brain — NOT decisions)

These surface as research questions, not ADR drafts. Brain adjudicates
in Cat V synthesis after additional spikes.

1. **Is `MemoryAdapter` semantically Serve-shaped (writes mutate
   external state) or Source-shaped (reads emit atoms) or both?** Phase
   0 catalog framed orchestr8 as "Source-like memory queries" but the
   spike empirically used it as a Process internal dependency (R+W
   inside `apply`). Three possible kit shapes: (a) MemoryAdapter as a
   Process dep (this spike); (b) MemoryAdapter as both a Source<T>
   factory AND a Serve<T> factory — no Process dep at all; (c)
   first-class `Memory<T>` stage type (Cat VI primitive question, mirror
   of Cat VIII variant C). Day-1 tested (a) only.
2. **Should the contract's `read` return `Result<string|null, _>` or
   `Result<string, MemoryNotFound | MemoryError>`?** The first
   matches `Map.get` ergonomics + orchestr8's `undefined` sentinel;
   the second matches Cat VIII's `secret_not_found` error envelope.
   Day-1 chose the first; brain should adjudicate at Q1 lock.
3. **Is `MemoryError`'s code taxonomy fixed at v1 ship or extensible?**
   Spike used 2 codes (`memory_unavailable` / `unknown`). Real
   backends (SQLite I/O, vector index, network) will surface more.
   Mirror Cat VIII's `secret_not_found` / `malformed_name` discipline?
4. **Does the deps-shape PASS verdict generalise across all 4 Phase-0
   memory shapes** (orchestr8, gatewerk, pursuit, cole-obsidian) or
   only orchestr8? Spike validates 1 of 4. Phase 0 names them as
   "incompatible memory shapes" — incompatibility may live at verb-
   set / scope / typing level, all of which are independent of
   deps-shape per this spike's evidence. Worth a multi-backend lift
   spike before Q1 lock.
5. **Is `keyPrefix` an args concern or a scope() concern?** Spike used
   `args.keyPrefix` to compose memory keys — same pattern as a flat
   secrets-name. A `memory.scope(prefix)` façade would mirror Cat VIII
   ADR-v1-VIII-4. Day-1 deferred (Q2). Brain may want the ADR-VIII-4
   shape to lift verbatim.
6. **Does `EditableField<T>` belong on `Atom<T>.metadata` or as a first-
   class atom payload variant?** Outline § Cat V Q3 names this; spike
   did not exercise it. The lift question is whether memory-write of
   `EditableField` payloads is structurally identical to memory-write
   of bare strings. Likely yes; needs spike.

## 9. STATUS

Throwaway code, single commit. No kit-core amendments. No v0 ADR
amendments. No ADR drafts in this file (per brief). Brain merges +
synthesises in next step after FINDINGS review. Cat V Q5 placement
direction (deps-shape lift survives) is defensible day-1; Q1 / Q2 / Q3
/ Q4 remain open per brief constraint.

*Author: Executor — 2026-05-09. Spike branch:
`worktree-agent-a02ca67c534f48345`. Master tip at spike start:
`88ec82e`. Adapter wiring path: orchestr8-mcp 0.1.0 npm direct import
(SQLiteBackend `:memory:`). Strict TS clean; Result<T,E> only; no `any`;
ESM; Bun-runnable.