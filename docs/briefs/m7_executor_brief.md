# Brief — M7 Rate-Limit Redis + Memory Trio (entry)

> **Summary (decisions front-loaded):**
> - Unit 1: New `@idriszade/rate-limit-redis` pack; distributed `RateLimitStore` via node-redis v5+; atomic Lua sliding-window EVAL; testcontainers-redis fidelity tests; resolves M6 cf #1.
> - Unit 2: V-6 memory adapter trio — `@idriszade/memory-map` + `@idriszade/memory-orchestr8` + `@idriszade/memory-sqlite`; closes ADR V-6; orchestr8 LWW wrap is load-bearing (DELETE-then-INSERT).
> - Unit 3: Refactor `packages/core/src/composer/apply-budget-ceiling.ts` (184 LOC) — rename to `composer-internals.ts` or split per-concern; zero behaviour change; resolves M6 cf #2.
> - Unit 4: Chores — pricing-refresh cadence doc at `packages/cost/docs/refresh-cadence.md` + biome dispatch guardrail convention; resolves M6 cf #3 + cf #4.
> - Unit 5: Trusted Publishing re-enable — per-pkg npmjs.com Trusted Publisher config + `id-token: write` + provenance auto-emit; resolves long-standing post-v0.1.0 TODO.
> - Wave sequencing: Units 1 + 2 parallel (Wave 1); Units 3 + 4 parallel any time; Unit 5 post-master-merge gated on user npmjs.com web-UI action.
> - ADRs after M7: V-6 SHIPPED + 5 cf items RESOLVED → 52/55 → **54/55** (IX-1 + IX-2 deferred to M8).
> - New packages: 4 (`rate-limit-redis`, `memory-map`, `memory-orchestr8`, `memory-sqlite`). Extended: `@idriszade/core` (patch, refactor only).
> - Version bumps: 4 new packs at 0.1.0; `@idriszade/core` patch bump.

**Branch:** `m7-rate-limit-redis-and-memory-trio`
**Author (brain):** 2026-05-21
**Estimated executor effort:** 22-30 hours (2-3 sessions)
**Status:** Ready for executor pickup. Cut `m7-rate-limit-redis-and-memory-trio` from master tip `805bac3`.
**Predecessor:** M6 shipped at `319b8b8` (publish closure Version-Packages merge at `805bac3`).

Per-unit detail in [`m7_executor_brief_units.md`](m7_executor_brief_units.md).

---

## State at M7 start

