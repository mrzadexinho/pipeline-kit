# M1 Report-back — Core v1 Foundation

## Summary

M1 shipped 29 of 55 v1 ADRs across 3 packages. Extended
`@idriszade/core` with 10 new types, 8 new files, PipelineContext v1
fields, Composer budget/buffer/disposal, definePipeline() DX layer.
Shipped `@idriszade/secrets` (SecretsResolver + 3 wrappers) and
`@idriszade/memory` (MemoryAdapter + Listable/Disposable markers).
All 5 gates green on M1 code; pre-existing store-sqlite native module
failures (ERR_DLOPEN_FAILED on Node 26) are unrelated.

## Tasks completed (0-14)

| # | Task | Status | Commit |
|---|------|--------|--------|
| 0 | State verify + branch | DONE | branch created |
| 1 | StageErrorCode taxonomy | DONE | `7856ac9` |
| 2 | UsageAccumulator + CostBudget | DONE | `103c7c9` |
| 3 | Trigger + RunGuard + Envelope | DONE | `0b26f4d` |
| 4 | PipelineContext v1 fields | DONE | `ecb6aee` |
| 5 | SerializableContext + wire helpers | DONE | `cdab8c7` |
| 6 | DisposableRegistry + DisposalOptions | DONE | `857b3f5` |
| 7 | Composer v1 extensions | DONE | `4bc4417` + `537f4e1` |
| 8 | Named patterns | DONE | `6be527f` |
| 9 | definePipeline + describe enriched | DONE | `b67e3fe` |
| 10 | Misc core (PII + annotations) | DONE | `fd63fea` |
| 11 | Core barrel export + tests | DONE | `5db8154` |
| 12 | @idriszade/secrets | DONE | `3ee2104` |
| 13 | @idriszade/memory | DONE | `608b104` |
| 14 | Integration + gates | DONE | (this commit) |

## 5-gate verification

```
pnpm typecheck    — PASS (0 errors, 20 packages)
pnpm lint         — PASS (0 M1 errors; 2 pre-existing in serve-email/mcp)
pnpm test         — 562 pass, 11 fail (all store-sqlite ERR_DLOPEN_FAILED)
bun test          — 307 pass, 0 fail (M1 packages only)
type tests        — PASS (patterns, context, definePipeline)
```

## Test counts (before -> after)

- Baseline (M0.5): 437 pass
- After M1: 562 pass (+125 new)
- Target: 500+ — EXCEEDED
- Bun: 307 pass, 0 fail

## Files added / modified

### New files (16 source + 2 package scaffolds)

| File | LOC | Purpose |
|------|-----|---------|
| `core/src/stage-error.ts` | 58 | StageErrorCode 19-code taxonomy |
| `core/src/usage.ts` | 26 | UsageAccumulator + CostBudget |
| `core/src/trigger.ts` | 32 | TriggerConfig + RunGuard + Envelope |
| `core/src/serializable-context.ts` | 87 | Wire context for cross-runtime |
| `core/src/disposable.ts` | 72 | DisposableRegistry + Disposable |
| `core/src/patterns.ts` | 10 | Gate, Aggregate, AgentProcess aliases |
| `core/src/define-pipeline.ts` | 97 | definePipeline + enriched describe |
| `core/src/pii.ts` | 11 | REDACT_TAG + SECRET_TAG constants |
| `secrets/src/types.ts` | 22 | SecretsResolver contract |
| `secrets/src/version-aware.ts` | 39 | Cache + version tracking wrapper |
| `secrets/src/ttl.ts` | 30 | TTL-based invalidation wrapper |
| `secrets/src/scope.ts` | 20 | Namespace prefix facade |
| `secrets/src/index.ts` | 4 | Barrel export |
| `memory/src/types.ts` | 18 | MemoryAdapter contract |
| `memory/src/markers.ts` | 15 | Listable + isListable guard |
| `memory/src/index.ts` | 6 | Barrel + Disposable re-export |
| **Total prod** | **547** | |

### Modified files (4)

| File | LOC | Changes |
|------|-----|---------|
| `core/src/context.ts` | 107 | v1 fields + two-plane annotations |
| `core/src/composer/composer.ts` | 447 | Budget/disposal/buffer extensions |
| `core/src/pipeline-types.ts` | 53 | RunOptions v1 fields |
| `core/src/index.ts` | 126 | Barrel exports for all new types |

No file exceeds 500 lines (hard limit). `composer.ts` at 447 is the
largest; buffer-all extraction candidate for M2.

## Branch state

- Branch: `m1-core-foundation`
- Commits ahead of master: 14 (Tasks 1-14)
- Uncommitted: lint fixes + integration test + report-back (this commit)
- Not pushed (awaiting brain authorization)

## OPEN QUESTIONS

1. **composer.ts at 447 LOC** — past 300 soft limit. The buffer-all
   block (~65 LOC) is a candidate for extraction to `runBufferAll()` if
   M2 adds count/time modes. No action needed now.

2. **store-sqlite test failures** — ERR_DLOPEN_FAILED on Node 26.0.0
   (better-sqlite3 compiled against wrong NODE_MODULE_VERSION). Not M1
   scope. Needs `pnpm rebuild better-sqlite3` or Node version pin.

## M2 readiness assessment

M1 clears the dependency bottleneck. All M2 packages can now import
the v1 types they need:

- `adapter-inngest` can import StageErrorCode, DisposableRegistry,
  CostBudget, TriggerConfig, RunGuard
- `serve-a2a` can import Process (AgentProcess pattern)
- `observe` can import UsageAccumulator, REDACT_TAG/SECRET_TAG
- `cost` can import CostBudget, UsageAccumulator
- `cli` can import definePipeline, DefinedPipeline, describe()
- `secrets-env/sops/oidc` can import SecretsResolver from @idriszade/secrets
- `memory-map/orchestr8/sqlite` can import MemoryAdapter from @idriszade/memory

M2's 10+ packages are fully parallelizable. No remaining M1 blockers.
