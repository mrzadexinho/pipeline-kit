# Brief — M0.5b Scope Rename + npm Publish (17 packages → public registry)

> **Branch:** `m0-5b-npm-publish` (off `master` tip `643e281`)
> **Author (brain):** Pursuit brain session, 2026-05-09
> **Estimated executor effort:** 2.5-3.5 hours (single session)
> **Status:** Ready for executor pickup pending Idris's manual prereq
> (Section 0 — npm scope claim, token, OIDC).
> **Predecessor:** M0.5 reference adapters shipped at `1c340bc` (all gates
> green, 17 packages workspace-resolvable but unpublished + currently
> namespaced under `@pipeline-kit/*`).

**Strategic context:** Portfolio v2 Sprint 1 (M1 GTM Engine v0) cannot
ship until kit's M0.5 packages are installable via `pnpm add
@idriszade/core` from external repos. Currently every package is at
`version 0.0.0`, namespaced under `@pipeline-kit/*` (taken on npm), and
`npm view @pipeline-kit/core` returns 404. Sprint 1 brief Task 0.2 fails
at first install.

**Two coupled changes ship in this brief:**
1. **Rename:** `@pipeline-kit/*` → `@idriszade/*` across the kit codebase
   (355 refs / ~30 files) — `pipeline-kit` org name is taken on npm; brain
   decision locks the scope to Idris's surname-as-brand `@idriszade` per
   `pursuit/docs/strategy/portfolio_v2/00_master_vision.md` D11/D12 brand
   surface alignment.
2. **Publish:** initial 0.1.0 release of all 17 packages to public npm
   under the new scope.

**Industry pattern lifted:** changesets + per-package `tsc` build (already
configured) + `--provenance` SLSA attestation via GitHub Actions OIDC.
Same release machinery used by Drizzle, tRPC, Effect, Mastra, Astro,
Vercel SDK in 2026.

**Repo identity unchanged:** repo stays `pipeline-kit`. CLAUDE.md +
spec.md + ADR conceptual references to "pipeline-kit" as the LIBRARY
name stay. Only the npm SCOPE moves to `@idriszade`. Same pattern as
Babel (repo `babel/babel`, packages `@babel/*`) — repo identity ≠ scope
identity.

---

## Section 0 — Manual prereq (Idris owns; cannot be delegated)

The executor cannot run Tasks 2+ until all three complete. **All three
are Idris's npm/GitHub account work** — they require credentials brain
+ executor never hold.

### 0.1 — Claim `@idriszade` npm scope

1. Sign in to npmjs.com as your existing identity (or create new — the
   npm handle owning the scope is the publisher of record).
2. Create org → name: `idriszade` → tier: Free (sufficient for public
   scoped packages).
3. Verify scope claimed: visiting `npmjs.com/~idriszade` should show org
   org page; `npm view @idriszade/core` will still 404 until first
   publish (expected).

### 0.2 — Generate npm publish token + install as GHA secret

1. npmjs.com → Access Tokens → Generate New Token → **Granular Access
   Token** (NOT classic — granular is 2026 canonical).
2. Permissions: `Read and write` on scope `@idriszade/*`, expiry
   `90 days` (rotate per credential hygiene; calendar reminder for
   2026-08-09).
3. Token name: `idriszade-npm-publish-2026-05-09`.
4. Add to GitHub repo (`mrzadexinho/pipeline-kit`) → Settings → Secrets
   and variables → Actions → New repository secret → Name: `NPM_TOKEN`,
   value: the granular token.

### 0.3 — Enable Trusted Publishing (OIDC) for provenance

For `--provenance` SLSA attestation to work on free tier:

1. npmjs.com → `idriszade` org → Settings → Trusted Publishers.
2. Add publisher: GitHub repo `mrzadexinho/pipeline-kit`, workflow
   filename `release.yml`, environment (optional).

If Trusted Publishing isn't available for free-tier orgs at claim time,
executor falls back to token-based publish without provenance and notes
in report-back; brain decides whether to upgrade tier.

**Confirm 0.1, 0.2, 0.3 all done before spawning executor session.**

---

## Section 1 — Engineering philosophy

Per `pipeline-kit/CLAUDE.md` (canonical):

- **TypeScript strict** for any new code (release workflow has minimal
  TS surface; mostly YAML + shell)
- **No `any`** anywhere
- **File size:** 300 line soft / 500 hard. Release workflow ~80 lines
  expected.
- **No emojis** in code, commit messages, changelogs, or release notes.
- **Functional core, imperative shell** — release script is by nature
  imperative (`pnpm changeset publish` is a single CI op); fine.
- **Result envelope discipline does NOT apply to bash scripts** —
  `set -euo pipefail` is the bash equivalent.
- **Idempotency:** rename Task 1 must be reversible via `git revert`
  if any verification gate fails before Task 8 publish step.

---

## Section 2 — References (read first; cite in commits)

- **Changesets canonical docs:**
  https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md
- **Changesets GitHub Action canonical workflow:**
  https://github.com/changesets/action — use `v1` (latest stable as of
  2026-05).
- **npm provenance docs:**
  https://docs.npmjs.com/generating-provenance-statements
- **Trusted publishing (OIDC, free-tier):**
  https://docs.npmjs.com/trusted-publishers
- **pnpm publish recursive:**
  https://pnpm.io/cli/publish

**Lift PATTERNS not code.** No copy-paste from agent-forge / pursuit /
Gatewerk. The release workflow is canonical changesets boilerplate; do
not invent a custom variant.

---

## Section 3 — Stack locked

| Concern | Locked choice |
|---------|--------------|
| Versioning | `@changesets/cli` v2.31+ (already installed) |
| Build per-package | `tsc` (already configured: `build: "tsc"` in each pkg.json) |
| First version | `0.1.0` (NOT 1.0.0 — kit not yet API-stable) |
| Release trigger | GitHub Actions on push to `master` |
| Provenance | `--provenance` flag (SLSA attestation via GHA OIDC) |
| Publish auth | NPM_TOKEN secret + Trusted Publishing OIDC |
| **npm scope** | **`@idriszade`** (locked; replaces `@pipeline-kit`) |
| Access | `public` (already in `.changeset/config.json`) |
| baseBranch fix | `.changeset/config.json` `main → master` |
| Repo identity | `pipeline-kit` unchanged (only scope moves) |

---

## Section 4 — Tasks in dependency order

### Task 1 — Rename `@pipeline-kit/*` → `@idriszade/*` across the codebase

This is the load-bearing precondition — every subsequent task assumes
the rename is done. Map first, edit second, verify third.

**Mapping pass (read-only, audit before edit):**

```bash
cd ~/Claude-Workspace/pipeline-kit
grep -rn "@pipeline-kit/" --include="*.md" --include="*.ts" \
  --include="*.json" --include="*.yaml" \
  --exclude-dir=node_modules --exclude-dir=dist > /tmp/rename-surface.txt
wc -l /tmp/rename-surface.txt   # expect ~355 lines across ~30 files
```

Categorize the surface (sanity-check the executor's understanding):

- **Package `name` fields** (17 files): `packages/*/package.json` → flip
  `"name": "@pipeline-kit/<name>"` → `"name": "@idriszade/<name>"`.
- **Package `dependencies` / `peerDependencies` cross-refs** (kit
  packages depending on each other — e.g., `process-reviewable` depends
  on `core`): every such reference flips scope.
- **`pnpm-lock.yaml`**: regenerate via `pnpm install` (do NOT hand-edit).
- **Source TypeScript imports** (`packages/*/src/**/*.ts`,
  `packages/*/tests/**/*.ts`): every `from "@pipeline-kit/<name>"` flips.
- **Spec docs** (`docs/spec.md`, `docs/spec-api-surface.md`,
  `docs/spec-adapters.md`, `docs/spec-build-plan.md`): all kit-package
  references in ADR text.
- **Research docs** (`docs/research-*.md`): scope references in v1
  research notes.
- **Briefs** (`docs/briefs/m0_*.md`): historical artifact; mark a
  one-line note at top of each affected brief: `> NOTE: kit packages
  renamed @pipeline-kit/* → @idriszade/* on 2026-05-09 in M0.5b. Brief
  text below is preserved as historical record; current package names
  use @idriszade/*.` Do NOT find/replace within historical briefs (they
  represent the spec at their authoring date).
- **README.md** (root + per-package): flip examples + install snippets.
- **`.claude/settings.local.json`** if scope appears: flip.
- **`research/spikes/cross-runtime/`**: rename if referenced.

**Edit pass (one commit per category for reviewability):**

```bash
# Commit 1 — package.json names + cross-deps
find packages -maxdepth 2 -name package.json -exec \
  sed -i '' 's|@pipeline-kit/|@idriszade/|g' {} +
git add packages/*/package.json
git commit -m "chore(rename): @pipeline-kit/* → @idriszade/* across package.json files"

