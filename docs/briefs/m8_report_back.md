# M8 Report-Back — Cross-Runtime Wire Module

**Branch:** `m8-wire-framing`
**Base:** `cbbd048` (post-M7 cleanup)
**HEAD:** `d83ea74`
**Commits:** 8 (see table below)
**Status:** Ready for PR / merge / publish. ADR IX-1 SHIPPED; ADR IX-2 SHIPPED as impl-tooling.

---

## Summary

M8 ships the kit-owned cross-runtime wire spec impl and the Python codegen pipeline that feeds it. ADR IX-1's two wire modes (NDJSON default + LSP `Content-Length` opt-in) now have full TypeScript codecs at `packages/core/src/wire/` with strict adversarial-fixture closure (spike-3 `print(flush=True)` silent-pass; content-length-lying; Python `fromisoformat` silent-truncate). ADR IX-2's Zod → JSON Schema → Pydantic v2 codegen ships as the `pk gen-py-schema` CLI subcommand with regen-stability CI gating. TP-OIDC 404 diagnosis prep landed for user-OTP-gated M9+ execution. ADR count 54/55 → 55/55.

---

## Commits

| Hash | Subject |
|------|---------|
| `09e8832` | chore(release): TP-OIDC 404 diagnosis prep — workflow + introspect script + recipe doc |
| `f621802` | feat(core/wire): IX-1 foundation — types, canonical JSON, timestamp validator, decodeResult helper |
| `51b8b58` | chore(core/wire): clean 1a biome warnings — template literals + named regex groups |
| `06f5938` | feat(core/wire): IX-1 framers — NDJSON + LSP Content-Length codecs |
| `1a4eb07` | feat(core/wire): IX-1 trace-wire + public re-export — Unit 1 complete |
| `ebfe42c` | docs(core/wire): IX-1 wire spec — implementor README + kit protocol reference |
| `dcb3454` | feat(cli): IX-2 pk gen-py-schema — Zod→JSON Schema→Pydantic v2 codegen |
| `d83ea74` | test(cli): boost gen-py-schema + feature-gap-check coverage |

---

## Per-unit summary

### Unit 1 — IX-1 wire framing module (`packages/core/src/wire/`)

