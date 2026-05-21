# M7 Executor Brief — Unit Drilldown

> This document is the per-unit detail companion to [`m7_executor_brief.md`](m7_executor_brief.md).
> Read the entry brief first for wave sequencing, risk flags, working rules, and verification gates.
> Per-unit working rules apply per the entry brief.

---

## Unit 1 — `@idriszade/rate-limit-redis`

### Objective

Ship the distributed `RateLimitStore` adapter backed by Redis. Completes ADR X-5 (distributed tier).
Uses the same `RateLimitStore` + `RateLimitResult` interfaces already exported from `@idriszade/core`
(confirmed in `packages/core/src/trigger.ts` lines 8-17).

### Files touched

| File | Action |
|------|--------|
| `packages/rate-limit-redis/package.json` | NEW — mirror `packages/secrets-env/package.json` skeleton |
| `packages/rate-limit-redis/tsconfig.json` | NEW |
| `packages/rate-limit-redis/src/index.ts` | NEW — public API barrel |
| `packages/rate-limit-redis/src/types.ts` | NEW — `RedisRateLimitStoreOptions` |
| `packages/rate-limit-redis/src/lua.ts` | NEW — `SLIDING_WINDOW_SCRIPT` const |
| `packages/rate-limit-redis/src/store.ts` | NEW — `RedisRateLimitStore` class + factory |
| `packages/rate-limit-redis/tests/store.test.ts` | NEW — unit tests (SHA caching, NOSCRIPT fallback) |
| `packages/rate-limit-redis/tests/integration.test.ts` | NEW — testcontainers integration + property tests |
| `packages/rate-limit-redis/README.md` | NEW — peer dep + connection-ownership docs |

### Type shapes

```ts
// packages/rate-limit-redis/src/types.ts

import type { RedisClientType } from 'redis';

export interface RedisRateLimitStoreOptions {
  client: RedisClientType;        // node-redis v5+ client (already-connected)
  keyPrefix?: string;             // default 'pk:ratelimit:'
}
```

```ts
// packages/rate-limit-redis/src/store.ts

import type { RateLimitStore, RateLimitResult } from '@idriszade/core';
import type { RedisRateLimitStoreOptions } from './types.js';

export class RedisRateLimitStore implements RateLimitStore {
  constructor(opts: RedisRateLimitStoreOptions);
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export function createRedisRateLimitStore(opts: RedisRateLimitStoreOptions): RedisRateLimitStore;
```

### Lua script (`src/lua.ts`)

