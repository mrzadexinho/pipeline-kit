# Spike #3 — composer-lifecycle FINDINGS

> Spike: probe whether Composer should formalize pipeline-resource lifetime
> management (DisposableRegistry pattern) and adapter composition conventions.
> Directory: `research/spikes/cat-vi-stage-model-extension/spike-3-composer-lifecycle/`
> Branch: `master`. Author: Executor — 2026-05-11.
> Companion to: `docs/research-outline-v1.md` § Category VI (Stage Model Extension).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-VI.md`).
> Cross-cuts: Cat V cf #9 (DisposableRegistry), Cat VIII cf #8 (reconstruction),
>   Cat IV ADR-v1-IV-4 (TriggerAdapter seam), ADR-v1-V-2 (Disposable opt-in CONFIRMED).

---

## §1. SETUP

- **Structural probe — no external deps.** No orchestr8, no Inngest, no Zod.
- **Runtime:** Bun + TypeScript strict; ESM only. `bunx tsc --noEmit` exits 0.
- **Files:**
  - `src/types.ts` — lifecycle type exploration (Disposable, Options A/B/C shapes, AdapterConvention)
  - `src/probe-disposable-registry.ts` — 3-option comparison: DisposableRegistry vs deps-aware vs self-managed
  - `src/probe-reconstruction.ts` — non-re-readable resource reconstruction (Cat VIII cf #8)
  - `src/probe-seam-convention.ts` — 3x-confirmed adapter seam uniformity check
  - `src/probe-abort-during-cleanup.ts` — AbortSignal during disposal; separate timeout design

**Run commands (after `bun install`):**

```bash
bun run src/types.ts
bun run src/probe-disposable-registry.ts
bun run src/probe-reconstruction.ts
bun run src/probe-seam-convention.ts
bun run src/probe-abort-during-cleanup.ts
```

All 4 probes run clean (confirmed — exit 0, zero typecheck errors).

---

## §2. OBSERVATIONS

### O1 — DisposableRegistry: who owns adapter lifetimes?

[STRUCTURAL-PREDICTION — confirmed by probe output]

Three options probed against a 3-adapter pipeline (memory=Disposable, secrets=lifecycle-free, trigger=Disposable):

| Axis | A: DisposableRegistry | B: Deps-aware (current Cat V) | C: Self-managed |
|---|---|---|---|
| Kit primitive LOC | ~40 (pay-once) | ~20 (pay-once) | 0 |
| Per-adapter cost | +2 LOC (register call) | 0 extra LOC | +3 LOC per adapter |
| Lifecycle-free cost | 0 (not registered) | 0 (isDisposable=false) | 0 (manual skip) |
| Error isolation | YES (LIFO, per-adapter try) | YES | MANUAL |
| User extensibility | **YES** (any object) | NO (deps shape only) | YES (explicit) |
| Cat V ADR-v1-V-2 compat | additive refactor | **CONFIRMED SHAPE** | no Kit support |
| Cat VI ADR needed? | YES — forces it | NO — V-scope only | NO |

**Key finding — extensibility gap of Option B:**

B's `composerDisposeAll(deps)` walks `Object.values(deps)` — it can only see adapters
that are in the `deps` shape. If a user wires a custom WebSocket adapter as a module-local
variable (not threaded through `deps`), B silently skips it.

A's `registry.register(name, teardown)` is an explicit escape hatch that ANY code can call.
This is the load-bearing structural difference between A and B.

**Verdict:**
- Ship B (Cat V ADR-v1-V-2 confirmed shape) now — deps-aware disposal for declared adapters.
- Ship A as an additive Cat VI ADR — `DisposableRegistry` as an opt-in escape hatch for
  adapters not in `deps`. B's `Disposable` interface is forwards-compatible with A's registry
  via: `registry.register(name, async () => adapter.close())`.
- Reject C — error isolation is the user's problem; scales linearly with N adapters.

**Observed run output:**

```
[metric] disposed = ["trigger","memory"]   ← A (LIFO: trigger first, memory second)
[metric] disposed = ["memory","trigger"]   ← B (insertion order from Object.entries)
[metric] secrets-impact = "lifecycle-free adapter has zero cost — not registered"  ← A
[metric] secrets-impact = "lifecycle-free adapter silently skipped — isDisposable returns false"  ← B
```

Both A and B dispose all stateful adapters and skip the lifecycle-free SecretsResolver.
Error paths (failOnClose=true) confirm per-adapter isolation in both A and B.

---

### O2 — Reconstruction: new mechanism or existing retry?

[STRUCTURAL-PREDICTION — confirmed; reconstruct() REJECTED]

Cat VIII cf #8 asks: for non-re-readable resources (pre-signed S3 URLs, HTTP/2 streams,
WebSocket connections), who reconstructs when the resource expires mid-run?

| Axis | A: Adapter internal | B: reconstruct() hook | C: Result.err + retry |
|---|---|---|---|
| New kit surface | 0 | isStale + reconstruct | 0 |
| Inngest compat | transparent | Composer-only | **NATIVE (step retry)** |
| Error visibility | hidden re-sign | explicit pre-call | explicit error code |
| Wasted round-trip | 0 | 0 | 1 (first fail triggers) |
| Context-dependent re-sign | hard | possible | **POSSIBLE** |

**Observed run output (all 3 options produce identical ledgers):**

```
Option A: [adapter-A] resource expired — re-signing internally → signs-issued = 2
Option B: [adapter-B] Composer triggered reconstruct() — re-signing → signs-issued = 2
Option C: [adapter-C] refreshing resource after resource_expired error → signs-issued = 2
```

**Verdict: Option C (retry + `Result.err({ code: "resource_expired" })`) is sufficient.**

- `resource_expired` is a retryable error code — Inngest's step retry handles the outer
  loop natively (Cat I ADR-v1-I-3: kit maps retries via `kitStep()`).
- Adapter implements `refresh()` internally — same structural shape as Cat VIII
  version-aware-resolver's `invalidate()` pattern (same shape, different layer).
- `reconstruct()` as a new Composer interface is **REJECTED** — polling mechanism that
  duplicates retry semantics with more surface area.

**Cat VIII cf #8 RESOLVED:** non-re-readable resources → existing retry semantics.

---

### O3 — Seam convention: type it or document it?

[STRUCTURAL-PREDICTION — confirmed; AdapterConvention<C,I> REJECTED as typed base]

**Probe seam uniformity check (verbatim output):**

```
createInMemoryAdapter        interface:YES | Disposable:YES | call-site:SAME
createOrchestr8Adapter       interface:YES | Disposable:YES | call-site:SAME
createEnvSecretsResolver     interface:YES | Disposable:NO  | call-site:SAME
createSopsSecretsResolver    interface:YES | Disposable:NO  | call-site:SAME
createIntervalTrigger        interface:YES | Disposable:YES | call-site:SAME
createInngestTrigger         interface:YES | Disposable:YES | call-site:SAME

