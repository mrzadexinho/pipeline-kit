# Cat V Spike #3 — `cross-run-persistence-and-verb-set` Findings

> Spike: 2-cell structural probe — (a) does the spike-2 β contract
> survive the cross-run durability boundary (cell α — minimum verbs);
> (b) does `list` belong on `MemoryAdapter` core or on an opt-in
> `Listable` marker interface (cell β — verb growth).
> Cells: **α** (minimum-verbs-hold-across-runs) / **β** (verb-growth-forced).
> Branch: `v1-cat-V-spike-3-cross-run-persistence-and-verb-set`.
> Master tip at branch start: `55a3533` (post spike-1 rescue; post
> spike-2 ship `80ba230`; post spike-3 brief `20b42a1`).
> Author: Executor — 2026-05-09.
> Companion to: `docs/research-outline-v1.md` § Cat V Q1 (verb-set) +
> Q2 (scope). Answers spike #2 cf #1 (β-lean) at multi-run scale + cf
> #3 (cross-run) + cf #2 (idempotency).
> Friction anchor: `F-MEMORY` — top-15 #4.

## §1 — Setup

Two cells, identical orchestr8 wire path:

- **α (minimum-verbs)** — Run-1 writes 3 atoms; process exits. Run-2
  reads same composed keys; α.2 probes key-reuse (re-write existing
  key + re-read).
- **β (verb-growth)** — Run-1 writes 5 atoms in a namespace. Run-2
  Source emits ONLY namespace; Process enumerates via `list(ns)`.
  `list` exposed as opt-in `Listable` marker.

Disk backend wraps real-disk `SQLiteBackend({databasePath})` — NOT
`:memory:`. Backend is **sql.js** (orchestr8 ships sql.js, not
node:sqlite). `store()` autoSaves full DB to disk on every write
(`db.export()` → `fs.writeFileSync`). Durability = autoSave; `close()`
is just in-process handle release.

Kit-level adapter shape lifts spike-2 β verbatim:

```ts
interface MemoryAdapter { read; write; }    // CORE — 2 verbs
interface Disposable    { close; }          // OPT-IN spike-2 marker
interface Listable      { list(namespace); } // OPT-IN spike-3 marker
```

Disk adapter: `MemoryAdapter & Disposable & Listable`. Mock
SecretsResolver: NONE. Composer-side narrowing via `isDisposable`
+ `isListable` runtime guards.

**Process boundary:** 4 fresh `bun run` invocations, exits between
α-run-1 / α-run-2 / β-run-1 / β-run-2. `.spike-3-data/` wiped
between cells (separate DBs avoid α duplicate-row pollution leaking
into β enumeration).

### Run command
```
cd research/spikes/memory-feedback/cross-run-persistence-and-verb-set
bash run-spike-3.sh
```

### Observed run output (verbatim)