Exported as `SLIDING_WINDOW_SCRIPT: string` constant. Script body:

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfterMs = math.ceil((tonumber(oldest[2]) + window) - now)
return {0, 0, retryAfterMs}
```

### Implementation rules

- `redis` (node-redis v5+) only. ioredis is NOT permitted.
- Accept an already-connected `RedisClientType`; do NOT manage connection lifecycle inside the store.
- Load script SHA on first `consume()` call via `client.scriptLoad(SLIDING_WINDOW_SCRIPT)`. Cache the
  returned SHA on the instance. On subsequent calls, invoke `client.evalSha(sha, ...)`. If Redis returns
  a `NOSCRIPT` error (e.g. after server restart), catch it, fall back to `client.sendCommand(['EVAL', script, ...])`,
  and refresh the cached SHA.
- `member` argument = `` `${now}-${crypto.randomUUID()}` `` — ensures ZADD uniqueness under concurrent
  identical-millisecond consumes.
- `PEXPIRE` sets key TTL = `windowMs` — prevents unbounded ZSET growth on cold keys.
- Result envelope: `{ allowed: result[0] === 1, remaining: result[1], retryAfterMs: result[2] }`.
- TSDoc on `consume()`: reference ADR X-5 (distributed-tier completion) and the in-process counterpart
  `InProcessRateLimitStore` in `@idriszade/core`.

### Acceptance criteria

1. `consume(key, 5, 10_000)` called 5 times returns `allowed: true` with `remaining` decrementing 4->3->2->1->0.
2. 6th `consume` in same window returns `allowed: false`, `remaining: 0`, and `retryAfterMs > 0` and `<= windowMs`.
3. Testcontainers integration: after real `windowMs` elapses, next `consume` returns `allowed: true` again.
4. Property test (fast-check + testcontainers): for N concurrent consumers in same window, `count(allowed) <= limit`.
5. SHA caching: second call to `consume` does NOT retransmit full script body; assert via
   `client.scriptExists([cachedSha])` returning `[true]`.
6. NOSCRIPT fallback: call `client.scriptFlush()` between two consumes; second call succeeds (`allowed: true`).
7. ZSET cleanup: after `windowMs` elapses, `ZCARD key === 0` (PEXPIRE honoured by container Redis).
8. README documents required `redis` v5+ peer dep and that callers own connection lifecycle.

### Dependencies

Wave 1. Independent (parallel with Unit 2).

### ADR ref

M6 carry-forward #1; ADR X-5 distributed-tier completion.

### Industry reference points

- Upstash `@upstash/ratelimit` Lua scripts (`upstash/ratelimit-js` on GitHub) — canonical sliding-window
  ZREMRANGEBYSCORE + ZCARD + ZADD pattern in production use.
- Redis official "Rate limiting" pattern docs — ZSET sliding-window reference.
- node-redis v5 `client.scriptLoad()` / `client.evalSha()` API docs.

---

## Unit 2 — V-6 Memory Adapter Trio

### Objective

Ship three reference `MemoryAdapter` packages per ADR V-6. All implement the `MemoryAdapter` interface
confirmed in `packages/memory/src/types.ts`. `Disposable` and `Listable` are confirmed in
`packages/memory/src/markers.ts`.

---

### §2a — `@idriszade/memory-map`

#### Files touched

| File | Action |
|------|--------|
| `packages/memory-map/package.json` | NEW |
| `packages/memory-map/tsconfig.json` | NEW |
| `packages/memory-map/src/index.ts` | NEW — public barrel |
| `packages/memory-map/src/adapter.ts` | NEW — `MapMemoryAdapter` class + factory |
| `packages/memory-map/tests/adapter.test.ts` | NEW — unit + property tests |
| `packages/memory-map/README.md` | NEW |

#### Type shapes

```ts
// packages/memory-map/src/adapter.ts

import type { MemoryAdapter, MemoryError } from '@idriszade/memory';
import type { Result } from '@idriszade/core';

export interface MapMemoryAdapterOptions {
  namespace?: string;             // optional construction-time namespace per V-5
}