Shipped across 4 commits (1a foundation → 1a cleanup → 1b framers → 1c trace-wire). Files: `types.ts`, `canonical-json.ts`, `timestamp.ts`, `decode-result.ts`, `ndjson.ts`, `lsp-frame.ts`, `trace-wire.ts`, `index.ts` (barrel) + 6 test files + integration. The strict LSP decoder rejects unknown headers on the first header-block line — closes the spike-3 silent-pass class empirically (test `spike-3 flush=True fixture: debug bytes BETWEEN frames emit wire/unknown_header (NOT silent pass)` PASSES). Body byte-length validation closes the content-length-lying class (`content-length-lying fixture (spike-3 B-4): emits wire/truncated_body` PASSES). RFC-3339-ms timestamp validation rejects sub-ms fractional precision loud (closes the Python `fromisoformat` silent-truncate class). `decodeResult` ambiguity guard closes the convention-not-tag typo class (both-null AND both-non-null inputs surface `wire/result_ambiguous`). End-to-end NDJSON + LSP round-trips with W3C Trace Context preserve `traceparent` across encode → decode (acceptance criteria #13 + #14 confirmed). Public surface re-exported from `@idriszade/core`. **125 new tests** (1176 → 1301).

### Unit 2 — IX-2 Python codegen pipeline (`@idriszade/cli`)

`pk gen-py-schema --in <ts> --out <py>` subcommand. Loads user Zod schemas via tsx subprocess, emits JSON Schema Draft 2020-12 via Zod v4 native `z.toJSONSchema` (note: `zod-to-json-schema@^4` doesn't exist; used Zod v4's first-party API instead — strictly better since it's the library's own path). Feeds JSON schema to `uv run --with 'datamodel-code-generator[http]' datamodel-codegen` for Pydantic v2 emission. Feature-gap check rejects `.refine`/`.transform`/`.brand`/`.preprocess`/`.pipe` by default. `--check` mode gates CI on snapshot drift (timestamp line stripped before diffing for stability). Sample schema + committed snapshot at `packages/cli/fixtures/wire-schemas/`. Root workspace script `gen-py-schema:check`. **72 new tests** (61 from coverage boost + 11 from initial implementation; 1301 → 1373).

### Unit 3 — Wire spec docs

`packages/core/src/wire/README.md` (201 lines, 10 H2 sections — implementor reference) + `docs/api-surface/wire.md` (196 lines, 10 H2 sections — formal protocol spec). No code; no test impact.

### Unit 4 — TP-OIDC 404 diagnosis prep

`.github/workflows/oidc-token-debug.yml` (manual-dispatch GHA workflow printing OIDC token claims) + `scripts/npm-trust-introspect.sh` (executable; wraps `npm trust list --json`) + `docs/development/tp-oidc-claim-diagnosis.md` (5-step recipe + 3 fix hypotheses + re-test + rollback). `.gitignore` updated for `tmp/tp-oidc-diagnosis/`. Diagnostic-only — actual TP-OIDC fix is user-OTP-gated and carries to M9+.

---

## ADRs

| ADR | Subject | Status delta |
|-----|---------|--------------|
| IX-1 | NDJSON + LSP wire framing | SHIPPED — kit-side impl complete |
| IX-2 | Zod → JSON Schema → Pydantic codegen | SHIPPED — pk gen-py-schema CLI |
| IX-3 | `decodeResult` + per-frame Result envelope | SHIPPED — `decode-result.ts` |
| IX-4 | W3C Trace Context wire surfaces | SHIPPED — `trace-wire.ts` integrates with existing `serializable-context.ts` |
| IX-5 | Kit owns wire spec; MCP/A2A at adapter tier | DOCUMENTED — `docs/api-surface/wire.md` §9 reinforces the delegation pattern (no kit-impl required) |

**ADR count: 54/55 → 55/55** (IX-1 ratification ships in Unit 1). IX-2/IX-3/IX-4/IX-5 were already in the 55-count via Phase 2 spec lock; M8 ships their kit-side impls without moving the count.

---

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| typecheck | PASS | strict mode, all packages |
| test | PASS | 1373 passed + 2 skipped (baseline 1176 → +197 net) |
| biome check | PASS | 0 errors, 0 warnings |
| build | PASS | all packages emit dist/ |
| coverage | PASS | 88.61 / 80.29 / 91.37 / 89.63 (target ≥ 88/80/90/89; M7 baseline 88.64/80.43/90.69/89.76 — within rounding) |
| M8 hard gates | PASS | all 9 spike-derived adversarial gates green (see Unit 1 summary) |

---

## Package bumps

| Package | Previous | New | Reason |
|---------|----------|-----|--------|
| `@idriszade/core` | 0.5.x | minor | new wire module export surface |
| `@idriszade/cli` | 0.2.x | minor | new `gen-py-schema` subcommand |

Changeset: `.changeset/m8-wire-framing.md`. Two-step publish flow per `feedback_changesets_two_step_publish`: merging M8 PR opens the Version Packages PR; merging that triggers actual publish. Expect 2+ `release.yml` runs.

---

## Carry-forwards into M9+

**From M8:**
- TP-OIDC 404 actual fix — runs Unit 4's diagnostic scripts under user OTP elevation; claim diff vs GitHub OIDC token; revoke + recreate trust config; remove `NODE_AUTH_TOKEN` from `release.yml`; re-test.
- First-real-cross-runtime-adapter (likely Python `process-*` reference adapter) — exercises Units 1 + 2 end-to-end. M10+.
- `lsp-frame.ts` is 456 LOC (over the 300 soft / under the 500 hard). Acceptable per the strict-decoder complexity, but worth a refactor consideration in M9+ if maintenance pressure grows.

**Outstanding from M7+earlier (carried forward unchanged):**
- M2 CLI gaps: `pk run` stdin, webhook trigger, full cron parser, `pk scaffold`.
- `observe-vercel` cost-event wiring (conditional).
- `@idriszade/memory-pgvector` semantic memory pack.
- Per-package Trusted Publisher configuration drift discipline.

---

## Notes / assumptions made by executors

1. `zod-to-json-schema@^4` (specified in brief Unit 2) doesn't exist; latest is 3.x and now deprecated. Substituted Zod v4's first-party `z.toJSONSchema` API.
2. `gen-py-schema:check` root workspace script uses `tsx` instead of compiled `dist/cli.js` due to workspace dep resolution issue with `@idriszade/observe`. Functionally equivalent.
3. `--check` mode strips the `# timestamp:` line from `datamodel-codegen` output before diffing — without this, the snapshot would drift on every regen.
4. `feature-gap-check.ts` had a Zod v4 compat bug (`valueSchema` vs `valueType` for `z.record`) caught + fixed by the coverage-boost tests.
5. 1c integration tests use `biome-ignore` for 4 `noNonNullAssertion` warnings in the `expect(x).toBeNull(); x!` test idiom — standard pattern, low risk.

---

*M8 close-out 2026-05-22. Ready for PR / merge / publish per user release flow.*
