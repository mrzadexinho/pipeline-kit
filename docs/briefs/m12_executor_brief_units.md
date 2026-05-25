# M12 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m12_executor_brief.md`](m12_executor_brief.md)):**
> - U1 = `.github/dependabot.yml` (new); npm + GHA + uv ecosystems; weekly; cooldowns; groups.
> - U2 = `.github/workflows/scorecard.yml` (new) + README badge; SARIF to code-scanning; baseline
>   score captured in M12 report-back (gaps become carry-forwards, NOT fixed in M12).
> - U3 = `release.yml` `publish-python` job replaced with `pypa/gh-action-pypi-publish`
>   (`attestations: true`); `pyproject.toml` dev-deps migrated to `[dependency-groups]`; ADR M12-1
>   written; changeset triggers 0.1.0 → 0.1.1 patch for `pkit-process`.
> - U4 = `packages/core/src/wire/lsp-frame.ts` split into cohesive sub-files ≤300 LOC each;
>   barrel re-export preserves all existing import paths; tests untouched.
> - Wave plan: U1 + U2 + U4 in parallel (Wave 1); U3 sequential after Wave 1 (Wave 2).
> Read entry brief for wave sequencing, working rules, and all 14 verification gates.

---

## U1 — Dependabot setup

### Goal

Weekly automated dependency hygiene across three ecosystems:
- `npm` — pnpm workspace root (Dependabot auto-detects `pnpm-lock.yaml`)
- `github-actions` — all workflow SHAs in `.github/workflows/`
- `uv` — `pkit-process` Python package in `packages/adapter-python-process` (reads `uv.lock`)

### Files touched

- `.github/dependabot.yml` (NEW)

### Why these choices

**Why `npm` covers pnpm:** Dependabot uses the `npm` ecosystem key and auto-detects
`pnpm-lock.yaml` at the configured directory. pnpm workspace catalogs were GA'd 2025-02 per
GitHub changelog. No `pnpm`-specific ecosystem key exists; `npm` is correct.

**Why `uv` (not `pip`) for `pkit-process`:** `uv` is a distinct ecosystem key in the current
Dependabot schema (added 2025). It reads `uv.lock` natively. Using `pip` would miss the lock
file and open-pull-requests would be generated against `pyproject.toml` only (less precise).

**Why 7-day cooldown default:** Industry recommendation from Datadog SecLabs and cooldowns.dev;
exempts security updates automatically (Dependabot security PRs bypass cooldowns). Reduces
noise from same-day dependency churn. Major bumps get 14-day cooldown for additional review
window.

**Why minor/patch grouped but major un-grouped:** Major version bumps carry breaking-change
risk and require isolated review. Minor and patch bumps are batched to avoid PR-flood (common
Dependabot footgun without groups). Each major lands in its own PR for explicit sign-off.

### Implementation spec

```yaml
version: 2
updates:
  # JS — pnpm workspace (npm ecosystem auto-detects pnpm-lock.yaml at root)
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "06:00"
      timezone: Etc/UTC
    open-pull-requests-limit: 10
    cooldown:
      default-days: 7
      semver-major-days: 14
      semver-minor-days: 7
      semver-patch-days: 3
    groups:
      js-dev-minor-patch:
        dependency-type: development
        update-types: [minor, patch]
      js-prod-minor-patch:
        dependency-type: production
        update-types: [minor, patch]
      # Major bumps stay un-grouped so each lands in isolation for review
    commit-message:
      prefix: "chore(deps)"
      prefix-development: "chore(deps-dev)"
      include: scope
    labels: ["dependencies", "javascript"]

  # GitHub Actions
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "06:00"
      timezone: Etc/UTC
    open-pull-requests-limit: 5
    cooldown:
      default-days: 7
    groups:
      github-actions-all:
        patterns: ["*"]
    commit-message:
      prefix: "chore(ci)"
      include: scope
    labels: ["dependencies", "github-actions"]

  # Python — pkit-process (uv ecosystem, has uv.lock)
  - package-ecosystem: uv
    directory: /packages/adapter-python-process
    schedule:
      interval: weekly
      day: monday
      time: "06:00"
      timezone: Etc/UTC
    open-pull-requests-limit: 5
    cooldown:
      default-days: 7
      semver-major-days: 14
    groups:
      python-dev-minor-patch:
        dependency-type: development
        update-types: [minor, patch]
      python-prod-minor-patch:
        dependency-type: production
        update-types: [minor, patch]
    commit-message:
      prefix: "chore(deps-py)"
      include: scope
    labels: ["dependencies", "python"]
```

