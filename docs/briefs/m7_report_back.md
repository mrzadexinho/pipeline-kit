# M7 Report-Back — Rate-Limit Redis + Memory Trio + Composer Internals + Trusted Publishing

> **Status:** Complete — branch NOT pushed; user owns merge decision.
> **Branch:** `m7-rate-limit-redis-and-memory-trio` | **Tip:** `7a07c7f` (12 commits ahead of master tip `805bac3`)
> **Units shipped:** 5 (rate-limit-redis / V-6 memory trio / composer-internals refactor / chores / Trusted Publishing)
> **New packages:** 4 (`@idriszade/rate-limit-redis`, `@idriszade/memory-map`, `@idriszade/memory-orchestr8`, `@idriszade/memory-sqlite`)
> **ADR delta:** 52/55 → 54/55 (V-6 SHIPPED; IX-1 + IX-2 deferred to M8)
> **Test delta:** 1110 passing + 2 skipped → 1176 passing + 2 skipped (+66 net)
> **Coverage:** 88.64 / 80.43 / 90.69 / 89.76 (stmt/branch/fn/line) — all gates met
> **All 5 gates:** PASS

## State at M7 start vs end

| Dimension | M7 start | M7 end |
|-----------|----------|--------|
| Branch tip | `805bac3` (master) | `7a07c7f` (12 commits ahead of master) |
| Tests | 1110 passing + 2 skipped | 1176 passing + 2 skipped (+66 net) |
| Coverage (stmt/branch/fn/line) | 88.44 / 80.72 / 90.22 / 89.62 | 88.64 / 80.43 / 90.69 / 89.76 |
| ADRs | 52/55 | 54/55 |
| Packages (total) | 33 | 37 (+4 new) |

## Commits

| Hash | Subject |
|------|---------|
| `11954ac` | docs(m7): executor brief entry |
| `d5c7ce3` | docs(m7): executor brief drilldown |
| `20bb61c` | feat(rate-limit-redis): scaffold package — package.json, tsconfig, README |
| `e0a909c` | feat(rate-limit-redis): Lua sliding-window store + SHA caching + NOSCRIPT fallback |
| `b5369c0` | test(rate-limit-redis): unit + integration tests covering all 8 acceptance criteria |
| `6e76592` | feat(memory-map): add @idriszade/memory-map — ADR V-6 minimal Map adapter |
| `bf6751f` | feat(memory-orchestr8): add @idriszade/memory-orchestr8 — ADR V-6 orchestr8 adapter with LWW wrap |
| `46d3d0d` | feat(memory-sqlite): add @idriszade/memory-sqlite — ADR V-6 better-sqlite3 adapter with WAL |
| `fca445a` | refactor(core): split apply-budget-ceiling into budget-ceiling + budget-helpers + run-errors (M6 cf #2) |
| `5847a56` | chore(m7): pricing-refresh cadence doc + biome .claude ignore guard (M6 cf #3 + cf #4) |
| `a7ab607` | ci(release): re-enable npm provenance + add Trusted Publishing setup doc |
| `7a07c7f` | chore(changeset): M7 rate-limit-redis + memory trio + composer-internals refactor |

## Per-unit summary

### Unit 1 — @idriszade/rate-limit-redis (M6 cf #1, ADR X-5 distributed tier)

New pack `@idriszade/rate-limit-redis` implementing the distributed `RateLimitStore` interface declared in M6 core. Uses node-redis v5+ with an atomic Lua sliding-window EVAL script, SHA caching (EVALSHA first, NOSCRIPT fallback to inline EVAL), and a `consume(key, limit, window)` returning `Result<RateLimitResult, RateLimitError>`. Integration tests use `@testcontainers/redis` and cover all 8 acceptance criteria (AC-1 basic allow/deny, AC-2 window expiry, AC-3 cross-key isolation, AC-4 NOSCRIPT fallback, AC-5 fast-path EVALSHA, AC-6 disconnect cleanup, AC-7 Result error path, AC-8 property test `count(allowed) <= limit`). Docker was unavailable in the local dev environment at M7 close; integration tests are skip-gated via `SKIP_TESTCONTAINERS` env var; CI is the sole verifier for the Lua-path tests. RF-6 (node-redis v5 connection lifecycle) addressed in README — adapter accepts an already-connected client; caller owns connect/disconnect. Test delta: ~30 unit + integration tests added.

### Unit 2 — V-6 memory adapter trio (ADR V-6)

Three new packs closing ADR V-6. `@idriszade/memory-map` is a zero-dep in-process `MemoryAdapter` backed by a plain `Map`; all operations are synchronous-cast-to-async; 11 tests. `@idriszade/memory-orchestr8` wraps orchestr8-mcp's `SQLiteBackend` via a structural duck-typed `OrchestrBackend` interface (no hard dep on orchestr8's exact types); the LWW wrap is load-bearing: `write(k, v)` fires `delete(id)` then `store(entry)` to override orchestr8's silent first-write-wins behavior; explicit `lww-compliance.test.ts` proves the DELETE-then-INSERT path fired; ~15 tests. `@idriszade/memory-sqlite` wraps better-sqlite3 (bumped to `^12.0.0` from brief's `^11` for shared native binding compatibility with Node 20 LTS) in WAL journal mode with a single `memories` table; WAL mode confirmed in `wal.test.ts`; ~12 tests. All three adapters pass the V-4 LWW compliance check (write K→V1, write K→V2, read K === V2).

