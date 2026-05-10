# Cat V Spike #3 — `cross-run-persistence-and-verb-set`

**Throwaway code.** Probes Cat V Q1 (verb-set) + Q2 (scope) under the
spike-2 β contract baseline (`MemoryAdapter = { read, write }` + opt-in
`Disposable`). Adds opt-in `Listable` parallel to `Disposable` for the
verb-growth probe.

## What it answers

- **Q1 verb-set:** is kit's `MemoryAdapter` core 2-verb (with `Listable`
  opt-in) or 3-verb? Cell β verdict.
- **Q2 scope:** is namespace a Composer/Context primitive, an adapter
  argument, or composed-key convention? Cell α α.3 axis.
- **cf #2 idempotency-on-write:** does the contract need an
  `idempotencyKey?` parameter, or is composite-key sufficient?
  Cell α α.2 probe.
- **cf #3 cross-run persistence:** RESOLVED empirically. Cell α α.1.
- **cf #11 sibling-cost taxonomy:** does the verb-cost-on-sibling pattern
  spike-2 surfaced for lifecycle hold for verb-set additions? Cell β β.3.

## Cells (2; not 3)

- **(α) `minimum-verbs-hold-across-runs`.** Run-1 writes 3 atoms via
  `write`; process exits. Run-2 (fresh `bun run`) reads same composed
  keys via `read`; verifies cross-run round-trip (α.1). Then probes α.2
  key-reuse semantics (re-write existing key + re-read).
- **(β) `verb-growth-forced`.** Run-1 writes 5 atoms in a namespace.
  Run-2 (fresh `bun run`) Source emits ONLY the namespace; Process
  enumerates atoms via `deps.memory.list(namespace)` — opt-in `Listable`
  marker interface. Falsifiable workaround branch (cursor-file) wired
  in but not exercised; commented in FINDINGS β.1.

## Spike axes

| Axis | Cell α | Cell β |
|------|--------|--------|
| .1 | cross-run R+W round-trip holds | verb-growth signal (does Process *naturally* reach for `list`?) |
| .2 | key-reuse semantics (cf #2) | contract tier (core vs `Listable` opt-in) |
| .3 | namespace/scope boundary (Q2) | sibling-cost (β.3 — secrets pristine) |
| .4 | LOC + greppability vs spike-2 | LOC + greppability (target: `Listable`) |
| .5 | disposable lifecycle on disk-backed | pattern-lift verification (β shape lifts to verb growth?) |

## How to run

```bash
bash run-spike-3.sh
```

Four `bun run` invocations sequential. Process exits between α-run-1 / α-run-2 / β-run-1 / β-run-2 — that's the durability boundary. `.spike-3-data/` is wiped between cells.

## Out of scope

- Cell γ (Composer-owned verb-tier registry, parallel to spike-2 γ).
  Brief explicitly scopes 2 cells. If β-Listable falters, brain
  considers a γ spike later.
- pgvector / semantic search (Q4).
- EditableField (Q3).
- Multi-shape generalisation across gatewerk feedback / pursuit corpus
  / cole-obsidian RAG.
- Concurrent-run protection (Cat IV).
- Cat I × Cat V durable-execution composition.

## Branch + merge protocol

- Branch: `v1-cat-V-spike-3-cross-run-persistence-and-verb-set`
  rooted at master tip `55a3533` (post spike-1 rescue).
- FF-merge to local master on completion.
- Branch deleted post-merge; throwaway code; no kit-core amendments.