# Commit 2 — TypeScript source + tests
find packages -name "*.ts" \! -path "*/node_modules/*" \! -path "*/dist/*" \
  -exec sed -i '' 's|@pipeline-kit/|@idriszade/|g' {} +
git add packages
git commit -m "chore(rename): scope refs in TS source + tests"

# Commit 3 — spec + research docs
find docs -maxdepth 1 -name "*.md" \! -path "*/briefs/*" -exec \
  sed -i '' 's|@pipeline-kit/|@idriszade/|g' {} +
git add docs
git commit -m "chore(rename): scope refs in spec + research docs"

# Commit 4 — root README + .claude config + spike code
sed -i '' 's|@pipeline-kit/|@idriszade/|g' README.md
# (verify .claude/settings.local.json + spike files via mapping pass list)
git add README.md .claude research
git commit -m "chore(rename): scope refs in README + spike code + claude config"

# Commit 5 — historical briefs: prepend rename note (DO NOT find/replace)
# Edit briefs/m0_composer_reviewable.md, m0_5_reference_adapters.md,
# m0_5_reference_adapters-spec.md, m0_5_executor_kickoff.md,
# m0_report_back.md, m0_5_report_back.md
# Add note (verbatim) above first heading:
#   > NOTE 2026-05-09: kit packages renamed @pipeline-kit/* →
#   > @idriszade/* in M0.5b. Brief text below is the spec at the time
#   > of writing — package names there are historical.
git add docs/briefs
git commit -m "chore(briefs): note scope rename on historical briefs"
```

**Verification pass (must pass before Task 2):**

```bash
# Zero refs to old scope (excluding historical briefs):
grep -rn "@pipeline-kit/" --include="*.md" --include="*.ts" \
  --include="*.json" --include="*.yaml" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=briefs \
  | grep -v "NOTE 2026-05-09" \
  || echo "zero matches outside historical briefs — pass"