### Unit 3 — composer-internals refactor (M6 cf #2)

`packages/core/src/composer/apply-budget-ceiling.ts` (184 LOC mixed-concern file) split into three focused files: `budget-ceiling.ts` (50 LOC — `evaluateBudgetCeiling`, `BudgetCeilingVerdict`), `budget-helpers.ts` (58 LOC — `makeBudget`, `recomputeAccumulation`), and `run-errors.ts` (77 LOC — `sourceIterError`, `toRunError`, shared error constructors). Zero public API change; all imports updated; `composer.ts` remains green at 423 LOC. Full test suite unchanged at 1176 passing. Deviation from brief: brief offered "rename to `composer-internals.ts` OR split per-concern" — the per-concern split was chosen as the cleaner outcome (names now self-document).

### Unit 4 — chores: pricing-refresh cadence doc + biome .claude ignore guard (M6 cf #3 + cf #4)

Two chore items. `packages/cost/docs/refresh-cadence.md` documents the quarterly pricing-table update process (review providers, update PRICES table, bump changeset, update `LAST_UPDATED`). biome dispatch guardrail: updated biome.json to include `"!.claude"` in the ignore list (pattern `"!.claude/**"` caused a biome JSON schema warning; `"!.claude"` is the correct negation form). Convention is now enforced at config level rather than relying on per-dispatch instructions. No test delta from chores.

### Unit 5 — Trusted Publishing re-enable (long-standing post-v0.1.0 TODO)

`release.yml` updated: `id-token: write` permission added to workflow-level `permissions:` block; `NPM_CONFIG_PROVENANCE: true` uncommented (was `TODO(post-v0.1.0)` since M0.5b). Setup guide at `docs/development/trusted-publishing-setup.md` documents the per-package npmjs.com web-UI steps required before the next publish PR merges. Acceptance criterion 5 (provenance attestation visible on npm registry) is a post-merge + post-npmjs-config verification step — out of scope for M7 branch sign-off. RF-5 (per-pkg OIDC pinning to `main` + `release.yml`) documented in the setup guide.

## ADRs implemented

| Item | Subject | Status delta |
|------|---------|-------------|
| V-6 | Memory adapter trio (map / orchestr8 / sqlite) | DEFERRED → SHIPPED |
| X-5 distributed tier | Rate-limit distributed RateLimitStore (Redis adapter) | PARTIAL → COMPLETED (distributed impl shipped) |
| M6 cf #1 | `@idriszade/rate-limit-redis` adapter | OPEN → RESOLVED |
| M6 cf #2 | `apply-budget-ceiling.ts` refactor | OPEN → RESOLVED (split into 3 files) |
| M6 cf #3 | Pricing-refresh cadence doc | OPEN → RESOLVED |
| M6 cf #4 | Biome `.claude` ignore guard | OPEN → RESOLVED (biome.json updated) |
| Trusted Publishing | Provenance auto-emit on publish | OPEN → RE-ENABLED (user-action checklist documented; gated on per-pkg npmjs.com config) |

ADR count: **52/55 → 54/55** (V-6 counted as the new increment; IX-1 + IX-2 deferred to M8).

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| 1 typecheck | PASS | 37 pkgs, 0 errors |
| 2 test | PASS | 1176 passed + 2 skipped (+66 from 1110 baseline); 144 test files |
| 3 biome | PASS | 0 errors / 0 warnings / 0 infos (`.claude` now excluded at config level) |
| 4 build | PASS | 37 pkgs emit dist/ |
| 5 coverage | PASS | 88.64 / 80.43 / 90.69 / 89.76 (all thresholds met; branch -0.29 within tolerance) |