[seam-check] allCallSitesIdentical = true
```

`pipelineHandler(devDeps)` and `pipelineHandler(prodDeps)` call identical code.

**Why AdapterConvention<Config, Instance> is NOT worth typing:**
- Config shapes differ across adapters — no common factory input
- Disposable variance: memory/trigger always Disposable; secrets never Disposable (for env/sops)
- TypeScript's structural typing already enforces the interface at call sites
- A typed base would add no static safety beyond the individual interfaces

**Verdict: convention = DOCS-ONLY for the factory pattern.**

EXCEPTION: `Disposable` + `isDisposable()` IS a typed convention worth shipping — it bridges
ACROSS adapter types (memory AND trigger both implement it; secrets does not). This is the
cross-cutting typed convention that `AdapterConvention<C,I>` cannot capture.

**The 3x-confirmed seam convention (lock for ADR):**
1. Kit defines INTERFACE at Tier 1/2 — no concrete dep
2. Kit ships dev + prod IMPLEMENTATIONS at Tier 3
3. User selects implementation at construction time via factory function
4. Pipeline receives INTERFACE — runtime-agnostic
5. Lifecycle via `Disposable` opt-in (ADR-v1-V-2) — if stateful

---

### O4 — Abort during cleanup

[STRUCTURAL-PREDICTION — confirmed; TWO-SIGNAL design CONFIRMED]

Four scenarios probed:

**Scenario 1 — abort fires before pipeline completes:**
```
[result] disposed: ["trigger", "memory"]   errors: []
[analysis] pipeline-abort DOES NOT cancel disposal — correct behavior.
```

**Scenario 2 — abort fires during disposal (300ms close, 400ms timeout):**
```
[result] disposed: ["trigger", "memory"]   errors: []
[analysis] abort signal during disposal is IGNORED by registry.
```

**Scenario 3 — disposal timeout fires (1000ms close, 150ms timeout):**
```
[result] disposed: ["trigger"]   errors (timeout): ["memory"]
[analysis] trigger disposed cleanly. memory disposal timed out — abandoned after 150ms.
```

**Rejected — disposal respects pipeline AbortSignal:**
```
[result] disposed: []   errors: ["trigger-mock","memory-mock"]   ← RESOURCE LEAK
[WHY REJECTED]: DB connection + interval handle leaked; "abort" means stop work, not skip cleanup
```

**Two-signal contract (emerges from spike):**

```
Signal 1: pipeline AbortSignal — "stop processing new work"
  Scope: stages and atoms only

Signal 2: DisposalOptions.timeoutMs — "how long to wait for cleanup"
  Scope: disposeAll() only (default: 5000ms)

Rules:
  - Disposal ALWAYS runs after pipeline (happy path + error + abort)
  - Disposal IGNORES pipeline AbortSignal
  - Per-adapter timeout via Promise.race (non-blocking to other adapters)
  - Errors + timeouts routed to onError/onTimeout callbacks (non-throwing)

kit API shape:
  composer.run(atoms, { deps, signal, disposal?: DisposalOptions })
  where DisposalOptions = { timeoutMs?: number; onTimeout?; onError? }
