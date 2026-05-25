# @idriszade/rate-limit-redis

## 0.2.5

### Patch Changes

- Updated dependencies [dced333]
  - @idriszade/core@0.6.3

## 0.2.4

### Patch Changes

- Updated dependencies [102c627]
  - @idriszade/core@0.6.2

## 0.2.3

### Patch Changes

- Updated dependencies [62c7446]
  - @idriszade/core@0.6.1

## 0.2.2

### Patch Changes

- Updated dependencies [7c46265]
  - @idriszade/core@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [4ca032d]
  - @idriszade/core@0.5.2

## 0.2.0

### Minor Changes

- 7a07c7f: M7: rate-limit-redis distributed adapter; V-6 memory trio (map/orchestr8/sqlite); composer-internals refactor; Trusted Publishing.

  - **New `@idriszade/rate-limit-redis`**: distributed `RateLimitStore` adapter using node-redis v5+ Lua sliding-window EVAL with SHA caching and NOSCRIPT fallback; testcontainers-redis integration tests covering all 8 acceptance criteria; resolves M6 carry-forward #1 and closes ADR X-5 distributed-tier.
  - **New `@idriszade/memory-map`**: minimal in-process `MemoryAdapter` backed by a plain `Map`; V-6 reference adapter #1; closes ADR V-6.
  - **New `@idriszade/memory-orchestr8`**: `MemoryAdapter` backed by orchestr8 SQLiteBackend with first-write-wins LWW wrap; V-6 reference adapter #2; closes ADR V-6.
  - **New `@idriszade/memory-sqlite`**: `MemoryAdapter` backed by better-sqlite3 in WAL mode; V-6 reference adapter #3; closes ADR V-6.
  - **Refactor `@idriszade/core`**: split `apply-budget-ceiling.ts` into `budget-ceiling.ts`, `budget-helpers.ts`, and `run-errors.ts`; zero public API change; resolves M6 carry-forward #2.

### Patch Changes

- Updated dependencies [7a07c7f]
  - @idriszade/core@0.5.1