- Master tip: `805bac3` (M6 publish closure — Version Packages PR #9 merge)
- Tests: 1110 passing + 2 skipped, ~134 test files
- Coverage: 88.44 / 80.72 / 90.22 / 89.62 (stmt / branch / fn / line)
- ADRs: 52/55 shipped
- Packages on npm (key v0.5.0-era): `@idriszade/core@0.5.0`, `@idriszade/cost@0.1.0` (new in M6), `@idriszade/adapter-inngest@0.2.1`, `@idriszade/secrets@0.2.3`, `@idriszade/observe@0.3.1`, `@idriszade/observe-vercel@0.3.1`, `@idriszade/eval@0.1.3`, `@idriszade/cli@0.2.3` (+ 27 transitive patches in M6)

## What does NOT exist yet (confirm before Wave 1)

- `packages/rate-limit-redis/` does NOT exist.
- `packages/memory-map/`, `packages/memory-orchestr8/`, `packages/memory-sqlite/` do NOT exist. Only `packages/memory/` exists (contract + markers only — `src/index.ts`, `src/markers.ts`, `src/types.ts`).
- `packages/core/src/composer/apply-budget-ceiling.ts` is 184 LOC and mixes `applyBudgets`, `makeBudget`, `sourceIterError`, `toRunError` alongside budget-ceiling enforcement (M6 cf #2).
- `packages/cost/docs/refresh-cadence.md` does NOT exist.
- `release.yml` has `NPM_CONFIG_PROVENANCE: true` commented out with `TODO(post-v0.1.0)` (verify line + comment).
- No per-package Trusted Publisher config exists on npmjs.com (user-action required for Unit 5).

---

## Package surface

| Package | Tier | New / Extend | Version |
|---------|------|-------------|---------|
| `@idriszade/rate-limit-redis` | pack | NEW | 0.1.0 |
| `@idriszade/memory-map` | pack | NEW | 0.1.0 |
| `@idriszade/memory-orchestr8` | pack | NEW | 0.1.0 |
| `@idriszade/memory-sqlite` | pack | NEW | 0.1.0 |
| `@idriszade/core` | 1 | extend (refactor only, no API change) | 0.5.0 → patch |

---

## Scope — 5 units (one-liner table)

| Unit | Name | Detail |
|------|------|--------|
| 1 | `@idriszade/rate-limit-redis` | Distributed `RateLimitStore` via node-redis v5+; atomic Lua sliding-window EVAL; testcontainers-redis fidelity tests; see drilldown §unit-1 |
| 2 | V-6 memory adapter trio | `memory-map` + `memory-orchestr8` + `memory-sqlite`; closes ADR V-6; see drilldown §unit-2 |
| 3 | Refactor `apply-budget-ceiling.ts` | Rename to `composer-internals.ts` OR split per-concern; zero behaviour change; see drilldown §unit-3 |
| 4 | Chores: pricing-refresh cadence doc + biome dispatch guardrail | M6 cf #3 + cf #4; see drilldown §unit-4 |
| 5 | Trusted Publishing re-enable | Per-pkg npmjs.com Trusted Publisher config + `id-token: write` + provenance auto-emit; see drilldown §unit-5 |

---

## Wave sequencing

```
Wave 1 (2 parallel sonnet-executor subagents — fully independent):
  ├─ Unit 1: rate-limit-redis  (packages/rate-limit-redis/)
  └─ Unit 2: memory trio       (packages/memory-{map,orchestr8,sqlite}/)

Wave 2 (any time, parallel with Wave 1):
  ├─ Unit 3: apply-budget-ceiling.ts refactor   (packages/core/src/composer/)
  └─ Unit 4: pricing-refresh doc + biome guardrail   (packages/cost/docs/ + meta)

Wave 3 (post-merge to master, requires manual npmjs.com config first):
  └─ Unit 5: Trusted Publishing re-enable   (.github/workflows/release.yml)
```

Dispatch Units 1 + 2 in a single orchestrator message as 2 parallel Agent calls. Units 3 + 4 may dispatch at any time. Unit 5 is gated on user npmjs.com web-UI action.

---

## ADR ledger after M7

| Item | Status after M7 |
|------|----------------|
| V-6 | SHIPPED — memory adapter trio (map / orchestr8 / sqlite) |
| M6 cf #1 (rate-limit-redis) | RESOLVED — distributed RateLimitStore impl |
| M6 cf #2 (apply-budget-ceiling rename) | RESOLVED — refactor |
| M6 cf #3 (pricing refresh cadence) | RESOLVED — doc |
| M6 cf #4 (biome dispatch guardrail) | RESOLVED — convention |
| Trusted Publishing (long-standing) | RESOLVED — provenance auto-emitted on publish |

ADR count: 52/55 → **54/55** (V-6 only; IX-1 + IX-2 deferred to M8).

---

## Carry-forwards expected into M8

- **IX-1 NDJSON+LSP framing module (HEADLINE)** — kit-owned wire-spec implementation at `packages/core/src/wire/`; ~600-900 LOC; M8 should be IX-1-centric with dedicated brain session for parser edge cases
- IX-2 Python wire codegen (Zod → JSON Schema → Pydantic, build-time); sequenced AFTER IX-1
- M2 CLI carry-forwards: `pk run` stdin, webhook trigger, full cron parser, `pk scaffold`
- `observe-vercel` cost-event wiring (if Vercel AI SDK warrants)
- `@idriszade/memory-pgvector` pack (semantic memory; per V-6 non-goal carve-out for v1)
- Per-package Trusted Publisher configuration drift discipline (track when new packages are added)

---

## Risk flags

| Flag | Summary |
|------|---------|
| RF-1: testcontainers cold-start | Redis container ~3s spin-up; gate integration tests with `describe.skipIf(process.env.SKIP_TESTCONTAINERS)` for fast local dev; CI runs full suite |
| RF-2: better-sqlite3 native build | better-sqlite3 has native bindings → prebuilt binaries cover Node 20+ LTS on linux-x64/arm64 + darwin-x64/arm64; verify CI matrix before scope-locking SQLite tests |
| RF-3: orchestr8 LWW wrap discipline | orchestr8-mcp `store()` is silent first-write-wins (per V-4 + Cat V spike #3 α.2); memory-orchestr8 MUST wrap with DELETE-then-INSERT or query-then-update; adapter compliance test write K→V1; write K→V2; read K === V2 |
| RF-4: Lua-script test fidelity | Sliding-window correctness depends on EVAL atomicity; ioredis-mock cannot faithfully emulate Lua; testcontainers-redis is the only path; document this constraint in drilldown |
| RF-5: Trusted Publishing per-pkg pinning | OIDC config MUST pin to `main`/`master` branch + specific workflow file (`release.yml`); pinning to `*` is a supply-chain attack surface |
| RF-6: Node-redis v5 breaking changes from v4 | v5 changed connection lifecycle (`client.connect()` now required even for default config); ensure adapter docs include connection-management example |

---

## Verification gates

```bash
pnpm typecheck                              # Gate 1 — strict mode, all pkgs
pnpm test                                   # Gate 2 — Vitest + fast-check (Lua sliding-window property tests under testcontainers)
pnpm biome check . --max-diagnostics=500    # Gate 3 — BINDING: check not lint
pnpm build                                  # Gate 4 — all packages emit dist/
# Gate 5 — coverage >= 80/70/80/80 per-pkg; >= 85/75/85/85 aggregate (M6 baseline 88.44/80.72/90.22/89.62)
```

Test count target: **1180+** (1110 baseline + ~25 Unit 1 + ~40 Unit 2 trio + ~5 Unit 3 + ~0 Unit 4 chore + ~0 Unit 5).

M7 hard gates:
1. Unit 1: `consume(key, 5, '10s')` 5x returns `allowed: true`; 6th returns `allowed: false` with `retryAfterMs > 0`. Property test: `count(allowed) <= limit` for N concurrent consumers in same window.
2. Unit 2: V-4 LWW compliance — write K→V1, write K→V2, read K === V2 — MUST pass for all three adapters.
3. Unit 2 (orchestr8): silent first-write-wins MUST be wrapped — explicit assertion in `memory-orchestr8` test suite.
4. Unit 3: zero behaviour change — full test suite remains green; `composer.ts` LOC unchanged or reduced.
5. Unit 5: provenance attestation appears on npm registry for at least one re-published package after release.yml change.

---

## Working rules (BINDING)

- **Model routing:** always pass `model:` explicitly (sonnet = executor/CRUD/tests; haiku = trivial git lookups; opus = judgment-heavy design).
- **Parallel dispatch:** Wave 1 = 2 parallel Agent calls in a single orchestrator message.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Out-of-scope files untouched:** `.claude/commands/brain.md`, `.claude/projects/`, `.clone/`.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **Fake-timer constraint:** pin system time + advance <= 2_000ms per step. No large single advances.
- **File-size limits:** 300 LOC soft, 500 LOC hard.
- **Result<T,E> at all public stage boundaries.** No thrown errors crossing the API.
- **No `any` in stage signatures.**
- **Redis client = `redis` (node-redis v5+); ioredis is NOT permitted in new packages.**
- **SQLite client = `better-sqlite3` for `memory-sqlite`; sql.js (via orchestr8-mcp) for `memory-orchestr8`; zero deps for `memory-map`.**
- **Redis integration tests use `@testcontainers/redis` exclusively — no mock layer for Lua scripts.**
- **Subagent branch discipline:** specify branch `m7-rate-limit-redis-and-memory-trio` explicitly in each subagent brief.
- **Changeset required** for each package version bump (`pnpm changeset`).
- Per-unit detail including type shapes, acceptance criteria, and industry references: see [`m7_executor_brief_units.md`](m7_executor_brief_units.md).

---

## Changeset guidance

```bash
pnpm changeset
# Select: @idriszade/rate-limit-redis (minor — first release; will publish as 0.1.0)
#         @idriszade/memory-map (minor — first release)
#         @idriszade/memory-orchestr8 (minor — first release)
#         @idriszade/memory-sqlite (minor — first release)
#         @idriszade/core (patch — composer refactor only)
# Summary: "M7: rate-limit-redis distributed adapter; V-6 memory trio (map/orchestr8/sqlite); composer-internals refactor; Trusted Publishing"
```

2-step publish flow (per `feedback_changesets_two_step_publish`): merging `.changeset/*.md` opens a Version Packages PR; merging that PR triggers actual publish. Expect 2+ `release.yml` runs.

---

## Report-back format

On completion, executor writes `docs/briefs/m7_report_back.md` with:
- Commits table (hash + description, one row per commit)
- Per-unit summary paragraph
- ADRs implemented (table: ADR / subject / status delta)
- Gates table (gate name / status / detail)
- Package bumps table
- Carry-forwards (new from M7 + outstanding from M6)

---

*M7 brief locked 2026-05-21. Cut m7-rate-limit-redis-and-memory-trio from 805bac3. Confirm 1110+2 test baseline green before Wave 1.*