# Lockfile regen + clean install:
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm test:types
pnpm -r build
```

If any verification gate fails, `git reset --soft HEAD~5` (or per-commit
revert) and re-investigate. **Do NOT proceed to Task 2 with a half-renamed
codebase.**

### Task 2 — Fix `.changeset/config.json` baseBranch

One-line edit: `"baseBranch": "main"` → `"baseBranch": "master"`. Without
this, `pnpm changeset status` prints spurious warnings against master.

Commit: `fix(changeset): align baseBranch with kit's master`.

### Task 3 — Add `.github/workflows/release.yml`

Canonical changesets-action workflow. Verify against upstream
`changesets/action` README at edit time — workflow YAML schemas drift.
Approximate shape:

```yaml
name: Release
on:
  push:
    branches: [master]

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write
  id-token: write       # for npm provenance OIDC

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: https://registry.npmjs.org/

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm -r build

      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
          version: pnpm changeset version
          commit: "chore(release): version packages"
          title: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: true
```

Commit: `ci(release): add changesets-based publish workflow`.

### Task 4 — Smoke build all 17 packages

`pnpm -r build` from kit root. Verify each `packages/*/dist/` contains
`index.js` + `index.d.ts` + sourcemaps. No empty dist anywhere. All
existing tests still green.

If any package's dist is empty, fix tsconfig at that package's level —
do NOT touch root tsconfig. Per-package emit sovereignty.