### STOP gate

YAML committed; `.github/dependabot.yml` visible in GitHub Insights → Dependency graph →
Dependabot tab; first scheduled run (or manually triggered via "Check for updates" button in
GitHub UI) completes without "invalid config" error in dependency-update logs.

### Verification

```bash
# Non-error response confirms Dependabot API can read the config
gh api repos/mrzadexinho/pipeline-kit/dependabot/alerts --jq 'length'

# Manual check: GitHub UI → Insights → Dependency graph → Dependabot tab
# Click "Check for updates" to trigger first run without waiting for Monday schedule
```

### Out of scope

Auto-merge configuration; Dependabot security-only mode; label creation (labels must exist in
repo before Dependabot can apply them — create `dependencies`, `javascript`, `python`,
`github-actions` labels manually or via `gh label create` before FF-merge).

### Commit policy

Single commit:
`chore(ci): add Dependabot weekly update config (npm + GHA + uv)`

---

## U2 — OpenSSF Scorecard

### Goal

Quantified supply-chain posture + SARIF code-scanning integration + public badge for
`README.md`. Baseline score captured in M12 report-back; surfaced gaps become carry-forwards,
NOT fixed in M12.

### Files touched

- `.github/workflows/scorecard.yml` (NEW)
- `README.md` (badge line — add near top, adjacent to any existing CI badges)

### CRITICAL workflow restrictions (from ossf/scorecard-action README, Workflow Restrictions)

These are hard constraints from the action maintainers; violating them causes the action to
fail or produce incorrect SARIF:

- No top-level `env` vars or `defaults` in the workflow file.
- No workflow-level `write` permissions (only `read-all` at top; job-level overrides as needed).
- Only the job with `ossf/scorecard-action` can use `id-token: write`.
- Job allowed steps are ONLY: `actions/checkout`, `actions/upload-artifact`,
  `github/codeql-action/upload-sarif`, `ossf/scorecard-action`, `step-security/harden-runner`.
  Do NOT add any other steps (e.g., `setup-node`, custom scripts) to this job.

### Implementation spec

```yaml
name: Scorecard supply-chain
on:
  push:
    branches: [master]
  schedule:
    - cron: "30 1 * * 6"  # Saturdays 01:30 UTC, weekly
  workflow_dispatch:

permissions: read-all

jobs:
  analysis:
    name: Scorecard analysis
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Run Scorecard
        uses: ossf/scorecard-action@4eaacf0543bb3f2c246792bd56e8cdeffafb205a # v2.4.3
        with:
          results_file: results.sarif
          results_format: sarif
          publish_results: true

      - name: Upload SARIF artifact
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: scorecard-sarif
          path: results.sarif
          retention-days: 5

      - name: Upload SARIF to code-scanning
        uses: github/codeql-action/upload-sarif@e46ed2cbd01164d986452f91f178727624ae40d7 # v4.35.3
        with:
          sarif_file: results.sarif
```

### README badge

Add near top of `README.md`, adjacent to any existing CI/npm badges. Executor finds the
existing badge section and appends or inserts there:

```markdown
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/mrzadexinho/pipeline-kit/badge)](https://scorecard.dev/viewer/?uri=github.com/mrzadexinho/pipeline-kit)
```

### SHA resolution note

