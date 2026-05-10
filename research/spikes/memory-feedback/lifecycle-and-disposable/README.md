# Cat V Spike #2 — `lifecycle-and-disposable`

**Throwaway code.** Surfaces friction in *where adapter lifecycle lives*
(`close()` / `initialize()`), before brain commits any Cat V Q1 ADR.

Spike #1 (`deps-shape-lift`, preserved on branch
`spike/cat-V-deps-shape-lift` at `8ed8b78`) §5.2 headline finding —
orchestr8's `SQLiteBackend` has `initialize()` + `close()`; pure secrets
resolvers don't — cross-cuts Cat VI (data plane vs control plane). Spike
#2 probes which kit shape pays the lifecycle cost most cleanly.

## What it answers (Cat V Q1 + spike #1 carry-fwd #1)

Three structural placements over the same orchestr8 `SQLiteBackend`
boundary:

- **(α) `close()` on the contract.** `MemoryAdapter` becomes
  `{ read, write, close }`. Lifecycle-free backends stub `close()`.
  Mirror of Cat VIII variant A discipline (ambient-cost pattern at
  adapter scope).
- **(β) `Disposable` opt-in interface.** `MemoryAdapter` stays at 2 verbs
  (`read`, `write`). Backends with real lifecycle ALSO implement a
  separate `Disposable { close(): Promise<void> }`. Composer detects via
  `'close' in adapter` (or `instanceof`). Mirror of Cat VIII variant B
  "minimal contract + opt-in" discipline.
- **(γ) Composer-owned lifetime.** `MemoryAdapter` exposes only `read` +
  `write`. Adapter factory registers a teardown thunk into a
  Composer-supplied `DisposableRegistry` at construction; Composer drives
  close on pipeline disposal. Adapter call sites never see lifecycle.

Same orchestr8 `SQLiteBackend` wiring across all three. Pipeline =
Source(emit 1 atom) → Process(R+W as spike #1) → Serve(print readBack).
What changes between cells is who calls `SQLiteBackend.close()`.

## Friction anchor

`F-MEMORY` — top-15 #4 in `docs/research-friction-catalog.md`.
Carry-forward #1 from spike #1's `findings.md §7` flagged §5.2 lifecycle
as *"Likely the sharpest day-2 question."*

## Spike axes (observable variables)

Each cell α / β / γ records:

1. **Clean close.** `SQLiteBackend.close()` return + process exit code
   0; no orphan-handle warnings.
2. **Mid-run abort behaviour.** `ctx.signal` aborted during atom-A's
   write — does close still get called? On which boundary (atom /
   process / pipeline)?
3. **Sibling-adapter composition.** Pipeline also takes a
   lifecycle-free mock `SecretsResolver` (lifted verbatim from Cat VIII
   spike #1 fixture). α forces `SecretsResolver` to stub close (verb-cost
   imposed on the lifecycle-free dep); β leaves `SecretsResolver`
   untouched; γ requires Composer to introspect *both* deps for
   disposability.
4. **LOC + greppability at adapter construction site.** Lines added vs
   spike #1's deps-shape-lift baseline. Greppable contract: `close: `
   (α), `implements Disposable` (β), `dispose:` registry call (γ).
5. **Async-factory composition.** Does γ's registry require sync
   registration, or compose with the existing
   `await create<X>Adapter({ args, deps })` pattern from Cat VIII
   ADR-v1-VIII-1?

## How to run

```bash
bash research/spikes/memory-feedback/lifecycle-and-disposable/run-spike-2.sh
```

Three cells run in turn. Exit 0 only if all three close cleanly AND axes
#1–#5 are recorded for each.

## Out of scope

- Cross-run persistence (run-1 write → run-2 read) — spike #3 candidate
  (carry-fwd #3).
- Verb-set widening beyond R+W (search / list / forget) — Q1 ADR will
  gather all spikes' evidence before locking.
- Embedding / vector verb-set (carry-fwd #5).
- `EditableField` feedback flow (carry-fwd #6).
- Multi-shape memory generalisation (gatewerk feedback / pursuit corpus
  / cole-obsidian RAG). Adopt orchestr8 only — Phase 0 reference-impl
  lock holds.
- Real-disk SQLite — `:memory:` is sufficient for lifecycle probe.
- v0 / v1 ADR amendments.

## Expected output (`FINDINGS-spike-2.md`)

1. Per-cell run output (close return, abort-branch behaviour, LOC).
2. Verdict on each of axes #1–#5.
3. **Cross-cut Cat VI bump-out** — did any cell force a kit-shape
   decision that pushes the question to Cat VI synthesis-tier (e.g.
   `Disposable` must live in core kit, not Cat V scope)?
4. Re-entry conditions for cells α / β / γ at Q1 ADR-lock time (mirror
   Cat VIII spike #1 §6 "C re-entry condition" discipline).

## Branch + merge protocol

- Spike branch: `v1-cat-V-spike-2-lifecycle-and-disposable` (rooted at
  `85e78c2` — clean master, post-reconcile; spike #1 lineage preserved
  separately on `spike/cat-V-deps-shape-lift`).
- Per `feedback_subagent_branch_discipline.md` — explicit branch
  binding.
- FF-merge to local master on completion (use `git update-ref` if main
  worktree is on a different in-flight branch — same workaround as
  spike #1).
- Branch deleted post-merge; throwaway code; no kit-core amendments.
