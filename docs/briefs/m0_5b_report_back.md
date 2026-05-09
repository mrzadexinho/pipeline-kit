# M0.5b scope rename + npm publish — report back

> Executor session, 2026-05-09. Branch `m0-5b-npm-publish` at tip
> `dd0f3f4` off `master` tip `9ba13bc`. Pushed to origin/master via
> fast-forward at `9ba13bc..dd0f3f4`. **Publish FAILED — blocked on
> Section 0 prereq (npm scope not actually accessible).**

## Status: PARTIAL — blocked on Idris's manual prereq

Tasks 1-7 fully complete (rename + lockfile + lint + workflow + version
+ dry-runs). Task 8 attempted three times, all blocked by external
factors. Task 9 + Task 10 cannot run until Task 8 succeeds.

## Shipped (locally green, pushed to master)

- **Rename complete:** `@pipeline-kit/*` → `@idriszade/*` across the
  codebase. 130 files / 371 refs touched, six rename commits +
  lockfile regen + lint auto-fix:
  - `731fec3` package.json names + cross-deps (17 files)
  - `da14b1a` TS source + tests (74 files)
  - `2c3075b` spec + research docs (10 files)
  - `51698e6` root README + cross-runtime spike (4 files)
  - `cf37fe7` historical brief notes (6 files; not find/replaced)
  - `fed7738` per-package READMEs + nested docs (18 files; gap fill —
    brief's commit list was missing this find target)
  - `b29d4db` pnpm-lock.yaml regen
  - `9691864` Biome auto-fix accumulated import-sort + format drift
    (33 files; pre-existing debt from research spikes added between
    M0.5 ship `1c340bc` and M0.5b brief tip `9ba13bc`)
- **`.changeset/config.json` baseBranch:** `main` → `master` at
  `b85e15f`.
- **Release workflow:** `.github/workflows/release.yml` at `78a19c7`
  (changesets/action@v1, fires on push to master, runs full
  typecheck/lint/test/build gates, then `pnpm changeset publish`).
  `NPM_CONFIG_PROVENANCE` deliberately commented out per executor
  adjustment (see Discovered Debt #2).
- **17 packages bumped 0.0.0 → 0.1.0** at `d2f7516`. CHANGELOG.md per
  package generated from the consumed
  `.changeset/initial-public-release.md`.
- **Discovered-debt fixes pushed to make publish work:**
  - `a90fca8` — drop external `gatewerk` build-time dep on
    process-reviewable, vendor a structural `GatewerkClient` interface
    locally.
  - `dd0f3f4` — add `onlyBuiltDependencies: [better-sqlite3]` to
    pnpm-workspace.yaml so pnpm 10 runs the postinstall on CI.

## Verification gates 1-5 (LOCAL — all pass)

| Gate | Status | Evidence |
|---|---|---|
| 1. Zero `@pipeline-kit/` refs outside historical briefs | PASS | `grep -rn "@pipeline-kit/" --exclude-dir=briefs` returns empty |
| 2. `pnpm typecheck` | PASS | All 17 packages emit `Done` |
| 3. `pnpm lint` exit 0 | PASS | 10 warnings + 18 infos, 0 errors (matches M0.5 baseline) |
| 4. `pnpm test` no regression | PASS | 71 test files / 435 passed + 2 skipped (437) — exact M0.5 baseline. Coverage 86.67% / 77.75% / 87.95% / 88% — exact M0.5 baseline |
| 5. `pnpm -r build` non-empty dist | PASS | All 17 packages emit `dist/index.js` + `dist/index.d.ts` + sourcemaps |
| 5b. `pnpm test:types` | PASS | 21 tests / 24 assertions across 3 test-d files |
| 5c. Per-package `pnpm publish --dry-run` | PASS | All 17 tarballs clean — only `dist/`, `package.json`, `README.md`, `LICENSE`. Sizes: core 30.3kB, others 2.7-9.0kB. |

## Verification gates 6-9 (CI / REGISTRY — BLOCKED)

| Gate | Status | Evidence |
|---|---|---|
| 6. GHA Release workflow green | FAIL | Three runs, last is `25613459772` — gates green, publish step fails with E404 PUT under `@idriszade` scope |
| 7. All 17 packages live at `0.1.0` | BLOCKED | `npm view @idriszade/core version` returns 404 (scope unreachable) |
| 8. Provenance badge | N/A | Deferred per executor adjustment; will re-enable per-package post-v0.1.0 (see Discovered Debt #2) |
| 9. Smoke install round-trip | BLOCKED | Cannot run until Task 8 succeeds |

### GHA run history

| Run | Trigger | Outcome | Cause |
|---|---|---|---|
| `25613275860` | Initial publish push (`d2f7516`) | FAIL | `pnpm install --frozen-lockfile` ENOENT on `gatewerk` file dep — sibling repo unavailable on runner |
| `25613391997` | After gatewerk fix (`a90fca8`) | FAIL | better-sqlite3 native binding missing — pnpm 10 didn't run postinstall |
| `25613459772` | After build-deps fix (`dd0f3f4`) | FAIL at publish step | All gates green; `pnpm changeset publish` returns E404 PUT for every `@idriszade/*` package |

## OPEN QUESTIONS for brain

### Q1 (BLOCKER) — Section 0 prereq state for `@idriszade` scope

The user-spawn message stated:

> 0.1 DONE: @idriszade npm org claimed under mrzadexinho ownership
> 0.2 DONE: NPM_TOKEN granular publish token (R+W on @idriszade scope,
>   90-day expiry, 2FA bypass enabled) is set as GitHub Actions secret

But the third GHA run failed with this error pattern across all 17
packages:

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@idriszade%2fsource-api - Not found
npm error 404  '@idriszade/source-api@0.1.0' is not in this registry.
```

E404 on PUT for a first-time publish typically means the npm registry
is rejecting the PUT because either the org doesn't exist OR the auth
token doesn't have R+W on the scope.

**External evidence:**

```bash
$ curl -s "https://registry.npmjs.org/-/org/idriszade"
{"code":"ResourceNotFound","message":"/-/org/idriszade does not exist"}

$ curl -s "https://registry.npmjs.org/-/v1/search?text=scope:idriszade&size=5"
{"objects":[],"total":0,...}

$ curl -s -o /dev/null -w "%{http_code}\n" "https://registry.npmjs.org/@idriszade%2fcore"
404
```

The registry returns no record of `idriszade` org and no `@idriszade/*`
packages. (Side note: `mrzadexinho` IS an active publisher — six
public packages including `@mrzadexinho/scanline`, `@mrzadexinho/codeguard`,
`@mrzadexinho/docguard` under the personal `@mrzadexinho` scope.)

**Need from Idris:**

1. Visit npmjs.com and verify `https://npmjs.com/~idriszade` resolves
   to an org page (not 404).
2. Verify `mrzadexinho` is a member of the `idriszade` org with publish
   rights.
3. Verify the `idriszade-npm-publish-2026-05-09` granular token has
   R+W on `@idriszade/*` (not `@mrzadexinho/*` — easy slip during token
   creation).
4. After fixing whichever of the three above is wrong, re-run the
   workflow:

```bash
cd ~/Claude-Workspace/pipeline-kit
gh workflow run release.yml --ref master
```

If the workflow still fails after Idris verifies all three, the next
diagnostic is to add a `npm whoami` step to the workflow before
publish to confirm what user the token resolves to in CI.

### Q2 — Trusted Publishing config post-v0.1.0

Per the executor adjustment, `NPM_CONFIG_PROVENANCE: true` is commented
out in `release.yml` for the v0.1.0 ship — Trusted Publishing is
configured per-package on npmjs.com and requires the package to exist
on npm first. Once Q1 is resolved and v0.1.0 lands across all 17
packages, Idris must:

1. Visit `npmjs.com/package/@idriszade/<each>/access` (or org-level
   Trusted Publishers settings if available).
2. Add a publisher: GitHub repo `mrzadexinho/pipeline-kit`, workflow
   `release.yml`, branch `master`.
3. Repeat for each of the 17 packages (or batch-configure at the org
   level if free-tier supports it).
4. Re-enable `NPM_CONFIG_PROVENANCE: true` in `release.yml` for v0.2.0+.

This is the only path to provenance attestation on free-tier orgs in
2026.

## Discovered debt (named for follow-up briefs)

1. **process-classify peer-dep auto-major** — process-classify
   optionally peer-depends on `@idriszade/process-extract` via
   `workspace:*`. changesets-cli v2 auto-bumps a package to MAJOR when
   a peer-dep is bumped, even if the explicit changeset entry says
   minor (peer changes are conventionally breaking). Ergonomic fix
   options: (a) remove the optional peer-dep entirely if classify
   doesn't actually need extract, (b) replace peer-dep with structural
   typing pattern (same fix as gatewerk), or (c) add fixed/linked
   group config in `.changeset/config.json` to override. v0.1.0 was
   manually corrected in `d2f7516` — proper fix queued for the brief
   that drafts v0.2.0.
2. **Trusted Publishing per-package config** — see OPEN QUESTION Q2.
   Brief that re-enables `NPM_CONFIG_PROVENANCE` after v0.1.0 lands.
3. **`.github/workflows/ci.yml` is on `main`, not `master`** — this
   pre-existing CI workflow only fires on push to a non-existent `main`
   branch. Out of M0.5b scope but means PRs to master haven't been
   gated by CI since the kit's inception. Quick fix: flip
   `branches: [main]` → `branches: [master]` in ci.yml. Bake into the
   v0.2.0 brief or a follow-up infra brief.
4. **Local pnpm 9.15.4 vs `packageManager: pnpm@10.33.4`** — Idris's
   machine still runs pnpm 9; CI runs 10. Lockfile is read-compatible
   both ways, but pnpm 10's stricter build-script handling
   (onlyBuiltDependencies) only fires in CI, so local installs miss
   the surface. Brain may want to bump local install to pnpm 10 or
   document the divergence.
5. **Throwaway commit `8ed8b78` on local master not pushed** — Idris's
   local master had `v1 cat-V spike #1 — deps-shape-lift (throwaway)`
   one commit ahead of origin/master at session start. M0.5b push
   advanced origin/master from `9ba13bc` to `dd0f3f4` directly, which
   leaves `8ed8b78` orphaned locally. Idris can either rebase it onto
   the new master tip or discard.
6. **Brief commit list missed `packages/*/README.md`** — Brief Section
   4 Task 1 ran `find docs -maxdepth 1 -name "*.md"` for the docs
   commit; docs commit also needed `packages/*/README.md` and
   `packages/serve-mcp/docs/install-providers.md`. Caught + fixed by
   the verification grep. Add to brief template for any future
   monorepo-scope rename briefs.

## Branch state

```
* m0-5b-npm-publish dd0f3f4 fix(pnpm): approve better-sqlite3 build script for pnpm 10 CI
                    a90fca8 fix(process-reviewable): drop external gatewerk dep, vendor structural type
                    d2f7516 chore(release): version packages 0.1.0
                    78a19c7 ci(release): add changesets-based publish workflow
                    b85e15f fix(changeset): align baseBranch with kit's master
                    9691864 chore(lint): biome auto-fix accumulated import-sort + format drift
                    b29d4db chore(rename): regenerate pnpm-lock.yaml under @idriszade scope
                    fed7738 chore(rename): scope refs in per-package READMEs + nested docs
                    cf37fe7 chore(briefs): note scope rename on historical briefs
                    51698e6 chore(rename): scope refs in README + spike code
                    2c3075b chore(rename): scope refs in spec + research docs
                    da14b1a chore(rename): scope refs in TS source + tests
                    731fec3 chore(rename): @pipeline-kit/* → @idriszade/* across package.json files
                    9ba13bc (master previous tip — brief authored)
```

origin/master and origin/m0-5b-npm-publish both at `dd0f3f4`. All
13 commits pushed.

## What Idris needs to do next

1. **Resolve Q1** — verify `@idriszade` org exists on npmjs.com,
   verify `mrzadexinho` membership, verify token scope. Most likely
   path: re-claim the org, re-issue the token scoped to `@idriszade/*`,
   update the `NPM_TOKEN` secret on the GitHub repo.
2. **Re-trigger the workflow** — `gh workflow run release.yml --ref
   master` (or push any trivial commit to master).
3. **Watch the run** — `gh run watch <id> --exit-status`. If it
   succeeds, all 17 packages land at `0.1.0`. If it fails again, the
   error message will tell us which of the three sub-issues remains.
4. **Smoke install (Task 10)** — once registry has the packages:

```bash
cd /tmp && mkdir pk-smoke && cd pk-smoke
pnpm init
pnpm add @idriszade/core @idriszade/source-apify
echo 'import { Pipeline } from "@idriszade/core";' > smoke.ts
echo 'console.log(typeof Pipeline);' >> smoke.ts
npx tsx smoke.ts
```

Round-trip green = Sprint 1 brief Task 0.2 unblocked.

5. **Q2 — Trusted Publishing per-package config**, then re-enable
   provenance in `release.yml` for v0.2.0+.

## Appendix — Per-package dry-run summary

| Package | Version | Tarball | Files | Leak |
|---|---|---|---|---|
| core | 0.1.0 | 30.3 kB | 167 | clean |
| process-classify | 0.1.0 | 5.1 kB | 15 | clean |
| process-extract | 0.1.0 | 9.0 kB | 31 | clean |
| process-reviewable | 0.1.0 | 7.6 kB | 31 | clean |
| process-route | 0.1.0 | 2.7 kB | 11 | clean |
| process-validate | 0.1.0 | 2.9 kB | 11 | clean |
| serve-email | 0.1.0 | 8.2 kB | 27 | clean |
| serve-mcp | 0.1.0 | 4.6 kB | 11 | clean |
| serve-slack | 0.1.0 | 5.0 kB | 11 | clean |
| serve-webhook | 0.1.0 | 5.1 kB | 11 | clean |
| source-api | 0.1.0 | 8.3 kB | 19 | clean |
| source-apify | 0.1.0 | 5.6 kB | 15 | clean |
| source-mcp | 0.1.0 | 6.5 kB | 15 | clean |
| source-webhook | 0.1.0 | 7.6 kB | 19 | clean |
| store-pgvector | 0.1.0 | 8.7 kB | 19 | clean |
| store-postgres | 0.1.0 | 8.4 kB | 19 | clean |
| store-sqlite | 0.1.0 | 8.0 kB | 15 | clean |

Total: 17 packages / 133.6 kB combined. All within brief's <100KB
per-package guidance for v0 (core's 30.3kB is the largest; expected
since it's the orchestration kernel).