The SHAs above are specified verbatim in the brief. Do NOT resolve them again at edit time —
use them exactly as given. They are the canonical SHAs the brain selected.

### STOP gate

Workflow file committed; first run triggered by push to master completes green; SARIF appears
under repo Security → Code scanning; badge resolves at scorecard.dev viewer with a numeric
score; baseline score captured in M12 report-back.

### Verification

```bash
# Check workflow run status
gh run list --workflow=scorecard.yml --limit 3

# Check scorecard.dev API for numeric score
curl -s https://api.scorecard.dev/projects/github.com/mrzadexinho/pipeline-kit | jq .score

# Verify README badge URL resolves (should return a badge SVG)
curl -sI "https://api.scorecard.dev/projects/github.com/mrzadexinho/pipeline-kit/badge" | head -5
```

### Out of scope

Fixing Scorecard findings (gaps surface as carry-forwards to M13+); CodeQL query writing;
branch protection rules (separate user-scoped session); adding `step-security/harden-runner`
(follow-up if score low on this axis).

### Commit policy

Two commits:
1. `chore(ci): add OpenSSF Scorecard workflow with SARIF code-scanning upload`
2. `docs: add OpenSSF Scorecard badge to README`

(Or single commit if README edit is trivial — executor decides.)

---

## U3 — PEP 740 attestations + uv dev-deps migration

### Goal

Sigstore-backed attestations for `pkit-process` (Python sister to M11 npm posture). Replace
`uv publish` in `release.yml` `publish-python` job with `pypa/gh-action-pypi-publish` (which
generates PEP 740 attestations by default since v1.11). Simultaneously migrate
`[tool.uv].dev-dependencies` → `[dependency-groups].dev` to clear the uv deprecation warning
that surfaces in `uv run pytest`. New ADR M12-1 written and ratified at U3 close.

**Wave 2 dependency:** This unit starts only after U1 + U2 + U4 are all FF-merged to master.
It is the only unit in M12 that touches `release.yml`.

### Files touched

- `.github/workflows/release.yml` — replace entire `publish-python` job (current lines ~71-87)
- `packages/adapter-python-process/pyproject.toml` — migrate dev-deps section
- `docs/development/release-auth-posture-pypi.md` (NEW — ADR M12-1)
- `docs/development/release-auth-posture.md` (M11-1 — add `## Cross-reference` line)
- `packages/adapter-python-process/CHANGELOG.md` — changeset entry for 0.1.0 → 0.1.1
- `.changeset/m12-pypi-attestations.md` (NEW)

### Pre-flight

Before editing `release.yml`:

1. Read current `release.yml`. Confirm `publish-python` job uses `uv publish`. If it already
   uses `pypa/gh-action-pypi-publish`, STOP and report discrepancy — this unit may be a no-op.

2. Read `packages/adapter-python-process/pyproject.toml`. Confirm `[tool.uv]` block with
   `dev-dependencies` exists. If already migrated to `[dependency-groups]`, skip that sub-task.

3. Confirm `packages/adapter-python-process/pyproject.toml` has Trusted Publisher config
   already in place from M9 (`[tool.hatch.build.targets.wheel]` or `[build-system]` — note for
   context; PyPI Trusted Publisher is a npmjs.com/pypi.org web config, not in pyproject.toml).

### release.yml diff spec

Replace the entire `publish-python` job with:

```yaml
  publish-python:
    needs: release
    runs-on: ubuntu-latest
    environment:
      name: pypi
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0
      - name: Build sdist + wheel
        run: uv build
        working-directory: packages/adapter-python-process
      - name: Publish to PyPI with PEP 740 attestations
        uses: pypa/gh-action-pypi-publish@cef221092ed1bacb1cc03d23a2d87d1d172e277b # v1.14.0
        with:
          packages-dir: packages/adapter-python-process/dist
          # attestations: true is the default since v1.11; explicit for clarity
          attestations: true
```