export class MapMemoryAdapter implements MemoryAdapter {
  constructor(opts?: MapMemoryAdapterOptions);
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

export function createMapMemoryAdapter(opts?: MapMemoryAdapterOptions): MapMemoryAdapter;
```

#### Implementation rules

- Zero production deps. Backing `Map<string, string>`.
- Namespace applied as `${namespace}::${key}` when `namespace` is set; bare `key` otherwise.
- LWW trivially via `Map.set` — no wrap needed.
- NO `Disposable`, NO `Listable` (per V-6: Map adapter is the minimal canonical test fixture).

---

### §2b — `@idriszade/memory-orchestr8`

#### Files touched

| File | Action |
|------|--------|
| `packages/memory-orchestr8/package.json` | NEW — peer dep `orchestr8-mcp` |
| `packages/memory-orchestr8/tsconfig.json` | NEW |
| `packages/memory-orchestr8/src/index.ts` | NEW — public barrel |
| `packages/memory-orchestr8/src/adapter.ts` | NEW — `Orchestr8MemoryAdapter` class + factory |
| `packages/memory-orchestr8/tests/adapter.test.ts` | NEW — unit tests |
| `packages/memory-orchestr8/tests/lww-compliance.test.ts` | NEW — explicit LWW assertion test |
| `packages/memory-orchestr8/README.md` | NEW |

#### Type shapes

```ts
// packages/memory-orchestr8/src/adapter.ts

import type { SQLiteBackend } from 'orchestr8-mcp/storage/sqlite';
import type { MemoryAdapter, MemoryError, Listable, Disposable } from '@idriszade/memory';
import type { Result } from '@idriszade/core';

export interface Orchestr8MemoryAdapterOptions {
  backend: SQLiteBackend;          // already-initialised
  namespace?: string;
}

export class Orchestr8MemoryAdapter implements MemoryAdapter, Disposable, Listable {
  constructor(opts: Orchestr8MemoryAdapterOptions);
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
  list(namespace: string): Promise<Result<string[], MemoryError>>;
  close(): Promise<void>;
}

export function createOrchestr8MemoryAdapter(
  opts: Orchestr8MemoryAdapterOptions,
): Orchestr8MemoryAdapter;
```

#### Implementation rules

- Peer dep: `orchestr8-mcp`. Accept already-initialised `SQLiteBackend`.
- LWW wrap (BINDING): `write(k, v)` first calls `backend.retrieve(k)`. If present, calls
  `backend.delete(k)` then `backend.store(k, v)`. If absent, calls `backend.store(k, v)` directly.
  Per Cat V spike #3 section alpha.2: orchestr8 `store()` is silent-first-write-wins; kit MUST enforce LWW.
- `list(namespace)` calls `backend.list(namespace)`; returns alphabetically sorted key array.
- `close()` calls `backend.close()`.
- Footprint: suitable for <10k KV entries per ADR V-6.

---

### §2c — `@idriszade/memory-sqlite`

#### Files touched

| File | Action |
|------|--------|
| `packages/memory-sqlite/package.json` | NEW — dep `better-sqlite3@^11` |
| `packages/memory-sqlite/tsconfig.json` | NEW |
| `packages/memory-sqlite/src/index.ts` | NEW — public barrel |
| `packages/memory-sqlite/src/adapter.ts` | NEW — `SqliteMemoryAdapter` class + factory |
| `packages/memory-sqlite/src/schema.sql` | NEW — DDL |
| `packages/memory-sqlite/tests/adapter.test.ts` | NEW — unit + property tests |
| `packages/memory-sqlite/tests/wal.test.ts` | NEW — WAL perf sanity test |
| `packages/memory-sqlite/README.md` | NEW |

#### Type shapes

```ts
// packages/memory-sqlite/src/adapter.ts

import Database from 'better-sqlite3';
import type { MemoryAdapter, MemoryError, Listable, Disposable } from '@idriszade/memory';
import type { Result } from '@idriszade/core';

export interface SqliteMemoryAdapterOptions {
  dbPath: string;                  // ':memory:' or file path
  namespace?: string;
  walMode?: boolean;               // default true
}

export class SqliteMemoryAdapter implements MemoryAdapter, Disposable, Listable {
  constructor(opts: SqliteMemoryAdapterOptions);
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
  list(namespace: string): Promise<Result<string[], MemoryError>>;
  close(): Promise<void>;
}

export function createSqliteMemoryAdapter(
  opts: SqliteMemoryAdapterOptions,
): SqliteMemoryAdapter;
```

#### Implementation rules

- Dep: `better-sqlite3@^11` (synchronous native bindings).
- Schema (`src/schema.sql`): `CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, namespace TEXT, created_at INTEGER, updated_at INTEGER)`.
- LWW via `INSERT OR REPLACE INTO memory (key, value, namespace, created_at, updated_at) VALUES (?, ?, ?, ?, ?)` — native SQLite LWW; no manual wrap needed.
- WAL mode: `PRAGMA journal_mode=WAL` on connect when `walMode: true` (default).
- `list(namespace)` returns keys `WHERE namespace = ?` ORDER BY `key ASC`.
- `close()` calls `db.close()`.
- Footprint: suitable for >10k entries per ADR V-6.

---

### Acceptance criteria (all three adapters)

1. V-4 LWW compliance: `write(k, 'V1'); write(k, 'V2'); read(k)` equals `ok('V2')` — MUST pass for all three.
2. `read` on absent key returns `ok(null)`.
3. `write(k, '')` followed by `read(k)` returns `ok('')` (empty string distinct from absent).
4. `memory-orchestr8` LWW wrap explicitly tested: mock `backend.store` to return stale on second call;
   assert adapter still surfaces new value (proves the delete+re-store path fires).
5. Listable adapters (orchestr8 + sqlite): `list(namespace)` returns alphabetically sorted key array;
   absent namespace returns `ok([])`.
6. Disposable adapters (orchestr8 + sqlite): after `close()`, `read` and `write` return
   `err({ code: 'memory_unavailable' })`.
7. WAL test: 100 sequential `write` calls to `memory-sqlite` (file path) complete in <50ms.
8. Property test: `write(k, v); read(k) === v` for any `(k, v)` where `k` matches
   `^[a-z0-9][a-z0-9:_-]*$` and `v` is any UTF-8 string.

### Dependencies (Unit 2)

Wave 1. All three sub-packages are independent (parallel with each other and with Unit 1).

### ADR ref

V-6 (reference-adapter trio); V-4 (LWW); V-2 (Disposable); V-3 (Listable).

### Industry reference points

- `better-sqlite3` README — synchronous-native binding rationale; WAL mode PRAGMA pattern.
- orchestr8-mcp `SQLiteBackend` source — `store()` / `retrieve()` / `delete()` / `list()` verb set.
- LiteFS WAL patterns — durability guarantees of WAL mode for file-backed SQLite.

---

## Unit 3 — Refactor `apply-budget-ceiling.ts`

### Objective

Split `packages/core/src/composer/apply-budget-ceiling.ts` (185 LOC, confirmed) into three focused
files. Zero behaviour change. Public API surface unchanged.

### Files touched

| File | Action |
|------|--------|
| `packages/core/src/composer/apply-budget-ceiling.ts` | DELETE (contents redistributed below) |
| `packages/core/src/composer/budget-ceiling.ts` | NEW — `applyBudgetCeiling` + OTel span logic |
| `packages/core/src/composer/budget-helpers.ts` | NEW — `applyBudgets` + `makeBudget` |
| `packages/core/src/composer/run-errors.ts` | NEW — `StageCause`, `AtomMeta`, `sourceIterError`, `toRunError` |
| `packages/core/src/composer/composer.ts` | EDIT — update import paths |
| `packages/core/src/composer/index.ts` | EDIT — update re-exports if any |

### Implementation rules

- `budget-ceiling.ts` imports from `budget-helpers.ts` and `run-errors.ts` as needed — no circular imports.
- Each split file should be 30-80 LOC.
- Re-export `StageCause` and `AtomMeta` from `run-errors.ts` (they are private to the composer module
  but used across split files).
- `composer.ts` import lines update to reference new file names; no other changes to `composer.ts`.
- `packages/core/src/index.ts` public exports are UNCHANGED — verify with `git diff` on that file.

### Acceptance criteria

1. `pnpm test` fully green — zero behaviour delta.
2. Each split file is 80 LOC or fewer.
3. `pnpm typecheck` exits 0.
4. `git diff packages/core/src/index.ts` shows no export changes.
5. `apply-budget-ceiling.ts` no longer exists (deleted).

### Dependencies

Wave 2. No feature dependency, but schedule after Wave 1 to avoid merge conflicts on composer imports.

### ADR ref

M6 carry-forward #2 (file-size discipline; `apply-budget-ceiling.ts` approached the 184-LOC mark
post-Unit-4 additions in M6).

### Industry reference points

N/A — internal refactor.

---

## Unit 4 — Chores Bundle

### §4a — Pricing-refresh cadence doc

**File:** `packages/cost/docs/refresh-cadence.md` (NEW).

Content requirements (5 required sections):
1. **Cadence** — quarterly review trigger; who is responsible.
2. **CHANGELOG discipline** — every `PRICES` table change requires a CHANGELOG entry in the same commit.
3. **`LAST_UPDATED` discipline** — must be bumped in same commit as `PRICES` table; never drift.
4. **Consumer responsibility** — pin `@idriszade/cost` version for billing accuracy; rationale.
5. **`customPrices` override workflow** — code example showing per-model override; reference README.

Confirmed from `packages/cost/README.md`: `LAST_UPDATED: 2026-05-20` is already the constant in the
package; `customPrices` override is documented in README. The new doc extends this stance into a
process reference.

### §4b — Biome `.claude/**` ignore guard

**File:** `biome.json` (EDIT).

Confirmed shape: `biome.json` uses `files.includes` array with `"!..."` negative patterns (lines 11-19).
Add `"!.claude/**"` to the `files.includes` array alongside the existing negations.

After edit the array should contain: `"**"`, `"!**/node_modules"`, `"!**/dist"`, `"!**/coverage"`,
`"!**/.changeset"`, `"!**/*.md"`, `"!research"`, `"!**/spikes"`, `"!.claude/**"`.

