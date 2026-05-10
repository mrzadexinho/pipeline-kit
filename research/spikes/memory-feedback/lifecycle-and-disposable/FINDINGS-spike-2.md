# Cat V Spike #2 — `lifecycle-and-disposable` Findings

> Spike: 3-cell structural comparison of where adapter lifecycle
> (`close()` / `initialize()`) lives in pipeline-kit's type system,
> against orchestr8's real `SQLiteBackend(:memory:)` boundary.
> Cells: **α** (close on contract) / **β** (Disposable opt-in) /
> **γ** (Composer-owned lifetime via DisposableRegistry).
> Branch: `v1-cat-V-spike-2-lifecycle-and-disposable`.
> Master tip at branch start: `85e78c2` (per README) / observed at run
> time: `2caf05e` (post-reconcile parent state — both clean).
> Author: Executor — 2026-05-09.
> Companion to: `docs/research-outline-v1.md` § Category V Q1
> (verb-set + lifecycle); answers spike #1's carry-fwd #1
> ("Likely the sharpest day-2 question") + axis-only of Q5.
> Status: spike output (NOT a notes file; brain synthesises a
> notes-v1-cat-V.md after spikes #1-#N close).
> Friction anchor: `F-MEMORY` — top-15 #4.

## §1 — Setup

Three cells, identical pipeline shape, identical orchestr8 wrap:

- **Source<{key,value}>** emits 1 atom.
- **Process<{key,value}, {readBack}>** internally splits into 2 atoms in
  one `apply()`: atom-A `deps.memory.write(key, value)`; atom-B
  `deps.memory.read(key)` after a touch on `deps.secrets.resolve(...)`
  to exercise the lifecycle-free sibling.
- **Serve<{readBack}>** prints the read-back to stdout.
- **Atom envelope** = id / object / created_at / metadata / data
  (kit conventions; mirrors Cat IX framing).
- **`PipelineContext`** carries `run_id` + `signal` only (ADR-v1-VIII-1
  discipline; secrets/memory NOT here).
- **All stage outputs** wrapped in local `Result<T, MemoryError>`.

The same `mock-orchestr8-backend.ts` (39 LOC) wraps `SQLiteBackend(:memory:)`
behind a 3-method `RawBackend { read, write, close }`. Cells differ
ONLY in how the kit-level adapter shape exposes (or hides) `close()`:

| Cell | Adapter contract surface | Lifecycle ownership |
|------|--------------------------|---------------------|
| α    | `{ read, write, close }` (3 verbs) | adapter (every author writes close, even no-ops) |
| β    | `{ read, write }` + separate `Disposable` interface (opt-in) | adapter author opts in; Composer introspects via `'close' in dep` |
| γ    | `{ read, write }` (2 verbs, ever) | Composer owns; factory registers teardown thunk into `DisposableRegistry` at construction |

Two scenarios per cell — happy path, and `controller.abort()` fired
*before* the write so the `Promise.race` between the write and a
signal-wait deterministically resolves on the abort branch (per brief
axis-2 simulation guidance: orchestr8 in-memory SQLite has an
effectively-zero timing window for a real mid-write abort).

### Run command

```
cd research/spikes/memory-feedback/lifecycle-and-disposable
bash run-spike-2.sh
```

### Observed run output (verbatim, all 3 cells, both scenarios)

```
### Cat V spike #2 — lifecycle-and-disposable (3 cells, sequential) ###
--- cell α ---
### Cat V spike #2 — Cell α (close on contract) ###
[serve] readBack='hello-from-source-alpha'
[clean-close] cell=alpha scenario=happy closed=true
[abort-branch] cell=alpha scenario=happy close-called=true boundary=pipeline
[clean-close] cell=alpha scenario=abort closed=true errorCode=aborted
[abort-branch] cell=alpha scenario=abort close-called=true boundary=pipeline
[sibling-cost] cell=alpha stub-close-required=true introspection-required=false
[loc] cell=alpha construction-site-loc-delta=12 grep-pattern='close: '
[async-factory] cell=alpha compatible=true note='close is just another async method on the adapter shape; no factory-shape change'
[driver] OK cell=alpha
--- cell β ---
### Cat V spike #2 — Cell β (Disposable opt-in) ###
[serve] readBack='hello-from-source-beta'
[clean-close] cell=beta scenario=happy closed=true introspected-disposables=1
[abort-branch] cell=beta scenario=happy close-called=true boundary=pipeline
[clean-close] cell=beta scenario=abort closed=true errorCode=aborted introspected-disposables=1
[abort-branch] cell=beta scenario=abort close-called=true boundary=pipeline
[sibling-cost] cell=beta stub-close-required=false introspection-required=true
[loc] cell=beta construction-site-loc-delta=4 grep-pattern='implements Disposable'
[async-factory] cell=beta compatible=true note='factory returns MemoryAdapter & Disposable; intersection cost-free at call-site'
[driver] OK cell=beta
--- cell γ ---
### Cat V spike #2 — Cell γ (Composer-owned lifetime) ###
[serve] readBack='hello-from-source-gamma'
[clean-close] cell=gamma scenario=happy closed=true registered-at-construction=1
[abort-branch] cell=gamma scenario=happy close-called=true boundary=pipeline
[clean-close] cell=gamma scenario=abort closed=true errorCode=aborted registered-at-construction=1
[abort-branch] cell=gamma scenario=abort close-called=true boundary=pipeline
[sibling-cost] cell=gamma stub-close-required=false introspection-required=false note='cost lives on factory-wiring, not adapter-type'
[loc] cell=gamma construction-site-loc-delta=2 grep-pattern='registry.register'
[async-factory] cell=gamma compatible=true note='registry.register is sync inside async factory body; ADR-v1-VIII-1 shape preserved with +1 opts field'
[driver] OK cell=gamma
--- summary ---
all 3 cells exited 0; spike #2 complete
```

Strict TS typecheck (`bunx tsc --noEmit -p tsconfig.json`) is clean. No
`any` in spike code. All errors via `Result<T,E>`. No thrown errors
cross the public stage boundary; throws live only inside `try/catch` in
the backend adapter and the registry teardown loop.

### File LOC

| File | LOC | code-ish | Note |
|------|----:|---------:|------|
| `mock-orchestr8-backend.ts` | 39 | ~30 | shared backend wrap |
| `mock-secrets-resolver.ts`  | 64 | ~45 | lifted verbatim from Cat VIII spike #1 |
| `cell-alpha-close-on-contract.ts`     | 343 | 268 | within 300-soft (code-ish), under 500-hard |
| `cell-beta-disposable-opt-in.ts`      | 350 | 280 | within 300-soft, under 500-hard |
| `cell-gamma-composer-owned-lifetime.ts` | 380 | 297 | within 300-soft, under 500-hard |
| `run-spike-2.sh` | 15 | — | sequential α→β→γ |
| `package.json` | 20 | — | bun-installed (`bun install --no-save`) |
| `tsconfig.json` | 15 | — | strict + noUncheckedIndexedAccess |

## §2 — Cell α deep dive (`close()` on the contract)

### α.1 Axis #1 — Clean close

`SQLiteBackend.close()` returned cleanly in BOTH scenarios. Process exit
code 0. No orphan-handle warnings from Node. Verdict: PASS.

### α.2 Axis #2 — Mid-run abort behaviour

Abort fired before the write microtask resolved; `Promise.race` between
the write-promise and the abort-listener-promise resolved on the abort
arm with `errorCode=aborted`. The driver's pipeline-level `try/finally`
called `memory.close()` regardless of error path. Boundary: **pipeline**
(not atom-level, not process-level). Verdict: PASS.

NB: orchestr8's `:memory:` SQLite write is effectively synchronous — the
*physical* write may have completed before the race resolved. The spike
axis is structural ("does the kit-shape provide a clean place for close
to live"), not a fault-injection axis ("does the backend roll back
partial writes"). The abort signal is the kit's contract boundary, not
the backend's. Brief explicitly accepts this simulation.

### α.3 Axis #3 — Sibling-adapter composition

α IMPOSES verb-cost on the lifecycle-free sibling. The mock
SecretsResolver had to gain a `closableMockSecrets` wrapper with a stub
`async close() { return ok(undefined); }`. Three structural pains:

- **Discoverability inversion.** The 3-verb contract no longer
  communicates "real lifecycle here" — every adapter has it, so its
  presence carries no signal.
- **Correctness drift over time.** A future maintainer modifying the
  stub `close()` to do something accidentally non-trivial (logging,
  telemetry, metric emission) would violate the lifecycle-free
  invariant of the secrets resolver silently.
- **Verb-cost fan-out at scale.** Cat VIII's locked 3-ref-adapter trio
  (env / sops / oidc — see VIII-3 ADR) all become 2-verb under α
  (`resolve` + stub `close`). At N=15 reference adapters this is 15
  stub `close()` declarations.

Verdict: stub-close-required=**true**, introspection-required=false.
This is α's empirical cost — observed in the run output as "alpha
cell forced ClosableSecretsResolver wrapper" at adapter-author time.

### α.4 Axis #4 — LOC + greppability

`construction-site-loc-delta` ≈ +12 vs spike #1 baseline: +1 verb on
`MemoryAdapter` interface (1 line) + ~4-line `close()` impl on the
orchestr8 adapter + ~5-line stub on `closableMockSecrets` + 1
finally-block close call at driver. Greppable contract: `close: ` (the
property literal) — **noisy** because every adapter has it, including
no-ops. Greppability technically present but effectively zero
signal-to-noise.

### α.5 Axis #5 — Async-factory composition

Compatible=true. `close()` is just another async method on the adapter
object; the factory shape `Promise<Result<MemoryAdapter, _>>` is
unchanged from Cat VIII ADR-v1-VIII-1. No new factory-time ergonomic
primitive. Verdict: trivially compatible.

## §3 — Cell β deep dive (`Disposable` opt-in)

### β.1 Axis #1 — Clean close

PASS. SQLite closed cleanly in both scenarios. Composer-side
`disposeAll()` loop drove the call inside the pipeline-level finally.

### β.2 Axis #2 — Mid-run abort behaviour

PASS. Same pipeline-level boundary as α; the adapter's intersection
type (`MemoryAdapter & Disposable`) is what the `isDisposable` runtime
guard finds. Composer's `disposeAll(deps)` walks the deps array, calls
`close()` on whichever opted in. Lifecycle-free secrets resolver is
silently skipped (its `close` slot is undefined; type-guard returns
false).

### β.3 Axis #3 — Sibling-adapter composition

β IMPOSES NOTHING on the lifecycle-free sibling. Mock SecretsResolver
is consumed verbatim from Cat VIII spike #1 — no wrapper, no stub. The
introspection cost is paid ONCE by Composer code (`isDisposable` +
`disposeAll` loop, ~10 LOC kit-side, never duplicated). Run output
confirms `introspected-disposables=1` (the orchestr8 adapter only).

This is β's structural win: discoverability is *positive* (the
presence of `Disposable` on a type means "this adapter has real
lifecycle") and the lifecycle-free deps stay pristine. A reviewer
grepping `implements Disposable` (or the structural variant
`Disposable` in a return type) gets a clean inventory of which
backends actually own resources. The mock secrets resolver does not
appear in that grep, which is correct.

Verdict: stub-close-required=false, introspection-required=**true**.

### β.4 Axis #4 — LOC + greppability

`construction-site-loc-delta` ≈ +4 vs spike #1: +1 type alias
`OrchestrAdapter = MemoryAdapter & Disposable` + +3 LOC for the
adapter impl's `close()` (only on backends that need it). Greppable
contract: `Disposable` (interface name) — **high signal**: appears
only on real-lifecycle backends. Composer-side has a +10 LOC fixed
cost (`isDisposable` + `disposeAll`); pay-once.

### β.5 Axis #5 — Async-factory composition

Compatible=true. The adapter factory returns
`Promise<Result<MemoryAdapter & Disposable, _>>` which structurally
collapses to `Promise<Result<MemoryAdapter, _>>` at call sites that
don't care. Cat VIII ADR-v1-VIII-1 shape preserved. No new opts field
required. Verdict: cleanest of the three on this axis.

## §4 — Cell γ deep dive (Composer-owned lifetime, `DisposableRegistry`)

### γ.1 Axis #1 — Clean close

PASS. `registry.disposeAll()` (LIFO) walked the single registered
teardown thunk (orchestr8's `raw.close`) and resolved cleanly. Process
exit 0. Run output: `registered-at-construction=1`.

### γ.2 Axis #2 — Mid-run abort behaviour

PASS. Same pipeline-level finally boundary. Critically: γ guarantees
disposal *regardless of how the run terminates*, because the registry
is bound to pipeline lifetime, not adapter type. This is the strongest
lifecycle guarantee of the three cells from Composer's perspective —
lifecycle is no longer the adapter author's problem at all.

### γ.3 Axis #3 — Sibling-adapter composition

γ IMPOSES NOTHING on the lifecycle-free sibling type. The mock secrets
resolver TYPE is unchanged — `mockSecretsResolver: SecretsResolver`,
identical to Cat VIII fixture. The cost moves from adapter-type to
*factory-wiring code*: `createMockSecretsAdapter({ registry })` accepts
the registry but doesn't register anything (lifecycle-free factories
just skip `register()`).

The structural cost is **orthogonal**: it lives on *adapter factories*
(every factory accepts a `registry` opt), not on adapter consumers
(`deps.memory.write(...)` looks identical across cells). At adapter
*author* time the cost is small. At adapter *call-site* time the cost
is zero.

Verdict: stub-close-required=false, introspection-required=false.
Note: this assumes the kit standardises on a registry threading
convention through factory opts (same way Cat VIII threads `args` +
`deps`).

### γ.4 Axis #4 — LOC + greppability

`construction-site-loc-delta` ≈ +2 (factory accepts `{ registry }` +
calls `opts.registry.register('orchestr8-sqlite', async () => { await
raw.close(); });`). Plus a kit-side `DisposableRegistry` primitive
(~35 LOC, pay-once).

Greppable contract: `registry.register` — **highest signal of the
three cells**. Every line that calls `register()` is exactly the set
of things with real lifecycle, and the registration site is co-located
with the factory body where the resource is constructed. There is no
type-level signal at all (the adapter is `MemoryAdapter` everywhere),
which is intentional — γ trades type-level discoverability for
factory-site discoverability.

### γ.5 Axis #5 — Async-factory composition

Compatible=true *with one nuance*. `registry.register(name, teardown)`
is **synchronous** by design: the registry stores the thunk in an
array slot. The thunk itself is async (it awaits `raw.close()`). Sync
registration matters because it happens INSIDE the async factory body
*before* the factory's outer Promise resolves — meaning the kit's
"registered before construction-promise resolves" guarantee falls out
naturally from the existing factory pattern.

Cat VIII ADR-v1-VIII-1 shape `await create<X>Adapter({ args, deps })`
lifts UNCHANGED, with one extra opts field (`registry`). Verdict:
compatible, slightly more opts plumbing than β.

## §5 — Cross-cut Cat VI bump-out

The brief asks specifically: did any cell force a kit-shape decision
pushing the question to Cat VI synthesis-tier? Specifically — does
`Disposable` need to live in core kit (Cat VI), or can it stay at
adapter-tier (Cat V)?

**Verdict: bump-out happens, and it is forced by cells β and γ
*together*, not by any one cell alone.**

- **Cell α** does NOT force a Cat VI bump-out. `close` is just a third
  verb on the adapter contract; it lives entirely at adapter-tier.
  Composer-side it is "call `adapter.close()` in the pipeline-level
  finally" — no kit-core primitive needed. Cost is on adapter authors,
  not kit shape.
- **Cell β** marginally forces Cat VI. The `Disposable` interface
  itself can live at Cat V (memory-adapter only), but if the
  `'close' in dep` introspection is generalised to ALL deps (secrets,
  embeddings, future adapters), the `Disposable` interface becomes a
  cross-adapter primitive — which is a Cat VI control-plane concern.
  The `disposeAll` helper IS the actual kit primitive; it lives in
  Composer, which is Cat VI scope.
- **Cell γ** forces Cat VI directly. `DisposableRegistry` is a
  Composer-owned primitive that has nothing to do with memory; it is
  the lifetime-management primitive *for the entire pipeline*. Cells
  α and β both treat lifecycle as an adapter-tier concern (memory has
  it; secrets doesn't). γ treats lifecycle as a *pipeline* concern
  (the pipeline owns disposable resources via a registry). That is
  unambiguously a Cat VI synthesis-tier decision — analogous to how
  Cat VIII's `version-aware-resolver` wrapper became a *cross-cutting*
  construct rather than a deps-shape decision.

**What this means for Q1 ADR-lock:** if brain narrows to β or γ, the
Cat V Q1 ADR cannot ship in isolation — it needs a corresponding Cat
VI ADR (e.g. `ADR-v1-VI-X — pipeline-kit owns adapter lifetime
through a Composer-supplied DisposableRegistry, not the adapter
contract`). If brain narrows to α, Cat V Q1 ADR can ship standalone.

This is the structural decision spike #2 surfaces; brain decides
whether the Cat VI dependency is acceptable.

## §6 — Verdict

**Day-2 narrow lean to β.** Justification:

- **Axes 1, 2, 5 are tied across all three cells** — all three close
  cleanly happy + abort, all use pipeline-level finally boundaries,
  all compose with the existing async-factory shape.
- **Axes 3 and 4 split the cells.**
  - α loses on axis 3 (forces stub-close on lifecycle-free siblings;
    that's exactly what Cat VIII spike #2 §5/§8 + spike-5 §3.3 +
    carry-fwd #8 has been calling out as a structural anti-pattern at
    the adapter contract level — verb-cost on the dep that doesn't
    need it). It also has the noisiest grep target.
  - β wins on axis 3 (lifecycle-free siblings stay pristine) AND on
    axis 4's greppability (`Disposable` is high-signal). Pays only
    +10 kit-side LOC for `isDisposable` + `disposeAll`. Adapter
    authors who don't need lifecycle write zero lifecycle code.
  - γ wins on axis 4's LOC delta (+2) and offers the strongest
    Composer guarantee, but pays for it in §5 — γ is the only cell
    that *requires* a Cat VI synthesis-tier primitive
    (`DisposableRegistry`) to land before its Cat V ADR can be
    locked. β can ship at Cat V tier first and let
    `DisposableRegistry` arrive later as an *additive* refactor (β's
    `Disposable` interface is forwards-compatible with γ's registry
    via a trivial wrapper: `registry.register(name, async () =>
    adapter.close())`).

**β is the structurally-cheapest day-2 winner that defers the Cat VI
commitment.** It also empirically mirrors Cat VIII's `SecretsResolver`
shape (minimum contract; opt-in extensions like version-aware-resolver
layered above) — same ADR shape discipline. Cat VIII spike #6 §5 +
carry-fwd #8 narrowed exactly this way: minimum contract + opt-in
façade.

**γ is the structurally-strongest long-game winner** but only if a
Cat VI ADR is willing to land alongside Cat V Q1. If brain wants to
ship a Cat V Q1 ADR before Cat VI synthesis-tier, β is the route.

α is empirically the worst — it pays verb-cost on every adapter
forever, in service of a behaviour that 90%+ of adapters won't
exercise.

**Carry-forward to spike #3:** brain may want a thin spike that lifts
β's `Disposable` *out of* `deps.memory` and tests it across a
multi-adapter pipeline (`memory + secrets + embeddings + serve`) to
see whether the `'close' in dep` introspection generalises cleanly,
or whether γ becomes preferable at N > 2 adapters.

## §7 — Carry-forwards

Anchored to outline § Cat V Q1 (verb-set + lifecycle), Q5 (placement),
+ cross-cut tags. Spike #1's carry-fwds are unchanged unless explicitly
refined here. New carry-forward numbering continues from spike #1's `#8`.

1. **(spike #1 cf #1 — REFINED)** Resource lifecycle on MemoryAdapter
   — empirical answer is **β: separate `Disposable` interface**, not
   3-verb contract. Day-2 lean. Locked tentatively to β pending spike
   #3 verification at multi-adapter scale. Cross-cuts Cat VI.
2. **(NEW cf #1.5)** `initialize()` parallel — spike did NOT probe a
   separate "warmup" phase distinct from constructor-time factory.
   The async factory `await createOrchestr8MemoryAdapter()` already
   does init at construction (see `createRawBackend` →
   `backend.initialize()`). No new structural friction surfaced; the
   factory-as-init pattern lifts unchanged. Carry-forward only as an
   open question for backends with a *separate* init phase that needs
   to happen *after* deps wiring (e.g. an embeddings adapter that
   warms up against the memory adapter). Not surfaced day-2.
3. **(spike #1 cf #2 unchanged)** Idempotency convention on `write` —
   still Q1; not exercised by spike #2.
4. **(spike #1 cf #3 unchanged)** Cross-run persistence vs `:memory:`
   ephemerality — spike #3 candidate, separate axis.
5. **NEW cf #9** Cat VI bump-out for `DisposableRegistry`. If brain
   chooses γ at Q1-lock time, a Cat VI ADR for "Composer owns
   pipeline-resource lifetime through a registry primitive" must land
   in the same ADR cohort. β defers this; α doesn't trigger it.
6. **NEW cf #10** Multi-adapter scale verification. Spike #3 should
   probe whether β's `'close' in dep` introspection generalises
   cleanly when the pipeline has 4+ deps (memory + secrets +
   embeddings + a hypothetical 4th lifecycle-bearing adapter). If
   introspection cost grows superlinear or correctness gets fragile
   at N≥4, γ wins on Composer-side discipline.
7. **NEW cf #11** Sibling-adapter cost taxonomy. Spike #2 surfaces a
   3-cell taxonomy:
   - α: cost on adapter-type (lifecycle-free sibling pays stub verb).
   - β: cost on Composer-side introspection (one-time kit primitive).
   - γ: cost on factory-wiring (registry threading; lifecycle-free
     factories no-op).
   Cat VIII spike-1 surfaced an analogous taxonomy for placement
   (ambient vs deps vs context). The `cost-locality` axis is
   load-bearing across at least 2 categories now; brain may want a
   cross-category synthesis note.
8. **NEW cf #12** Async-factory + sync-registry tension. γ's
   `registry.register` is synchronous *by intent* (pre-resolution
   guarantee). If a backend's teardown thunk needs to *await
   construction-time state* (e.g. a connection-pool flush that needs
   the connection IDs), γ's sync-registration window may not be
   sufficient. Day-2 spike did NOT exercise this. If γ is chosen,
   verify with a spike where the teardown thunk closes over async
   construction-time state.
9. **NEW cf #13** Composer-side `disposeAll` ordering. β and γ both
   drove disposal in pipeline-level finally; both are LIFO in the
   driver-loop case. At multi-adapter scale (spike #3 candidate)
   ordering matters when one adapter holds a reference to another
   (e.g. embeddings depends on memory). Spike #2 did NOT exercise
   inter-adapter teardown ordering. Carry-forward.

## §8 — Open questions (research, not decisions)

- **Q-O-1.** β's `'close' in dep` runtime introspection is structurally
  duck-typed; would a *nominal* marker (e.g. `Symbol.dispose` per
  TC39 explicit-resource-management proposal, lib-DOM 5.4+) be a
  better long-term fit? Spike used `'close' in dep` for kit-self-
  containedness; the question is whether kit's `Disposable` should
  land aligned with TC39 / `using`-statement.
- **Q-O-2.** α's verb-cost is genuinely cheap *per adapter* (~5 LOC
  stub). Is the structural cost of "lifecycle invariant communicated
  by adapter type, not contract" worth those 5 LOC × N adapters? At
  N=15 (Cat VIII spike #4 implied roadmap), that's 75 LOC of stub
  closes versus β's ~10 kit-side LOC paid once. β still wins on
  signal-to-noise but the per-adapter cost is not large.
- **Q-O-3.** γ's `DisposableRegistry` is structurally similar to what
  a `RunContext` might own (kit's
  `PipelineContext { run_id, signal }` already is the "what's bound
  to this run" primitive). Should the registry be ON
  `PipelineContext`, or alongside it? Spike kept it standalone for
  isolation. Cat VI synthesis question.
- **Q-O-4.** Did the spike correctly model Composer ownership? In
  cells β and γ the "Composer" was simulated by the driver's
  `try/finally` block. Real Composer code (when it lands) may want
  `disposeAll` driven from a `runner.terminate()` lifecycle hook
  (cancellation-aware, error-aggregating). Spike did NOT model
  cancellation-of-cancellation (e.g. `disposeAll` itself getting an
  abort signal). Out of day-2 scope.
- **Q-O-5.** Cell α leaks the lifecycle responsibility into every
  *consumer* code path that touches `deps.memory.close()` — but
  spike #2 forbade adapter-author calls to close (only the driver's
  finally calls it). In a real codebase, would a junior author
  accidentally call `deps.memory.close()` mid-process and break the
  pipeline? The 3-verb shape makes this *callable*. β makes it
  un-callable (close is on `Disposable`, not `MemoryAdapter`); γ
  makes it un-discoverable (close is not on the adapter at all).
  Defensive-design axis not formally probed.

## §9 — Status

- **Throwaway spike code.** No commits made. All files are untracked
  (`?? research/spikes/memory-feedback/`). Brain reviews + decides
  whether to FF-merge to master or request iteration.
- **No kit-core amendments.** No edits outside the spike directory.
- **No v0 / v1 ADR amendments.** Findings inform Cat V Q1 ADR-lock
  decision but do not themselves constitute an ADR.
- **Branch:** `v1-cat-V-spike-2-lifecycle-and-disposable`.
- **Branch parent:** `85e78c2` per README; observed master tip at run
  time `2caf05e` — both clean.
- **Worktree path:** `/Users/zadexinho/Claude-Workspace/pipeline-kit-spike-2/`.
- **Run command:**

```
cd /Users/zadexinho/Claude-Workspace/pipeline-kit-spike-2/research/spikes/memory-feedback/lifecycle-and-disposable
bash run-spike-2.sh
```

- **Strict typecheck:** `bunx tsc --noEmit -p tsconfig.json` exits 0.

End findings.