Note on `environment: name: pypi`: This references the GitHub Actions environment named `pypi`
which was configured in M9 for Trusted Publishing. Do NOT change the environment name — it must
match the PyPI Trusted Publisher configuration exactly.

### pyproject.toml diff spec

DELETE the `[tool.uv]` block entirely. ADD at end of file:

```toml
[dependency-groups]
dev = [
  "pytest>=9.0",
  "pytest-asyncio>=0.24",
  "hypothesis>=6.100",
]
```

The `[project.optional-dependencies] test = [...]` block stays as-is (separate purpose:
published extras for pip users). Only the `[tool.uv]` dev-dependencies block moves.

### Verification of pyproject.toml migration

```bash
cd packages/adapter-python-process
uv run pytest
# Must show: 0 warnings about tool.uv.dev-dependencies deprecation
# All tests pass
```

### Changeset file

`.changeset/m12-pypi-attestations.md`:

```markdown
---
"pkit-process": patch
---

Publish via pypa/gh-action-pypi-publish v1.14.0 with PEP 740 sigstore attestations enabled.
Migrate `[tool.uv].dev-dependencies` → `[dependency-groups].dev` (uv deprecation).
```

### ADR M12-1 — full content to write

Write `docs/development/release-auth-posture-pypi.md` with the following content (Status starts
as `Proposed`; flip to `Accepted` after verification publish confirms Gate 13):