```
### Cat V spike #3 — cross-run-persistence-and-verb-set (2 cells, 4 runs) ###
--- cell α run-1 (writes 3 atoms; process exits) ---
### Cat V spike #3 — Cell α (minimum-verbs) phase=run-1 ###
[run-1 write] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_1' value='value-from-run-1-atom-1'
[run-1 write] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_2' value='value-from-run-1-atom-2'
[run-1 write] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_3' value='value-from-run-1-atom-3'
[run-1 dispose] disposables=1 closed-clean=true
[run-1 summary] writes=3 expected=3 db-path='./.spike-3-data/cell-alpha.sqlite'
--- cell α run-2 (separate process; reads same 3 keys; α.2 probe) ---
### Cat V spike #3 — Cell α (minimum-verbs) phase=run-2 ###
[run-2 read] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_1' got='value-from-run-1-atom-1' expected='value-from-run-1-atom-1' held=true
[run-2 read] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_2' got='value-from-run-1-atom-2' expected='value-from-run-1-atom-2' held=true
[run-2 read] key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_3' got='value-from-run-1-atom-3' expected='value-from-run-1-atom-3' held=true
[run-2 alpha.2 probe] re-writing key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_1' newValue='value-rewritten-in-run-2'
[run-2 alpha.2 result] write-error=none
[run-2 alpha.2 result] re-read-after-rewrite key='pk-spike-3-cat-v-cell-alpha::pk_atom_v_alpha_1' observed='value-from-run-1-atom-1' run1Value='value-from-run-1-atom-1'
[run-2 alpha.2 listable-probe] unique-keys-after-rewrite=3 firstKeyOccurrencesInList=1 (list dedupes; raw-row count would be more)
[run-2 dispose] disposables=1 closed-clean=true
[run-2 summary] reads=3 expected=3 roundtripsHeld=3 expected-held=3
--- cell β run-1 (writes 5 atoms in a namespace; process exits) ---
### Cat V spike #3 — Cell β (verb-growth) phase=run-1 ###
[run-1 sibling-cost] secrets-implements-Listable=false memory-implements-Listable=true
[run-1 write] key='extract-run-2026-05-09::atom-1' value='value-from-run-1-atom-1'
[run-1 write] key='extract-run-2026-05-09::atom-2' value='value-from-run-1-atom-2'
[run-1 write] key='extract-run-2026-05-09::atom-3' value='value-from-run-1-atom-3'
[run-1 write] key='extract-run-2026-05-09::atom-4' value='value-from-run-1-atom-4'
[run-1 write] key='extract-run-2026-05-09::atom-5' value='value-from-run-1-atom-5'
[run-1 dispose] disposables=1 closed-clean=true
[run-1 summary] writes=5 expected=5 db-path='./.spike-3-data/cell-beta.sqlite'
--- cell β run-2 (separate process; namespace-only Source; Listable enumeration) ---
### Cat V spike #3 — Cell β (verb-growth) phase=run-2 ###
[run-2 sibling-cost] secrets-implements-Listable=false memory-implements-Listable=true
[run-2 enum] strategy=listable keysFound=["extract-run-2026-05-09::atom-5","extract-run-2026-05-09::atom-4","extract-run-2026-05-09::atom-3","extract-run-2026-05-09::atom-2","extract-run-2026-05-09::atom-1"] atomsRead=5
[run-2 read] key='extract-run-2026-05-09::atom-5' got='value-from-run-1-atom-5'
[run-2 read] key='extract-run-2026-05-09::atom-4' got='value-from-run-1-atom-4'
[run-2 read] key='extract-run-2026-05-09::atom-3' got='value-from-run-1-atom-3'
[run-2 read] key='extract-run-2026-05-09::atom-2' got='value-from-run-1-atom-2'
[run-2 read] key='extract-run-2026-05-09::atom-1' got='value-from-run-1-atom-1'
[run-2 dispose] disposables=1 closed-clean=true
[run-2 summary] strategy=listable atomsRead=5 expected=5
--- summary ---
all 4 invocations exited 0; spike #3 complete
```

Strict TS typecheck `bunx tsc --noEmit -p tsconfig.json` clean. No
`any`. All errors via `Result<T, MemoryError>`; no thrown errors
across the public stage boundary.

### File LOC

| File | LOC | code-ish | Note |
|------|----:|---------:|------|
| `mock-orchestr8-disk-backend.ts` | 183 | ~150 | β contract + Listable + Disposable + factory + 2 type-guards |
| `mock-secrets-resolver.ts` | 65 | ~45 | lifted verbatim from spike #2 |
| `cell-alpha-minimum-verbs.ts` | 348 | 273 | within 500-hard; >300-soft (same band as spike-2) |
| `cell-beta-verb-growth.ts` | 370 | 290 | within 500-hard; >300-soft |
| `run-spike-3.sh` | 32 | — | sequential α-run-1 → α-run-2 → β-run-1 → β-run-2 |
| `package.json` / `tsconfig.json` | 21 / 15 | — | bun + strict ESNext bundler |
| `README.md` | 68 | — | run command + axis table |
| `.gitignore` | 1 | — | `.spike-3-data/` |

