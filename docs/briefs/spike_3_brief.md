# Spike #3 Brief — Cat V `cross-run-persistence-and-verb-set`

> **Author:** Brain — 2026-05-09.
> **Companion to:** `docs/research-outline-v1.md` § Category V (Q1 verb-set + Q2 scope; cf #2 idempotency, cf #3 cross-run).
> **Predecessor spikes:** #1 `deps-shape-lift` — Q5 placement PASS at commit `8ed8b78` (lift `deps:{secrets}` → `deps:{memory}` clean); #2 `lifecycle-and-disposable` — Q1 lifecycle β-lean at master tip `80ba230` (Cat VI bump-out flagged for γ).
> **Branch parent:** master @ `80ba230`.
> **Status:** brain-locked, executor-ready.
> **Friction anchor:** F-MEMORY (catalog top-15 #4) + F-X-mem (#13).

---

## §0 Precursor — spike-1 evidence rescue

Before spike-3 work begins, the holding-pen branch `spike/cat-V-deps-shape-lift` carries the only copy of `research/spikes/memory-feedback/deps-shape-lift/{findings.md,spike.ts,package.json,bun.lock}` (commit `8ed8b78`). Spike #2's FINDINGS references those carry-forwards by number; if `spike/cat-V-deps-shape-lift` is ever deleted the record orphans (reflog-only ~90d window).

**Action** (precursor commit, runs before spike-3 dispatch):

- Branch: `v1-cat-V-spike-1-evidence-rescue` off `master@80ba230`.
- Operation: `git checkout v1-cat-V-spike-1-evidence-rescue && git checkout spike/cat-V-deps-shape-lift -- research/spikes/memory-feedback/deps-shape-lift/`.
- Commit message: `docs(research): rescue Cat V spike #1 evidence into master tree`.
- FF-merge to master; delete the working branch only.
- Do **NOT** touch `spike/cat-V-deps-shape-lift` itself (carry-forward #6 deletion is a separate, later call).

After rescue, master carries both spike #1 + spike #2 evidence; spike-3 work begins from the new master tip.

---

## §1 Anchoring

- **Outline questions probed:** Cat V Q1 (verb-set component of lifecycle+verb-set), Q2 (scope: pipeline / stage / atom / user). Q3 (EditableField), Q4 (pgvector), Q5 (placement) explicitly **out-of-scope**.
- **Carry-forwards probed:** cf #2 (idempotency-on-write), cf #3 (cross-run persistence), cf #11 (sibling-cost taxonomy verification at verb growth).
- **Spike-2 verdict carry-in:** β shape — `MemoryAdapter = { read, write }` + opt-in `Disposable` interface — lifts verbatim into spike #3 baseline. Lifecycle axis is NOT re-litigated.
- **Anchoring discipline:** Cat V same-cat consecutive (spike #2 → spike #3); no gap session required between spikes of the same category.

---

## §2 Modern direction (2024-26) — what to lift, what not to

The 2024-26 agent-memory landscape converges on a **small core verb-set + opt-in tier extensions** pattern. Lift the structural discipline, not the product opinions.

| System | Core verbs | Tier extensions (opt-in) |
|---|---|---|
| Anthropic Memory tool (2025) | `read` / `write` (file-system-backed) | (none — files-as-memory) |
| Mastra agent memory (TS-native) | `get` / `update` (working memory) | semantic recall, threads |
| mem0 (open-source) | `add` / `search` | `update`, `delete` |
| Letta / MemGPT | `core_memory_replace` / `archival_insert` | `recall_search`, `conversation_search` |
| orchestr8 (kit's reference) | `store` / `retrieve` | `query`, `update`, `delete` (+ `initialize`/`close`) |
| Claude Code MEMORY.md | (file-based read/write) | (none — index pattern) |

**Lift (structural):** the **"core 2-verb minimum + opt-in tier-growth via marker interfaces"** discipline. This mirrors spike-2's `Disposable` opt-in (Cat V) and Cat VIII's `version-aware-resolver` wrapper (Cat VIII ADR-VIII-2). Kit's `MemoryAdapter` should converge on the same shape: minimum core, opt-in extensions per capability.

**Do NOT lift:**
- mem0's SaaS-cloud assumption (kit is library, not service).
- Zep's temporal-knowledge-graph specifics (Cat V Q4 territory, deferred).
- LangMem's managed-extraction (kit ≠ runtime).
- Letta's full hierarchical tier model (kit ≠ product opinion).
- Anthropic Memory tool's file-system semantics (kit's adapter abstracts the substrate).

---

## §3 Scope — 2 cells

### §3.1 Shared infrastructure

- Adapter wiring: `orchestr8-mcp` npm direct (option (b) per spike-1 precedent). NO MCP-stdio shim.
- Backend: orchestr8 `SQLiteBackend` with **real-disk file** at `./.spike-3-data/db.sqlite` (gitignored locally; one entry added to spike directory's `.gitignore`).
- WAL mode: rely on whatever orchestr8 ships as default; do NOT override. If observed, note in FINDINGS.
- Run boundary: 2 sequential `bun run` invocations bracketing a process exit (durability axis — NOT in-process re-use).
- Spike-2 β contract baseline: `MemoryAdapter = { read, write }` + opt-in `Disposable`. Sibling lifecycle-free deps: mock `SecretsResolver` (lifted verbatim from Cat VIII spike #1, as in spike #2).
- `PipelineContext`: `run_id` + `signal` only (ADR-v1-VIII-1 discipline).
- Errors: `Result<T, MemoryError>` boundary. No thrown errors cross stage public surface.
- Strict TS: `noUncheckedIndexedAccess` on; no `any`.

### §3.2 Cell α — `minimum-verbs-hold-across-runs`

**Setup:**
- Source emits 3 atoms with structured keys (e.g. `pk_atom_v_1` / `_2` / `_3`).
- Process splits into atoms-A: `deps.memory.write(composedKey, value)` per atom.
- Serve confirms each write via local read-back (in-process, same run).
- Pipeline closes; process exits.

**Run-2 (separate `bun run` invocation):**
- Source emits the 3 expected keys (executor pre-knows them).
- Process: `deps.memory.read(composedKey)` for each.
- Serve verifies all 3 present with the values written in Run-1.

**Axes:**
- α.1 — cross-run R+W round-trip holds (PASS/FAIL).
- α.2 — key-reuse semantics (cf #2 idempotency-on-write): after Run-2 reads, attempt `deps.memory.write(existingKey, newValue)`. What does the contract say happens? Replace? Append? Reject? Surface as friction; do NOT add idempotency-key parameter to the contract — observe what falls out of the existing 2-verb shape.
- α.3 — namespace/scope boundary (Q2): does the spike need a namespace primitive in `MemoryAdapter`, or is composed-key convention (`<namespace>::<key>`) sufficient? If executor reaches for "I need to scope this to a run / pipeline / user" and the contract has no answer, that's the friction.
- α.4 — LOC + greppability delta vs spike-2 baseline.
- α.5 — disposable lifecycle re-applies to disk-backed (vs `:memory:`): does WAL/checkpoint timing change anything observable on `close()`? Does the `Disposable` opt-in still introspect cleanly?

**Question answered:** does the 2-verb contract survive the durability boundary cleanly, or does cross-run force a 3rd verb / semantic concept (TTL, namespace, idempotency-key) into the **core** contract?

### §3.3 Cell β — `verb-growth-forced`

**Setup:**
- Source emits ≥5 atoms with structured keys in a single namespace (e.g. `extract-run-2026-05-09::atom-1` … `::atom-5`).
- Process writes each via `deps.memory.write`.
- Pipeline closes; process exits.

**Run-2 (separate `bun run` invocation):**
- Source emits the **namespace only** (executor does NOT pre-know the keys).
- Process needs to enumerate atoms in the namespace — `deps.memory.read(exactKey)` cannot supply this.
- **Concrete probe:** `deps.memory.list(namespace)` → `Result<string[], MemoryError>` (returns key list within the namespace).
- Process iterates returned keys, reads each, accumulates values.
- Serve verifies all 5 present.

**Why `list` (not `search` or `forget`):**
- Simplest verb-growth signal that orchestr8's `query` already exposes.
- Falsifiable in 1 cell.
- `search` is semantic-vector territory (Cat V Q4 — deferred).
- `forget` is TTL/policy territory (deferable; doesn't probe verb-growth, probes verb-semantics).

**Axes:**
- β.1 — verb-growth signal: does Process *naturally* reach for `list`, or can the executor work around it (cursor file, separate index, sentinel keys, etc.)? If a workaround feels cleaner, that's a signal that `list` is NOT a core verb.
- β.2 — contract tier: does `list` belong on `MemoryAdapter` core, or on an **opt-in marker interface** (`Listable`, parallel to spike-2's `Disposable`)? Probe: write the cell with `Listable` opt-in first; if it composes cleanly with the rest of the kit-shape, opt-in tier wins. If introspection cost is fragile or the call-site needs `'list' in deps.memory` checks pervasively, core wins.
- β.3 — sibling-cost: does the lifecycle-free sibling (mock `SecretsResolver`) pay any verb-cost from the addition? It must not (per spike-2 cf #11 taxonomy).
- β.4 — LOC + greppability delta. Greppability target: `Listable` (interface name) — measure signal-to-noise.
- β.5 — pattern lift: does the "core 2-verb minimum + opt-in extension" pattern (spike-2 β shape) generalise to verb growth? If yes, the same shape covers BOTH lifecycle and verb extension. If no, kit needs a different extension primitive for verb-set.

**Question answered:** what's the smallest verb-set growth that emerges from real cross-run friction, and does it land in core kit (`MemoryAdapter` 3-verb) or opt-in tier (`MemoryAdapter` 2-verb + `Listable`)?

---

## §4 Out-of-scope (explicit)

- pgvector / semantic search / vector composition (Cat V Q4 — defer to later spike).
- EditableField feedback flow (Cat V Q3 — separate spike candidate (e) per brain scoping).
- Multi-shape generalisation across gatewerk feedback / pursuit corpus / cole-obsidian RAG (candidate (d) per brain scoping).
- Multi-adapter scale lifecycle at N≥4 (cf #10 — defensive, candidate (b)).
- Cat VI synthesis (`DisposableRegistry`).
- Cat I × Cat V durable-execution composition (spike order: Cat I runs after Cat V).
- pgvector SQLite extension probing.
- Concurrent-run protection (separate Cat IV concern).

---

## §5 Deliverables

- **Branch:** `v1-cat-V-spike-3-cross-run-persistence-and-verb-set` off `master` (post-rescue tip).
- **Path:** `research/spikes/memory-feedback/cross-run-persistence-and-verb-set/`.
- **Files:**
  - `cell-alpha-minimum-verbs.ts` — α driver (writes Run-1 + reads Run-2 toggled by `argv[2]` flag, e.g. `bun run cell-alpha-minimum-verbs.ts run-1`).
  - `cell-beta-verb-growth.ts` — β driver (same pattern).
  - `mock-orchestr8-disk-backend.ts` — adapter wrapping `SQLiteBackend(filePath)` with the spike-2 β contract + `Disposable`.
  - `mock-secrets-resolver.ts` — lifted verbatim from spike #2.
  - `run-spike-3.sh` — orchestration: 4 sequential invocations (α-run-1, α-run-2, β-run-1, β-run-2) + cleanup of `.spike-3-data/` between cells.
  - `package.json` — bun-installed; `orchestr8-mcp` direct dep.
  - `tsconfig.json` — strict + `noUncheckedIndexedAccess`.
  - `.gitignore` — local entry: `.spike-3-data/`.
  - `README.md` — run command + axis summary table.
  - `FINDINGS-spike-3.md` — output report, structure mirrors `FINDINGS-spike-2.md`.

- **File-size discipline:** ≤300 lines code-ish per cell file (500 hard); `FINDINGS-spike-3.md` ≤500 lines.
- **Strict TS typecheck:** `bunx tsc --noEmit -p tsconfig.json` exits 0.
- **Run command (final):** `cd research/spikes/memory-feedback/cross-run-persistence-and-verb-set && bash run-spike-3.sh`.

---

## §6 FINDINGS report structure

Mirror `FINDINGS-spike-2.md`:

- **§1 Setup** — what was built, observed run output verbatim, file LOC table.
- **§2 Cell α deep-dive** — α.1 through α.5 axis-by-axis.
- **§3 Cell β deep-dive** — β.1 through β.5 axis-by-axis.
- **§4 Cross-cuts** — does spike-3 trigger another category bump-out (analogous to spike-2's Cat VI bump-out for γ)? Particular suspects: Cat I (idempotency-on-write — α.2), Cat VI (verb-tier-discovery convention — β.2).
- **§5 Verdict** — narrow lean per cell + spike-level synthesis-readiness call.
- **§6 Carry-forwards** — continue numbering from spike-2's cf #13. Anchored to outline § Cat V Q1+Q2 + cross-cut tags.
- **§7 Open questions** — research-level, NOT decisions.
- **§8 Status** — branch, parent commit, run command, typecheck status.

---

## §7 What FINDINGS must surface for synthesis-readiness

After spike #3 lands, brain checks for:

1. **Q1 verb-set:** is kit's `MemoryAdapter` core 2-verb (with `Listable` opt-in) or 3-verb? Empirical answer required.
2. **Q1 lifecycle:** does cross-run change the spike-2 β-lean? (Expected: no.)
3. **Q2 scope:** is namespace a Composer/Context primitive, an adapter argument, or composed-key convention? Empirical answer required.
4. **cf #2 idempotency-on-write:** does the contract need an `idempotencyKey?` parameter, or is composite-key sufficient?
5. **cf #3 cross-run persistence:** RESOLVED empirically (verdict in cell α).
6. **cf #11 sibling-cost taxonomy:** does the 3-cell taxonomy (adapter-type / Composer / factory-wiring) hold for verb-set additions?
7. **New cf candidates expected:** WAL/checkpoint timing (cf #14 candidate), namespace-as-primitive (cf #15 candidate), verb-tier-discovery convention (cf #16 candidate).

---

## §8 Synthesis runnability gate after spike #3

Cat V synthesis becomes runnable when verb-set + lifecycle + placement all settled (Q1 + Q5 done) at v1 ambition.

After spike #3 (if cell α + cell β land clean verdicts):
- Q5 RESOLVED (spike #1 PASS).
- Q1 lifecycle RESOLVED (spike #2 β-lean).
- Q1 verb-set RESOLVED (spike #3 cell β verdict).
- Q2 scope RESOLVED (spike #3 cell α α.3 axis).
- Q3 (feedback) + Q4 (vector) — explicitly v1-scope-deferred or future cycles.

**Cat V synthesis becomes runnable after spike #3.** Anchoring rule then forces a gap session before synthesis (last-spike-of-cat → synthesis-of-cat).

---

## §9 Discipline

- **Throwaway spike code.** No kit-core touch, no v0/v1 ADR amendments.
- **No commits to master from spike branch.** FF-merge only after FINDINGS lands.
- **Worktree:** executor's choice; spike-2 used `pipeline-kit-spike-2/` worktree; spike-3 may follow the same convention or use a fresh one.
- **Subagent branch discipline:** every dispatched subagent (implementer / typecheck / review) bound to an explicit branch.
- **Brain authority:** brain reviews FINDINGS-spike-3.md before synthesis dispatch. Brain decides whether spike #3 verdicts are tight enough to anchor Cat V Q1 + Q2 ADRs.

---

*End of spike #3 brief. Brain authority — Cat V Phase 1 evidence stage. 2026-05-09.*