## Package bumps

| Package | Bump | Reason |
|---------|------|--------|
| `@idriszade/rate-limit-redis` | (new) → 0.1.0 | First release — distributed RateLimitStore via Lua sliding-window |
| `@idriszade/memory-map` | (new) → 0.1.0 | First release — minimal Map-backed MemoryAdapter (ADR V-6) |
| `@idriszade/memory-orchestr8` | (new) → 0.1.0 | First release — orchestr8-backed MemoryAdapter with LWW wrap (ADR V-6) |
| `@idriszade/memory-sqlite` | (new) → 0.1.0 | First release — better-sqlite3 WAL MemoryAdapter (ADR V-6) |
| `@idriszade/core` | 0.5.0 → patch | Composer-internals refactor only; zero public API change |

## Carry-forwards into M8

**New from M7:**

1. **testcontainers integration tests for `@idriszade/rate-limit-redis`** — Docker daemon was unavailable locally at M7 close; integration tests are skip-gated; CI is the sole path exercising AC-1..AC-7 via testcontainers. Monitor first CI run on master for any Lua-path failures.
2. **Per-package Trusted Publisher drift discipline** — when new packages are added in future milestones, each requires a corresponding npmjs.com Trusted Publisher config before the next publish PR merges. Track as a checklist item on each milestone brief.

**Outstanding from M6 / earlier milestones:**

- **IX-1 NDJSON+LSP framing module (HEADLINE)** — kit-owned wire-spec at `packages/core/src/wire/`; ~600-900 LOC; M8 should be IX-1-centric with dedicated brain session for parser edge cases.
- **IX-2 Python wire codegen** — Zod → JSON Schema → Pydantic build-time; sequenced after IX-1.
- **M2 CLI carry-forwards** — `pk run` stdin, webhook trigger, full cron parser, `pk scaffold`.
- **`observe-vercel` cost-event wiring** — if Vercel AI SDK integration warranted.
- **`@idriszade/memory-pgvector`** — semantic memory pack; per V-6 non-goal carve-out for v1.
- **Trusted Publishing acceptance criterion 5** — provenance attestation visible on npm registry requires: user configures per-pkg Trusted Publisher on npmjs.com, then next publish PR merges and triggers release.yml. Out of scope for M7 sign-off.

## Risk-flag dispositions

| Flag | Actual outcome |
|------|---------------|
| RF-1 testcontainers cold-start | IN PRACTICE: Docker unavailable locally; integration tests skip-gated via `SKIP_TESTCONTAINERS`; CI is sole verifier for Lua sliding-window path. Monitor first CI run. |
| RF-2 better-sqlite3 native build | RESOLVED: bumped `^11 → ^12` for shared native binding compatibility with Node 20 LTS; non-breaking; prebuilt binaries cover all CI matrix targets. |
| RF-3 orchestr8 LWW wrap | IMPLEMENTED: `write(k,v)` fires `delete(id)` then `store(entry)`; explicit `lww-compliance.test.ts` asserts DELETE-then-INSERT fired and second value wins. |
| RF-4 Lua-script test fidelity | GATED on Docker availability (same as RF-1); ioredis-mock NOT used; testcontainers-redis is the sole Lua verifier. |
| RF-5 Trusted Publishing per-pkg pinning | DOCUMENTED: `docs/development/trusted-publishing-setup.md` specifies pinning to `master` branch + `release.yml` workflow file; `*` wildcard explicitly prohibited. User-action required before next publish. |
| RF-6 node-redis v5 connection lifecycle | DOCUMENTED in README: adapter accepts an already-connected client; caller owns `client.connect()` / `client.disconnect()`. |

## Hand-off

Branch `m7-rate-limit-redis-and-memory-trio` is 12 commits ahead of master and has NOT been pushed. User owns the merge decision and push. Unit 5 acceptance criterion 4 (provenance attestation visible on npm registry) is a post-merge, post-npmjs-config verification step — it cannot be confirmed within M7 scope and is not a blocker for branch sign-off. The 2-step changesets/action publish flow (per `feedback_changesets_two_step_publish`) applies: merging the branch opens a Version Packages PR, and merging that PR triggers the actual publish with provenance. At that point, CI exercises the Lua integration tests in rate-limit-redis for the first time end-to-end.