## §2 — Cell α deep dive

### α.1 Cross-run R+W round-trip
PASS. All 3 round-trips held; `roundtripsHeld=3 expected-held=3`.
The 2-verb contract + opt-in Disposable survives the durability
boundary unchanged. **Cf #3 RESOLVED:** no new core verb required;
`<namespace>::<atom-id>` written via `write` in run-1 reads back via
`read` in run-2 with value intact.

### α.2 Key-reuse semantics — HEADLINE FINDING

Run-2 attempted `memory.write(existingKey, newValue)`; observable:

- `write-error=none` (contract reports success).
- Re-read returns the **ORIGINAL** value, not the new value.
- `list()` returns 1 occurrence (Set-deduped).

Underlying mechanism (verified in `sqlite-backend.js` + `types.js`):

- `store()` does `INSERT INTO memory ...` with `id TEXT PRIMARY KEY`
  (id, NOT (key, namespace), is the row PK).
- `createMemoryEntry()` generates fresh `mem_<ts>_<rand6>` per call.
- Same `(key, namespace)` written N times → N rows with N distinct ids.
- `retrieve()` does `SELECT ... WHERE key=? AND namespace=? LIMIT 1`
  WITHOUT `ORDER BY` → SQLite returns physical-insertion-order →
  **OLDEST row wins**.
- `query({type:'prefix',namespace})` does `ORDER BY updated_at DESC`
  but our `list()` Set-dedupes.

**The 2-verb contract communicates NOTHING about this.** A naive
adapter author expects last-write-wins (the universal KV semantic);
orchestr8 silently does first-write-wins. Junior consumer would be
bitten hard.

Brief asked: does this force a 3rd verb / `idempotencyKey?` parameter
into the **core** contract? **No.** What it forces is a **contract-
level semantic specification**: "MemoryAdapter.write() MUST be
last-write-wins." Verb count doesn't grow; spec gets sharper. Same
shape Cat IX hit with NDJSON line semantics.

**Verdict: PASS for the contract; FAIL for the orchestr8 reference
adapter.** Cf #2 RESOLVED on contract axis (no parameter); ESCALATED
on the reference-adapter axis — orchestr8 adapter MUST wrap `store()`
to enforce last-write-wins (delete-then-store, or use update path
when matching `(key, namespace)` exists).

### α.3 Namespace / scope (Q2)

Spike used **two layers**: composed-key `<namespace>::<atom-id>` at
call site + `opts.namespace` threaded through factory. Both worked
cleanly. Adapter shape did NOT need a `scope()` method or namespace
argument on `read` / `write`. **Q2 verdict: composed-key convention
+ construction-time namespace argument is sufficient.** Mirrors Cat
VIII §6 verdict (flat default + scope() optional façade). No scope
primitive on `MemoryAdapter`; no namespace member on
`PipelineContext`.

### α.4 LOC + greppability

cell-α 348 LOC vs spike-2 cell-β 350 — essentially flat. α.2 logic
adds ~30 LOC; abort plumbing removed ~30 LOC (no abort axis in α).
Disk-adapter +10 LOC vs spike-2 (`opts.namespace` + `databasePath`).
`Disposable` greppable contract unchanged from spike-2; high signal.

### α.5 Disposable on disk-backed (vs `:memory:`)