### Acceptance criteria

1. `packages/cost/docs/refresh-cadence.md` exists with all 5 required sections.
2. `biome.json` `files.includes` contains `"!.claude/**"`.
3. `pnpm biome check . --max-diagnostics=500` exits 0 and emits no paths under `.claude/`.
4. M6 carry-forwards #3 + #4 resolved.

### Dependencies

Wave 2. Independent.

### ADR ref

M6 carry-forwards #3 (pricing cadence) + #4 (biome ignore guard).

### Industry reference points

- LiteLLM `model_prices_and_context_window.json` CHANGELOG — precedent for committing pricing
  snapshot updates with explicit CHANGELOG entries.

---

## Unit 5 — Trusted Publishing Re-enable

### Objective

Uncomment `NPM_CONFIG_PROVENANCE: true` (confirmed commented at `.github/workflows/release.yml` line 57),
confirm `permissions` block, and produce the user-action checklist document for per-package npmjs.com
Trusted Publisher configuration.

### Files touched

| File | Action |
|------|--------|
| `.github/workflows/release.yml` | EDIT — uncomment provenance line |
| `docs/development/trusted-publishing-setup.md` | NEW — user-action checklist |

### Workflow changes

1. Uncomment `NPM_CONFIG_PROVENANCE: true` (remove `# ` prefix from line 57 and the TODO block comment
   above it, or retain the comment block for history — executor's discretion on comment cleanup).
2. The `permissions` block at the workflow level already contains `id-token: write` and `contents: write`
   (confirmed at lines 9-12). No change needed.
3. Do NOT pin branch/workflow inside the `.yml` — that config lives on npmjs.com web UI, documented in
   the new setup doc.

### User-action checklist (write to `docs/development/trusted-publishing-setup.md`)

Required sections:
1. Prerequisites — all packages must exist on npm before configuring Trusted Publishing.
2. Per-package steps — visit `npmjs.com/package/@idriszade/<pkg>` then Settings then Trusted Publishers
   then Add. Values: provider GitHub Actions; org `mrzadexinho`; repo `pipeline-kit`; workflow file
   `.github/workflows/release.yml`; environment field blank (or `production` if configured).
3. Complete package list (as of post-M7): `core`, `cost`, `adapter-inngest`, `secrets`, `secrets-env`,
   `secrets-sops`, `secrets-oidc`, `memory`, `observe`, `observe-vercel`, `eval`, `eval-scorers`,
   `cli`, all `store-*` / `process-*` / `serve-*` / `source-*` packages, `memory-map`,
   `memory-orchestr8`, `memory-sqlite`, `rate-limit-redis`.
4. Verification — after ALL packages configured, merge this PR; next `release.yml` run emits provenance;
   verify via `npm view @idriszade/<pkg>` checking `dist.integrity` and provenance fields.
5. Rollback — if provenance attestation fails post-configure, comment `NPM_CONFIG_PROVENANCE: true`
   back out; diagnose via GHA run logs.

### Acceptance criteria

1. `.github/workflows/release.yml` has `NPM_CONFIG_PROVENANCE: true` uncommented and active.
2. `permissions` block retains `id-token: write` + `contents: write` (already present; verify only).
3. `docs/development/trusted-publishing-setup.md` exists with all 5 required sections.
4. After next post-M7 publish: at least one package shows verified provenance on npm registry
   (verify via `npm view @idriszade/<pkg>`). This criterion is user-verified post-merge.

### Dependencies

Wave 3. Gated on user npmjs.com web-UI action (per-package Trusted Publisher configuration must
precede the next publish run, or the publish will fail). Executor writes the files; user completes
the web-UI steps before merging.

### ADR ref

Long-standing carry-forward from M0.5b npm-publish memory; ADR X-5 SLSA provenance.

### Industry reference points

- GitHub Changelog: "npm trusted publishing with OIDC" (GA 2025-07-31) — OIDC token flow for npm.
- npmjs.com Trusted Publishers docs — per-package configuration UI and trust policy fields.
- OpenSSF SLSA provenance level 2 — what `NPM_CONFIG_PROVENANCE: true` produces via
  `sigstore/npm-provenance`.

---

*Drilldown companion to m7_executor_brief.md. Working rules, wave sequencing, risk flags, and verification gates are in the entry brief.*