### Task 5 — Write initial changeset for 0.1.0

`pnpm changeset` interactive flow:

- Select **all 17 packages** (multi-select via `<space>`; `a` toggles all)
- Bump type: **minor** (`0.0.0 → 0.1.0`)
- Summary verbatim:

```
Initial public release — M0 + M0.5 reference adapters under @idriszade
scope. Composer + Pipeline factory + 4 Sources + 3 Stores + 5 Processes +
4 Serves. v0 contracts per spec.md ADRs 1-23. APIs may break before
1.0.0.
```

Commit the resulting `.changeset/<random-name>.md`.

### Task 6 — Bump versions + generate CHANGELOGs

```bash
pnpm changeset version
```

This bumps all 17 to `0.1.0`, generates `CHANGELOG.md` per package,
removes the consumed `.changeset/<random-name>.md`.

**Inspect the diff:** all 17 package.json bumped, all 17 CHANGELOG
files created. If any private-flagged package was missed, investigate.

Commit: `chore(release): version packages 0.1.0`.

### Task 7 — Smoke `pnpm publish --dry-run` per package

For each of the 17 packages:

```bash
cd packages/<name>
pnpm publish --dry-run --access public
```

Verify each tarball lists ONLY `dist/`, `README.md`, `LICENSE`,
`package.json`. No `src/`, `tests/`, `node_modules/`, `tsconfig.json`
leakage. Each tarball under 100KB for v0.

**Don't push the version-bump commit until all 17 dry-runs pass.**

### Task 8 — Push master + GHA does the actual publish

`git push origin master`. The release.yml workflow fires on push;
runs gates; runs `pnpm changeset publish`; pushes all 17 packages to npm
at 0.1.0 with provenance.

Watch the run live at GitHub → Actions tab. Common failure modes:
- 401: NPM_TOKEN expired or wrong scope — fix Section 0.2
- 402: paid-tier required without trusted publishing — fix Section 0.3
  OR drop `NPM_CONFIG_PROVENANCE: true` and re-run; flag in report-back
- 403: scope not owned — fix Section 0.1
- ENOENT on dist/index.js: build step missed a package; fix tsconfig

### Task 9 — Verify all 17 packages live on registry

```bash
for pkg in core process-classify process-extract process-reviewable \
  process-route process-validate serve-email serve-mcp serve-slack \
  serve-webhook source-api source-apify source-mcp source-webhook \
  store-pgvector store-postgres store-sqlite; do
    npm view @idriszade/$pkg version
done
```

All 17 should print `0.1.0`. Spot-check a few package pages on
npmjs.com — README + LICENSE render, "Provenance" badge present (or
report-back flags fallback).

### Task 10 — End-to-end smoke install in scratch dir

```bash
cd /tmp
mkdir pk-smoke && cd pk-smoke
pnpm init
pnpm add @idriszade/core @idriszade/source-apify
echo 'import { Pipeline } from "@idriszade/core";
console.log(typeof Pipeline);' > smoke.ts
npx tsx smoke.ts   # → "function" (or "object")
```

Round-trip green = Sprint 1 executor will be able to install + import
M0.5 packages exactly as the brief assumes.

---

## Section 5 — Verification gates (all must be green before report-back)

1. **Rename complete:** zero `@pipeline-kit/` refs outside historical
   briefs (per Task 1 verification grep)
2. **Local typecheck:** `pnpm typecheck` — 0 errors
3. **Local lint:** `pnpm lint` — 0 errors
4. **Local tests:** `pnpm test` — same count as M0.5 baseline post-rename
   (no regressions; report exact count)
5. **Local build:** `pnpm -r build` — every package emits non-empty dist
6. **GHA Release workflow:** green on the version-bump push to master
7. **npm registry:** all 17 packages at `0.1.0` under `@idriszade`
8. **Provenance:** all 17 npm pages show Provenance badge (or
   report-back flags fallback path used)
9. **Smoke install:** Section 4 Task 10 round-trip green

---

## Section 6 — Report-back format