```

Industry alignment: Node.js `server.close()` always completes; K8s `terminationGracePeriodSeconds`
→ SIGKILL; Go `defer` ignores cancelled contexts. Kit's two-signal design matches this consensus.

---

### O5 — Industry comparison

| Framework | Lifecycle ownership | Equivalent to kit option |
|---|---|---|
| Node.js `server.close()` | Server owns; resources registered internally | A (registry) |
| Express / Fastify `onClose` hooks | Plugins register teardown callbacks; framework calls LIFO | **A (exact structural match)** |
| Go `defer` | Deferred to function exit; panic-safe | B (deps-aware) |
| Temporal workflow close | Host calls workflow close; user code can't skip | A (runtime-owned) |
| K8s terminationGracePeriod | Grace period then SIGKILL | Two-signal design (O4) |

**Headline:** Fastify's `onClose` plugin hooks are structurally identical to Option A's
`registry.register(name, teardown)` pattern with LIFO ordering. This is the mature
Node.js ecosystem answer to "framework owns plugin-resource lifetime."

---

## §3. VERDICT

**DisposableRegistry: PARTIAL — B now, A additive**
B (Cat V ADR-v1-V-2) ships as the immediate Composer helper (`isDisposable` + `disposeAll`).
A (`DisposableRegistry`) ships as an additive Cat VI ADR for the extensibility escape hatch.
C rejected.

**Reconstruction: existing retry semantics sufficient**
`resource_expired` error code + Inngest step retry = no new Composer surface.
Cat VIII cf #8 RESOLVED.

**Seam convention: DOCS-ONLY for factory pattern**
`AdapterConvention<C,I>` typed base rejected. `Disposable` + `isDisposable()` IS the
typed cross-adapter convention (already in ADR-v1-V-2). 3x-confirmed seam pattern
worth ADR documentation.

**Abort during cleanup: TWO-SIGNAL DESIGN CONFIRMED**
Pipeline `AbortSignal` scope = stages only. `DisposalOptions.timeoutMs` scope = disposal only.
Disposal always runs; per-adapter timeout; non-throwing abandonment with callback.

---

## §4. CARRY-FORWARDS

**cf #9 from Cat V spike #2 — RESOLVED (PARTIAL)**
ADR direction confirmed: B (Cat V) ships now; A (DisposableRegistry) is Cat VI ADR candidate.
`DisposalOptions` contract confirmed. `isDisposable()` + `disposeAll()` ~20 LOC Composer helper.

**cf #8 from Cat VIII — RESOLVED**
Non-re-readable resources → `resource_expired` error code + existing retry semantics.
No new Composer surface. Adapter implements `refresh()` internally.

**NEW cf — DisposableRegistry opt-in vs mandatory**
Registry is Composer-opt (factory accepts `{ registry? }`) not Composer-mandatory.
Mandatory registry forces every adapter to accept it — imposes cost on lifecycle-free adapters.
Opt-in registry = only adapters wanting external cleanup registration accept it. Lean: opt-in.
Confirm in Cat VI synthesis.

**NEW cf — LIFO vs insertion-order disposal**
Option A used LIFO (Fastify, Node `onClose`); Option B used insertion-order.
When trigger depends on memory, LIFO is correct (trigger closes first).
LIFO is the correct default for `DisposableRegistry`. Confirm in spec.

**NEW cf — TC39 `Symbol.dispose` alignment**
Kit uses `Disposable.close()`. TC39 explicit-resource-management uses `Symbol.dispose`.
Should kit's `Disposable` align for `using adapter = createAdapter()` compatibility (Node 20+)?
Additive change; deferred to Cat VI synthesis.

**NEW cf — `resource_expired` in error taxonomy**
`resource_expired` must join kit's error taxonomy alongside `memory_unavailable`, `secrets_unavailable`.
Candidate set: `resource_expired` / `resource_unavailable` / `resource_stale`.
Lock in Cat VI synthesis ADR for error taxonomy.

---

## §5. STATUS

Throwaway code (4 probes, 5 source files). No kit-core amendments. No ADR drafts.
All 4 probes run clean — exit 0. `bunx tsc --noEmit` exits 0. No `any`. All errors via `Result<T,E>`.

**All observations defensible now (structural — confirmed by probe output):**
- O1: DisposableRegistry A vs B vs C — CONFIRMED; B now, A additive (Cat VI ADR)
- O2: Reconstruction — CONFIRMED; Option C (retry) sufficient; reconstruct() REJECTED
- O3: Seam convention — CONFIRMED; docs-only factory pattern; Disposable IS the typed convention
- O4: Abort during cleanup — CONFIRMED; two-signal design; disposal timeout != pipeline signal
- O5: Industry comparison — Fastify `onClose` = exact structural match to Option A registry

*Author: Executor — 2026-05-11. Branch: master (tip 856d918 at spike start).*
*No external deps. Strict TS; ESM; Bun-runnable. All 4 probes green.*