`disposables=1 closed-clean=true` across both runs. Disposable
opt-in introspects identically to spike-2's `:memory:` adapter. **No
WAL / checkpoint timing observable** — orchestr8 is sql.js, NO WAL.
Durability is `db.export()` + `fs.writeFileSync()` per write;
`close()` is in-process release. The brief's α.5 axis is structurally
moot for orchestr8/sql.js — re-probe needed only if kit later swaps
to a node:sqlite-based reference adapter (cf #17).

**Verdict: PASS.** No new finding on the axis itself; sql.js
durability model surfaces as cf #14.

## §3 — Cell β deep dive

### β.1 Verb-growth signal — does Process naturally reach for `list`?

Run-2's Source emits ONLY the namespace; the 2-verb contract
genuinely cannot supply enumeration. Two strategies wired:

- **`listable`** (exercised) — `if (isListable(deps.memory))
  { deps.memory.list(ns) }`.
- **`cursor-file-workaround`** (wired, not exercised) — sentinel
  key written in run-1 contains list of atom-ids; read sentinel in
  run-2.

Cursor-file structural cost evaluation:
- Viable for small namespaces (~10 LOC).
- BUT: forces unspecified-convention cost (every adapter invents
  sentinel-key naming).
- BUT: requires keeping index synchronised on every write site.

Process code naturally reaches for `list(namespace) -> string[]`;
type signature maps cleanly. Cursor-file workaround is **not
cleaner**. **Verdict: `list` is genuinely required for multi-atom
cross-run enumeration.**

### β.2 Contract tier — core vs opt-in `Listable`

Adapter implements `MemoryAdapter & Disposable & Listable`
(intersection). Composer-side narrowing: `isListable(dep)` runtime
guard, parallel to spike-2 `isDisposable`.

Empirical:
- Call-site narrowing cost: ~5 LOC (single `if (isListable(...))`).
- `Listable` greppable: high-signal (only on enumerable backends).
- Sibling-cost: ZERO (β.3 below).

If `list` were on `MemoryAdapter` core, every adapter author would
implement `list()` — non-enumerable adapters (write-only stream
hypothetical) would stub `list() -> err(...)`, identical stub-cost
problem spike-2 cell-α surfaced.

**Verdict: opt-in `Listable` wins.** Same shape as spike-2 β
verdict for `Disposable`. Brief §2 modern-direction framing
"core 2-verb minimum + opt-in tier extensions via marker interfaces"
is empirically validated.

### β.3 Sibling-cost

`mock-secrets-resolver.ts` lifted verbatim from spike #2 (which
itself lifted from Cat VIII spike #1) — NO modifications. Run output
confirms `secrets-implements-Listable=false` in both run-1 + run-2.

Cf #11 taxonomy holds:
- **Adapter-type cost:** zero. SecretsResolver unchanged.
- **Composer-side cost:** ~5 LOC for `isListable` (paid once).
- **Factory-wiring cost:** zero.
- **Call-site cost:** zero (sites that don't use `list` never call).

**Verdict: cf #11 taxonomy CONFIRMED for verb-set additions.**

### β.4 LOC + greppability

construction-site delta vs spike-2 cell-β: ~+15 LOC (adapter `list`
impl ~12; `Listable` interface decl 1; `isListable` guard 1; type
intersection alias 1). `Listable` grep is high-signal mirroring
`Disposable`.

### β.5 Pattern lift

YES — spike-2 β shape generalises cleanly:

| Concern | Marker | Composer guard | Adapter cost |
|---|---|---|---|
| Lifecycle (spike-2) | `Disposable` | `isDisposable` + `disposeAll` | only on real-lifecycle backends |
| Verb-growth (spike-3) | `Listable` | `isListable` (no kit helper needed) | only on enumerable backends |

Same `'<verb>' in dep` introspection. Same intersection-type
adapter shape. Same zero-cost-to-frozen-siblings property.
**Pattern-lift CONFIRMED** — Cat V can ship a single ADR shape
("core 2-verb + opt-in markers; future extensions follow same
pattern") rather than per-extension hacks. Mirrors Cat VIII
ADR-VIII-2 (minimum core + opt-in version-aware-resolver wrapper).

## §4 — Cross-cuts & potential bump-outs

Brief flagged Cat I (idempotency-on-write — α.2) + Cat VI
(verb-tier-discovery — β.2).

### Cat I bump-out — NO

α.2 is a Cat V **contract specification** concern, NOT Cat I.
Cat I (durable execution / retry) is about partial-write
consistency under abort; α.2 is about full-write overwrite under
same-key reuse. Different question. Cat V Q1 ADR absorbs it as
sub-clause: "MemoryAdapter.write MUST be last-write-wins."

### Cat VI bump-out — NO

`'list' in dep` is checked at the cell-β CALL SITE (Cat V scope).
NO kit-level `discoverAllListables(deps)` helper exists or is
needed. `list` is per-adapter, not cross-adapter. Spike-2 §5's
discriminator (marker interface stays at adapter-tier *unless*
introspection generalises across all deps) holds. Cf #16 (verb-
tier-discovery convention) is RESOLVED at Cat V scope before opening.

Meaningfully different from spike-2's γ which DID push to Cat VI
(`DisposableRegistry` is inherently pipeline-lifetime). β-Listable
has no analogous pipeline-lifetime concern.

### Composite

Spike #3 triggers NO category bump-outs. Both candidates close
inside Cat V scope. Cleanest possible cross-cut outcome — Cat V
Q1 + Q2 synthesise into a single ADR cohort with no upstream
dependency.

## §5 — Verdict

**Cell α:** PASS. Cross-run R+W holds; α.2 surfaces semantic-spec
finding (last-write-wins must be contracted) without forcing 3rd
core verb; α.3 confirms Q2 namespace verdict; α.5 confirms
Disposable opt-in survives disk-backed boundary.

**Cell β:** PASS. `list` genuinely required; `Listable` opt-in
marker is structurally cleanest; pattern-lift β.5 CONFIRMED;
sibling-cost cf #11 CONFIRMED.

### Synthesis-readiness call

**Cat V synthesis is RUNNABLE.** Per brief §8 gate:
- Q5 RESOLVED (spike #1 PASS).
- Q1 lifecycle RESOLVED (spike #2 β-lean).
- Q1 verb-set RESOLVED (spike #3 cell β — core 2-verb + Listable
  opt-in).
- Q2 scope RESOLVED (spike #3 α.3).
- Q3 (feedback), Q4 (vector) — explicitly v1-deferred.

Empirical answers to brief §7:
1. **Q1 verb-set:** core 2-verb (read, write) + `Listable` opt-in
   marker. Future extensions same pattern.
2. **Q1 lifecycle:** spike-2 β-lean unchanged at multi-run scale.
3. **Q2 scope:** adapter construction-time argument + composed-key
   call-site convention. NOT on `MemoryAdapter`. NOT on
   `PipelineContext`.
4. **cf #2 idempotency:** RESOLVED on contract (last-write-wins
   spec). ESCALATED on reference-adapter (orchestr8 wrap needed).
5. **cf #3 cross-run:** RESOLVED empirically.
6. **cf #11 sibling-cost:** CONFIRMED for verb-set.
7. **New cf:** #14 (sql.js durability), #15 (LWW enforcement at
   wrap), #16 (verb-tier-discovery — RESOLVED-before-opening),
   #17 (α.5 moot until backend swap), #18 (namespace propagation
   in Composer).

Brain may now run Cat V synthesis after standard one-gap session
discipline.

## §6 — Carry-forwards

Anchored to outline § Cat V Q1 + Q2 + cross-cut tags. Numbering
continues from spike-2 cf #13.

1. **(spike-2 cf #1 — REFINED)** Resource lifecycle on
   `MemoryAdapter` — β-lean (separate `Disposable` opt-in)
   CONFIRMED at multi-run scale; cross-run boundary doesn't change
   the verdict. Promoted from "tentatively locked" to "locked
   pending Cat V synthesis".
2. **(spike-2 cf #2 — REFINED)** Idempotency convention on `write`
   — RESOLVED on contract axis (last-write-wins is the spec;
   no parameter). ESCALATED as reference-adapter wrap concern:
   orchestr8 `store()` does INSERT not INSERT OR REPLACE; kit's
   orchestr8 adapter must wrap. ADR sub-clause material.
3. **(spike-2 cf #3 — RESOLVED)** Cross-run persistence —
   empirically PASS. No new verb. Marked resolved.
4. **(spike-2 cf #11 — CONFIRMED)** Sibling-adapter cost taxonomy —
   3-cell shape (adapter-type / Composer / factory-wiring) holds
   for verb-set additions identically to lifecycle.
5. **NEW cf #14 — sql.js durability model.** orchestr8's
   `SQLiteBackend` is sql.js, not real SQLite. autoSave does
   `db.export() + fs.writeFileSync` on every write — entire DB
   re-serialised. Fine <1k entries; degrades linearly at >10k.
   Reference-adapter spec note: orchestr8 best-suited for small
   KV namespaces; consider node:sqlite-based for >10k workloads.
   Anchor for M2 perf eval.
6. **NEW cf #15 — last-write-wins enforcement at adapter wrap.**
   orchestr8 reference adapter must wrap `store()` to be
   `delete(by-key-namespace) + store()`, OR use orchestr8 `query` +
   `update` flow when matching `(key, namespace)` exists. Capture
   in Cat V ADR adapter-spec sub-section.
7. **NEW cf #16 — verb-tier-discovery convention.** Verb growth
   beyond `read`/`write` follows marker-interface pattern
   (`Listable`, future `Searchable`, `Forgettable`, `Updatable`,
   etc.). Each marker its own opt-in interface; runtime
   introspection at call site narrows. NO kit-level "discover all
   verbs" registry. Confirmed in-Cat-V scope (no Cat VI bump-out).
   ADR sub-clause material.
8. **NEW cf #17 — α.5 axis moot until backend swap.** "WAL/checkpoint
   timing on close" axis is moot for sql.js (no WAL). Re-probe
   if/when kit gains a node:sqlite or better-sqlite3 reference
   adapter.
9. **NEW cf #18 — namespace propagation through Composer.**
   Spike-3 threads `namespace` through factory opts. At Composer
   scale (multiple stages, multiple adapters), how does namespace
   propagate? Manually per factory, or from kit-level
   `pipelineId` / `stageId`? Cat V ADR for namespace primitive
   needs to specify propagation, not just shape. Anchor for
   spike #4 candidate or Composer-API ADR.

## §7 — Open questions (research, not decisions)

- **Q-O-1.** TC39 alignment for `Listable`? `Symbol.dispose` /
  explicit-resource-management is spike-2 territory; `Symbol.iterator`
  is async-iterator territory (different shape). Likely: `Listable`
  is fine kit-local; no TC39 protocol fits.
- **Q-O-2.** Call-site narrowing cost at N adapters × M markers?
  Spike didn't probe. Likely TS-perf concern at scale; not runtime.
- **Q-O-3.** `list(namespace)` vs `list({ namespace, prefix?, limit?,
  offset? })`? Spike took minimum. Pagination real for >1k keys;
  v1.x candidate.
- **Q-O-4.** Return type — `string[]` vs
  `Array<{ key, updatedAt }>`? Spike strips to `string[]`; callers
  lose recency info. v1.x candidate.
- **Q-O-5.** α.2 first-write-wins silently — would a junior author
  unit-test "same-key re-write" PASS the contract assertion (write
  returned ok) yet observe wrong data? Defensive-design axis,
  parallel to spike-2 Q-O-5.

## §8 — Status

- **Throwaway spike code.** This commit is the spike-3 ship commit.
- **No kit-core amendments.** No edits outside spike directory.
- **No v0 / v1 ADR amendments.**
- **Branch:** `v1-cat-V-spike-3-cross-run-persistence-and-verb-set`.
- **Branch parent:** `55a3533` (worktree HEAD on entry was `2caf05e`;
  FF'd to `55a3533` before branch creation per brief §5).
- **Worktree path:**
  `/Users/zadexinho/Claude-Workspace/pipeline-kit/.claude/worktrees/agent-a493e2daec730aa07`.
- **Run command:**
```
cd research/spikes/memory-feedback/cross-run-persistence-and-verb-set
bash run-spike-3.sh
```
- **Strict typecheck:** `bunx tsc --noEmit -p tsconfig.json` exits 0.
- **All 4 invocations exit 0.**

End findings.