At `~/Claude-Workspace/pipeline-kit/docs/briefs/m0_5b_report_back.md`:

```markdown
# M0.5b scope rename + npm publish — report back

## Shipped
- Rename: @pipeline-kit/* → @idriszade/* across N files / M refs (commit
  range `<hash1>..<hash2>`); historical briefs noted, not rewritten
- 17 packages live on npm at 0.1.0 (list with version per)
- Provenance status per package (Y/N + reason if N)
- Release workflow at `.github/workflows/release.yml` (commit ref)
- Initial CHANGELOGs generated

## Verification
- Gates 1-9: pass/fail with evidence (links to GHA run, registry URLs)
- Test count: M0.5 baseline N → post-rename N (no regressions)

## Live evidence
- npmjs.com URLs for all 17 packages
- One install-smoke transcript

## OPEN QUESTIONS for brain
- Anything that required brain decision but didn't have one (paid-tier
  upgrade for provenance, etc.)

## Discovered debt (named for follow-up briefs)
- E.g., per-package READMEs need expansion before 0.2.0
- E.g., release-please vs. changesets re-evaluation at v1
```

---

## Section 7 — Non-goals

- **Do NOT bump to 1.0.0.** Kit is not API-stable yet.
- **Do NOT add new code to packages.** This brief is rename + publish
  only. Code changes belong in M1+ build briefs.
- **Do NOT touch portfolio or pursuit repos.** Sprint 1 brief picks up
  in a separate executor session.
- **Do NOT add docs site or doc generator.** Separate deliverable.
- **Do NOT publish to GitHub Packages, JSR, or any non-npm registry.**
  Single-registry discipline.
- **Do NOT modify any architectural ADR or spec doc beyond scope-name
  find/replace.** Specs stay locked; only the package-name strings
  change.
- **Do NOT rename the repo.** Repo stays `pipeline-kit`. Only the npm
  scope moves to `@idriszade`. CLAUDE.md + spec.md text saying
  "pipeline-kit" as a library name stays — the library IS named
  pipeline-kit; it ships under `@idriszade/*` scope (Babel pattern).
- **Do NOT bake security headers / XSS sanitizers / etc. into kit
  packages.** Those are atom-level concerns at Tier 4.
- **Do NOT skip Section 0 manual prereqs.** No workarounds — return to
  brain if any of 0.1, 0.2, 0.3 fails.

---

## Section 8 — Rollback path

**Pre-publish (Tasks 1-7):** rename commits are `git revert`-able. If
any verification gate fails before Task 8 push, revert + investigate.

**Post-publish (Task 8+):** npm has 72-hour unpublish window for new
packages with no dependents.

1. Within 72h, no external dependents: `npm unpublish
   @idriszade/<pkg>@0.1.0` per affected package, fix, bump to `0.1.1`
   via new changeset, re-publish.
2. After 72h OR with dependents: deprecate the broken version
   (`npm deprecate @idriszade/<pkg>@0.1.0 "0.1.0 broken; use 0.1.1+"`),
   ship 0.1.1 with the fix.

Do NOT re-publish over an existing version (`npm publish` rejects this
by default).

---

## Brain post-ship admin (NOT executor scope — listed for transparency)

After report-back lands, brain will:

1. Refresh `pursuit/docs/HANDOFF.md` ("M0.5 + M0.5b shipped, all 17
   packages live at @idriszade/* 0.1.0; portfolio Sprint 1 unblocked").
2. Refresh `pursuit/STATUS.md`.
3. Save memory: `reference_kit_npm_scope.md` ("kit packages installable
   via `pnpm add @idriszade/<name>` from any repo at 0.1.0+").
4. Spawn portfolio-v2 Sprint 1 executor session per
   `pursuit/docs/briefs/portfolio_v2_sprint_1_m1_gtm_engine.md`.

---

*End of brief. Author: Pursuit brain (Opus 4.7). Drafted 2026-05-09;
revised 2026-05-09 to lock @idriszade scope + add rename surface as
Task 1. Branch: `m0-5b-npm-publish` off `master` tip `643e281`.
Predecessor: M0.5 ship at `1c340bc`.*