```markdown
# ADR M12-1: PyPI publish auth posture (Trusted Publishing + PEP 740 attestations)

## Status
Proposed — 2026-05-24 (M12 U3 implementation). Update to Accepted after Gate 13 verified.

## Decision
pipeline-kit publishes `pkit-process` (and any future PyPI packages under `packages/*-python*`)
via **PyPI Trusted Publishing (OIDC) + PEP 740 digital attestations**, using
`pypa/gh-action-pypi-publish` SHA-pinned to v1.14.0
(`cef221092ed1bacb1cc03d23a2d87d1d172e277b`). `attestations: true` is the default since v1.11;
we keep it explicit. Building is performed by `uv build` in the same job (artifacts in
`packages/adapter-python-process/dist/`).

Sister to ADR M11-1 (npm posture). Same identity flow: GitHub OIDC token → sigstore signing →
PyPI Provenance tab + transparency log entry.

## Context
- ADR M11-1 (2026-05-25) set the npm TP-OIDC + sigstore baseline. Python lacked equivalent.
- M9 (2026-05-23) registered Trusted Publisher for `pkit-process` on PyPI. M9-M11 published
  via `uv publish` which does NOT generate PEP 740 attestations.
- PEP 740 (2024) defines digital attestations for Python packages on PyPI. Default-enabled in
  `pypa/gh-action-pypi-publish` v1.11+ (2025-Q1).
- `uv publish` does not yet support PEP 740 attestation generation. The canonical path is
  `pypa/gh-action-pypi-publish` with sigstore.

## Consequences

**Positive:**
- Sigstore-backed provenance for Python releases; transparency log entry per publish.
- Parity with npm posture (M11-1) — supply-chain story coherent across runtimes.
- Trusted Publisher config from M9 carries over unchanged.

**Negative / trade-offs:**
- Build step now coupled to GitHub Actions runner OS (docker-based action; Linux-only).
- Two-tool workflow (`uv build` + `pypa/gh-action-pypi-publish`) vs single `uv publish`.
  Acceptable for the attestation gain.
- First publish via the new path is the verification event; rollback path is reverting
  release.yml to `uv publish` (no PyPI-side cleanup needed).

## Revisit triggers
1. `uv publish` adds native PEP 740 support → consolidate to single tool.
   URL: https://github.com/astral-sh/uv/issues (search "PEP 740" / "attestations")
2. PyPI tightens attestation requirements (e.g., refuses non-attested uploads from
   previously-attested projects).
3. `pypa/gh-action-pypi-publish` `attestations` default changes.

## Cross-references
- ADR M11-1 (`release-auth-posture.md`) — npm sister.
- `docs/development/pypi-publisher-setup.md` — M9 Trusted Publisher setup.
- `.github/workflows/release.yml` `publish-python:` job — implementation.
- PEP 740 — https://peps.python.org/pep-0740/
- pypa/gh-action-pypi-publish — https://github.com/pypa/gh-action-pypi-publish

## Authoring + history
- Authored: 2026-05-24 (M12 U3 brief).
- Status track: ADR M11-1 (npm) → M12 audits Python publish path → uv publish lacks
  attestations → swap to pypa-action with attestations:true → verification publish at
  run ID <TBD — fill in after Gate 13 confirmed>.
```

### release-auth-posture.md cross-reference addition

In `docs/development/release-auth-posture.md` (M11-1 ADR), add at end of the
`## Cross-references` section:

```markdown
- ADR M12-1 (`release-auth-posture-pypi.md`) — Python sister; PyPI TP-OIDC + PEP 740.
```

### STOP gate

`release.yml` diff applied; `pyproject.toml` migrated (`uv run pytest` produces no
`tool.uv.dev-dependencies` deprecation warning); changeset committed; ADR M12-1 written at
Status: Proposed; on next master push, `release.yml` publishes `pkit-process 0.1.1` with
attestation; ADR M12-1 flipped to Status: Accepted with verification run ID filled in;
attestation visible at `https://pypi.org/project/pkit-process/#provenance`.

**U3 STOP-and-bump policy:**
If `pypa/gh-action-pypi-publish` returns 403 or 404 during the verification publish:
- Do NOT revert to `uv publish` automatically.
- Freeze branch. Capture full publish step log.
- Attempt up to 2 variant fixes (e.g., `packages-dir` path, `environment` name mismatch).
- After 2 failed variants: STOP. Brain decides remediation path before ADR M12-1 ratification.

### Verification

```bash
# Local: no deprecation warning
cd packages/adapter-python-process && uv run pytest

# CI: release.yml publish-python job green
gh run view <run-id> --log | grep -iE 'attestation|sigstore|provenance|403|404'

# PyPI Provenance tab
curl -s https://pypi.org/project/pkit-process/json | jq '.urls[0]'
# Visit https://pypi.org/project/pkit-process/#provenance in browser

# Sigstore transparency log
# search.sigstore.dev/?logIndex=<from-run-log>
```

### Commit policy

Three commits:
1. `fix(release): replace uv publish with pypa-action for PEP 740 attestations`
2. `chore(deps-py): migrate tool.uv.dev-dependencies to dependency-groups (uv deprecation)`
3. `chore(changeset): pkit-process 0.1.1 — PEP 740 attestations enabled`

(Plus a fourth commit after Gate 13 confirmed: flip ADR M12-1 Status to Accepted.)

---

## U4 — lsp-frame.ts preventive split

### Goal

Split `packages/core/src/wire/lsp-frame.ts` (462 LOC; over 300-soft, under 500-hard) into
cohesive sub-files of ≤300 LOC each. Pure refactor — no behavior change, no test edits. Barrel
re-export preserves all existing import paths from consumers.

The dedup opportunity: the validation logic currently duplicated between the sync decoder and
async decoder is factored into a shared `parseFrameHeader()` helper in a new sub-file. All
existing tests pass UNMODIFIED — this is the primary correctness signal.

### Files touched

- `packages/core/src/wire/lsp-frame.ts` — becomes barrel re-export (or shrinks to one cohesive
  piece; executor adjusts to actual cohesion)
- `packages/core/src/wire/lsp-frame-header.ts` (NEW) — `findHeaderTerminator`,
  `parseHeaderLines`, new `parseFrameHeader()` helper returning
  `Result<{contentLength, traceparent, tracestate}, DecodeError>`
- `packages/core/src/wire/lsp-frame-encode.ts` (NEW) — `encodeLspFrame`, `encodeLspStream`,
  encoder-local helpers
- `packages/core/src/wire/lsp-frame-decode.ts` (NEW) — sync `decodeLspStream` calling
  `parseFrameHeader`
- `packages/core/src/wire/lsp-frame-async.ts` (NEW) — `decodeLspAsyncIter` calling
  `parseFrameHeader`

### Pre-flight

Before splitting:

1. Read `packages/core/src/wire/lsp-frame.ts` in full. Note current LOC and identify the
   natural cohesion boundaries (encoder section, header parsing section, sync decoder, async
   decoder). Adjust the split plan if actual cohesion differs from the suggested structure.

2. Read `packages/core/test/wire/` to understand what tests exist and which symbols they
   import. These files MUST NOT be modified — the barrel must export everything they reference.

3. Confirm no other packages import from `lsp-frame.ts` directly with non-standard paths
   (e.g., `../../wire/lsp-frame-internal`). All imports must go through the barrel.

### Implementation approach

1. Create sub-files with the extracted logic.
2. Each sub-file must have complete type imports (no circular deps; all types re-imported from
   `@idriszade/core` or from sibling sub-files as needed).
3. The `parseFrameHeader()` helper MUST be byte-identical in semantics to the current inline
   logic — same error codes, same near-strings, same byte offsets. Only structure changes.
4. Rewrite `lsp-frame.ts` as a barrel:
   ```typescript
   export * from './lsp-frame-header.js';
   export * from './lsp-frame-encode.js';
   export * from './lsp-frame-decode.js';
   export * from './lsp-frame-async.js';
   ```
5. Do NOT re-export internal helpers that were previously unexported (only public surface
   goes in the barrel; internal helpers stay private to their sub-file).

### Hard constraints

- Existing test files in `packages/core/test/wire/` MUST NOT be modified (zero edits).
- All existing import paths from consumers (`from './wire/lsp-frame.js'`) must continue to
  resolve via the barrel re-export.
- Each derived file ≤300 LOC. The barrel itself is exempt (it is just re-exports; typically
  5-10 lines).
- No new public API surface. Do NOT export `parseFrameHeader` externally if it was previously
  internal — only promote to public if the barrel already exports the equivalent logic.
- `pnpm --filter @idriszade/core typecheck` must pass.
- `pnpm biome check packages/core/src/wire/ --max-diagnostics=500` must be clean.

### STOP gate

`wc -l packages/core/src/wire/lsp-frame*.ts` shows each file ≤300 LOC; `pnpm --filter
@idriszade/core test -- wire` green (ALL tests pass UNMODIFIED); `pnpm --filter
@idriszade/core typecheck` green; `pnpm biome check packages/core/src/wire/` green; no
consumer files in other packages required edits.

If ANY existing wire test fails: STOP immediately. Do NOT modify the test. Investigate the
barrel or sub-file to restore the passing state.

### Verification

```bash
# Line counts — all must be ≤300
wc -l packages/core/src/wire/lsp-frame*.ts

# Wire tests (all must pass UNMODIFIED)
pnpm --filter @idriszade/core test

# Full typecheck
pnpm typecheck

# Biome clean
pnpm biome check packages/core/src/wire/ --max-diagnostics=500

# Verify no consumer outside core was affected (grep for direct lsp-frame imports)
grep -r "lsp-frame" packages/*/src/ --include="*.ts" | grep -v "core/src/wire"
```

### Out of scope

Modifying test files; changing public API surface; adding new exports not previously public;
fixing unrelated wire issues surfaced during the read.

### Commit policy

Single commit:
`refactor(core/wire): split lsp-frame.ts into cohesive sub-files ≤300 LOC (barrel re-export)`

---

*Drilldown companion to [`m12_executor_brief.md`](m12_executor_brief.md). Working rules, wave
sequencing, risk flags, and all 14 verification gates are in the entry brief.*
