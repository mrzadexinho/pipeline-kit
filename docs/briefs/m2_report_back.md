# M2 Report-Back — Durable Execution + CLI DX

> **Status:** Complete
> **Branch:** `m2-durable-execution`
> **Commits:** 13 M2 commits + Task 14 commit (list below)
> **Test count:** 709 passing (up from 562 at M1; +147 new)

## Commits

| Commit | Description |
|--------|-------------|
| `3d96b35` | chore: scaffold @idriszade/adapter-inngest package |
| `b5641b8` | feat(core): extend TriggerAdapter with start/stop lifecycle + TriggerHandler type |
| `e92d998` | feat(adapter-inngest): PipelineContext ↔ Inngest context mapping (I-4) |
| `477b758` | feat(adapter-inngest): kitStep() + NonRetryableError mapping (I-2, I-3) |
| `daa16ab` | feat(adapter-inngest): createKitFunction factory (I-1, I-7) |
| `513b7ae` | feat(adapter-inngest): HRP <=> step.waitForEvent bridge (I-5) |
| `2348a70` | feat(adapter-inngest): kitFanOut() helper (IV-1, IV-7) |
| `cbea3f0` | feat(adapter-inngest): InngestTriggerAdapter (IV-3, IV-2) |
| `fe466dc` | fix(adapter-inngest): unique fnId per trigger registration |
| `5692b65` | feat(adapter-inngest): complete barrel, test gaps, README with I-6 docs |
| `173155c` | feat(cli): pipeline discovery + pk inspect command (VII-2) |
| `45baa94` | feat(cli): pk run + pk dev commands (VII-2, IV-3) |
| `6b3129c` | feat(cli): arg parser + barrel + CLI tests (VII-2) |

## What shipped

### @idriszade/adapter-inngest

- `kitStep()` — Result→throw bridge; unwraps `Result<T, StageError>` from
  `step.run()`, converts non-retryable codes to `NonRetriableError` (ADR I-2, I-3)
- `kitFanOut()` — parallel fan-out via `step.invoke` per item (ADR IV-1, IV-7)
- `createHrpCheckpoint()` — HRP ↔ `step.waitForEvent` bridge with timeout
  policy and nullable result handling (ADR I-5)
- `createKitFunction()` — factory wrapping `inngest.createFunction()` with
  TriggerConfig mapping, RunGuard→concurrency, PipelineContext construction,
  and DisposableRegistry finally-block (ADR I-1, I-7)
- `InngestTriggerAdapter` — `TriggerAdapter` implementation with per-trigger
  `start()`/`stop()` lifecycle and `KitTriggerEnvelope` dispatch (ADR IV-2, IV-3)
- `mapInngestContext()` — builds `PipelineContext` from Inngest event + runId (ADR I-4)
- `mapToNonRetryable()` — maps `StageErrorCode` to `NonRetriableError` (ADR I-3)
- README with I-6 replay-safety documentation

### @idriszade/cli

- `discoverPipelines()` — recursive `*.pipeline.{ts,js,mjs}` discovery via
  `readdir` with duck-type validation
- `findPipelineById()` — single-pipeline lookup by id
- `pk inspect <id>` — print pipeline `describe()` as 2-space-indented JSON
- `pk run <id>` — load pipeline, parse optional `--input` JSON, execute, print result
- `pk dev` — watch mode + local cron triggers (interval-based polling)
- `main()` — arg parser entry point wired to `pk` bin

### @idriszade/core extension

- `TriggerHandler<T>` type — callback signature for trigger adapters
- `TriggerAdapter` start()/stop() lifecycle contract

## ADRs implemented

| ADR | Subject |
|-----|---------|
| I-1 | Inngest as durable execution runtime; kitStep as kit integration point |
| I-2 | Result→throw bridge in kitStep |
| I-3 | NonRetriableError mapping for StageErrorCode |
| I-4 | PipelineContext ↔ Inngest context mapping |
| I-5 | HRP review checkpoint via step.waitForEvent |
| I-6 | Replay-safety constraint; no side-effects outside step.run |
| I-7 | createKitFunction factory; DisposableRegistry lifecycle |
| IV-1 | Fan-out = adapter pattern (kitFanOut) |
| IV-2 | TriggerAdapter start/stop lifecycle |
| IV-3 | InngestTriggerAdapter implementation |
| VII-2 | Code-first CLI (pk inspect / pk run / pk dev) |

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| Tests | PASS | 709 passing, 11 pre-existing store-sqlite ABI failures |
| Typecheck | PASS | 0 errors across all 21 packages |
| Lint | PASS | 0 errors (14 warnings, non-blocking) |
| Format | PASS | No fixes needed |
| Build | PASS | All 21 packages compiled cleanly |

## Pre-existing issues

- **store-sqlite**: 11 test failures — `better-sqlite3` compiled against
  `NODE_MODULE_VERSION 141`, current Node requires `147`. Not M2 scope.
  Fix: `pnpm rebuild better-sqlite3` or Node version pin.

## Carry-forwards to M3

- `stdin` input mode for `pk run` (no `--input` flag needed for piped data)
- Webhook local trigger (`http.createServer`) for `pk dev`
- Full cron expression parsing (currently supports simple interval polling)
- `pk trace` command — deferred to M3 per brief
- `pk scaffold` — pipeline generator (deferred)
