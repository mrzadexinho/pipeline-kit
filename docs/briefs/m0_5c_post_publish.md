# Brief — M0.5c Post-Publish (lint-ignore spikes + Trusted Publishing OIDC)

> **Branch:** `m0-5c-post-publish` (off `master` tip `81dcd61`)
> **Author (brain):** pipeline-kit brain session, 2026-05-10
> **Estimated executor effort:** 30-45 minutes (single session)
> **Status:** Ready for executor pickup pending Idris's manual prereq
> (Section 0 — npmjs.com Trusted Publisher configuration).
> **Predecessor:** M0.5b npm publish shipped 2026-05-09 22:46 UTC via GHA
> run `25613752860`; all 17 packages live at `@idriszade/*@0.1.0`. Brief
> Q1 (org/scope blocker) RESOLVED — root cause was missing
> `NODE_AUTH_TOKEN` env, fixed in commit `85e78c2` and documented in
> CLAUDE.md release-flow at `2caf05e`.

**Strategic context:** M0.5b shipped to npm; the publish pipeline works.
Two follow-on debts now block clean ongoing operation:

1. **Release pipeline is RED on master.** Latest release run
   `25619647395` (master tip `81dcd61`, spike #3 push) failed at
   `pnpm lint` in 40s — Biome flagged 11 errors in
   `research/spikes/memory-feedback/**` (unsorted imports + multi-line
   formatting). Spike code is throwaway research per kit convention but
   biome.jsonc treats it as production-eligible. Every push to master
   now fires a red workflow; masks real failures + burns CI; no actual
   publish blocked because no pending changesets exist.

2. **Provenance attestation deferred.** `NPM_CONFIG_PROVENANCE: true` is
   commented out in `release.yml` line 57 (`TODO(post-v0.1.0)`). The
   chicken-and-egg constraint cited in M0.5b (Trusted Publisher needs
   the package to exist on npm first) is **resolved** — all 17 packages
   exist. Modern industry standard (2025-26) is OIDC-based publishing
   with sigstore provenance attestation = SLSA Build L3. Long-lived
   `NPM_TOKEN` is the legacy path. Lift forward now while the release
   pipeline is being touched anyway.

**Two coupled changes ship in this brief:**

1. **Lint-ignore `research/spikes/**`** in `biome.jsonc` so spike code
   stops blocking the release pipeline. ~1-line patch.
2. **Enable Trusted Publishing + provenance** in `release.yml` so the
   next real changeset publishes with sigstore attestation. ~3-line
   patch (uncomment the line + remove the `TODO(post-v0.1.0)` comment +
   one diagnostic step).

**Industry pattern lifted:** npm Trusted Publishing GA'd mid-2025 (per
`docs.npmjs.com/trusted-publishers`); same OIDC pattern used by Drizzle,
Mastra, tRPC, Effect, Vercel SDK. Provenance attestation requires
Trusted Publisher config — long-lived `NPM_TOKEN` with `--provenance`
flag is no longer accepted as of npm registry mid-2025.

---

## Section 0 — Manual prereq (Idris owns; cannot be delegated)

The executor cannot land Task 2 until 0.1 completes. **All steps below
are Idris's npm/GitHub account work** — they require credentials brain
+ executor never hold.

### 0.1 — Configure Trusted Publishers per package

For each of the 17 packages on npmjs.com:

1. Visit `https://www.npmjs.com/package/@idriszade/<pkg>/access`
2. Scroll to "Trusted Publisher" section.
3. Click "Add trusted publisher" → GitHub Actions.
4. Fields:
   - Repository owner: `mrzadexinho`
   - Repository name: `pipeline-kit`
   - Workflow filename: `release.yml`
   - Environment name: leave empty
5. Save.

If npmjs.com shows an **org-level Trusted Publisher** option under
`https://www.npmjs.com/settings/idriszade/trusted-publishers` (added to
free tier sometime in 2025-26), use that instead — single config covers
all 17 packages. Verify availability at edit time; if absent, fall back
to per-package config above.

### 0.2 — Confirm before spawning executor

After 0.1, verify by spot-check:

```bash
curl -s "https://registry.npmjs.org/@idriszade/core" \
  | jq '.["dist-tags"], .versions["0.1.0"]._npmUser'
```

(Visual check on npmjs.com that the trusted-publisher row is present is
also sufficient.)

**Confirm 0.1 done before spawning executor session.** If npmjs.com UI
has changed shape since this brief was authored, executor consults
`https://docs.npmjs.com/trusted-publishers` for current canonical
configuration steps.

---

## Section 1 — Engineering philosophy

Per `pipeline-kit/CLAUDE.md`:

- **TypeScript strict** — no new TS in this brief; config-only changes.
- **No emojis** in code, commit messages, changelogs, release notes.
- **File size:** 300 line soft / 500 hard. All edits in this brief
  touch existing files for net additions <10 lines.
- **No `--no-verify`** on any commit. Hooks run.
- **Idempotency:** every commit is `git revert`-able; each Task ships
  as one commit so revert surface stays surgical.

---

## Section 2 — References (read first; cite in commits as needed)

- **npm Trusted Publishers (canonical 2026):**
  https://docs.npmjs.com/trusted-publishers
- **npm provenance statements:**
  https://docs.npmjs.com/generating-provenance-statements
- **Biome `files.includes` schema:**
  https://biomejs.dev/reference/configuration/#files
- **changesets/action provenance docs:**
  https://github.com/changesets/action#with-publishing
- **GitHub Actions OIDC + npm:**
  https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect

**Lift PATTERNS not code.** No copy-paste from sibling repos.

---

## Section 3 — Stack locked

| Concern | Locked choice |
|---------|--------------|
| Lint-ignore mechanism | Biome `files.includes` negation pattern |
| Spike-ignore scope | `research/spikes/**` (NOT `research/**` — leave docs/notes lintable) |
| Provenance auth | Trusted Publishing OIDC (no NPM_TOKEN swap yet) |
| NPM_TOKEN env | KEEP for first OIDC publish (transition window); remove in separate brief after 2 OIDC publishes prove green |
| NODE_AUTH_TOKEN env | KEEP (same transition window rationale) |
| `release.yml` patch | Uncomment `NPM_CONFIG_PROVENANCE: true` + drop `TODO(post-v0.1.0)` comment block |
| Diagnostic step | Add `npm whoami` step before publish (zero-cost monitoring; surfaces auth identity in logs) |
| Validation strategy | Trigger workflow on master after merge; confirm gates green; provenance proven on next real changeset (NOT this brief) |

---

## Section 4 — Tasks in dependency order

### Task 1 — Lint-ignore `research/spikes/**` in biome.jsonc

**Edit `biome.jsonc` line ~9.** Current `files.includes` value:

```json
"includes": ["**", "!**/node_modules", "!**/dist", "!**/coverage", "!**/.changeset", "!**/*.md"]
```

Add one negation entry:

```json
"includes": ["**", "!**/node_modules", "!**/dist", "!**/coverage", "!**/.changeset", "!**/*.md", "!research/spikes/**"]
```

Rationale (do NOT inline as code comment — captured here):
research/spikes/* is throwaway research code per `CLAUDE.md`
phase-1 discipline; production lint rules don't apply. Future spike
parents (e.g. `research/scratch/`) are NOT pre-emptively ignored —
add only when the friction surfaces.

**Verify locally:**

```bash
pnpm lint  # exit 0 expected; no spike file in diagnostics
```

**Commit:**
```
chore(lint): exclude research/spikes from biome (throwaway code)
```

### Task 2 — Enable provenance + add npm whoami diagnostic in release.yml

**Edit `.github/workflows/release.yml`.**

(a) Replace lines 53-57 (the multi-line TODO comment block + the
commented `NPM_CONFIG_PROVENANCE` line) with the active env line:

```yaml
          NPM_CONFIG_PROVENANCE: true
```

(b) Insert a diagnostic step BEFORE the `Create Release Pull Request or
Publish` step (between `pnpm -r build` and the `changesets/action@v1`
step):

```yaml
      - name: npm whoami (diagnostic)
        run: npm whoami
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

This surfaces the npm identity the workflow is acting as; cheap
monitoring for the OIDC transition window.

**Commit:**
```
ci(release): enable npm provenance attestation (Trusted Publishing OIDC)
```

### Task 3 — Trigger workflow + verify gates green

After both commits land on `m0-5c-post-publish`, push the branch:

```bash
git push origin m0-5c-post-publish
```

**Do NOT merge to master yet.** First, trigger the workflow against the
branch:

```bash
gh workflow run release.yml --ref m0-5c-post-publish
gh run watch <id> --exit-status
```

Expected: gates 1-5 green (typecheck / lint / test / build / npm
whoami); `changesets/action@v1` step exits clean with "no changesets
to publish" (no actual publish happens because no `.changeset/*.md`
exists between `dd0f3f4` and HEAD). Provenance is **not** exercised
yet — it lights up on the next real changeset.

If gates green: fast-forward merge to master.

```bash
git checkout master
git merge --ff-only m0-5c-post-publish
git push origin master
```

If lint still fails (spike file not actually excluded), the fix is one
of: typo in the negation pattern OR the file lives outside
`research/spikes/`. Diagnostic: `pnpm lint --max-diagnostics 50` and
inspect the path of the surviving error.

If `npm whoami` fails on the diagnostic step, NPM_TOKEN is still
required for non-publish commands; either remove the diagnostic OR
allow it to fail-soft via `continue-on-error: true` and capture in
report-back.

---

## Section 5 — Verification gates (all must be green before report-back)

1. **Local lint:** `pnpm lint` exits 0; no `research/spikes/*` files in
   diagnostics.
2. **Local typecheck:** `pnpm typecheck` exits 0 (no regression).
3. **Local tests:** `pnpm test` — same count as M0.5b baseline (435
   passed + 2 skipped). No regressions.
4. **Local build:** `pnpm -r build` — every package emits non-empty dist.
5. **GHA Release workflow on branch:** green on `m0-5c-post-publish`
   before merge.
6. **GHA Release workflow on master:** green on the merge commit.
7. **Trusted Publisher visible:** spot-check one package on npmjs.com
   shows the trusted-publisher entry from Section 0.1.

Provenance attestation is NOT a gate in this brief — exercised at next
real version bump.

---

## Section 6 — Report-back format

At `~/Claude-Workspace/pipeline-kit/docs/briefs/m0_5c_report_back.md`:

```markdown
# M0.5c post-publish — report back

## Shipped
- biome.jsonc: research/spikes/** ignored (commit ref)
- release.yml: NPM_CONFIG_PROVENANCE enabled + npm whoami diagnostic
  added (commit ref)
- Trusted Publisher configured for N/17 packages (Idris confirmed)

## Verification
- Gates 1-7: pass/fail with evidence (links to GHA run, spot-check URL)
- Test count: M0.5b baseline N → post-merge N (no regression)

## Live evidence
- GHA run URL on branch
- GHA run URL on master merge
- npmjs.com URL of one package showing trusted-publisher entry
- Last 10 lines of `npm whoami` step output (confirms identity)

## OPEN QUESTIONS for brain
- Did Section 0.1 require per-package or org-level config? (informs
  CLAUDE.md release-flow text update)
- Any provenance prerequisite npmjs.com surfaced that this brief
  didn't anticipate?

## Discovered debt (named for follow-up briefs)
- E.g., NPM_TOKEN removal after 2 OIDC publishes prove stable
- E.g., process-classify peer-dep auto-major (carry-forward from
  M0.5b discovered debt #1)
```

---

## Section 7 — Non-goals

- **Do NOT bump any package version.** This brief is infra-only; no
  changesets created.
- **Do NOT remove NPM_TOKEN or NODE_AUTH_TOKEN env entries.** Keep as
  fallback during OIDC transition; removal ships in a separate brief
  after 2 successful OIDC publishes.
- **Do NOT pre-emptively ignore `research/**` (only `research/spikes/**`).**
  Research notes + outline files live under `research/` siblings and
  should remain lintable if they ever grow .ts files.
- **Do NOT touch CLAUDE.md release-flow section.** That's brain
  post-ship admin (Section "Brain post-ship admin" below).
- **Do NOT modify any package code, spec doc, or ADR.** Config-only.
- **Do NOT add new code anywhere in `src/`, `packages/*/src/`, or
  `packages/*/tests/`.**
- **Do NOT skip Section 0 manual prereq.** No workarounds — return to
  brain if 0.1 isn't doable on free-tier npm.
- **Do NOT bake security headers / sanitizers / etc.** Out of scope —
  atom-level concerns at Tier 4 per pack roster.

---

## Section 8 — Rollback path

**Pre-merge (branch-only):** revert both commits on the branch + force-
delete the branch. No external impact.

**Post-merge, before next real changeset:** revert release.yml change
to disable provenance (`git revert <commit-hash>`). Biome ignore can
stay — pure quality-of-life improvement, no failure mode. Push revert
commit to master. Trusted Publisher config on npmjs.com is harmless
without the `NPM_CONFIG_PROVENANCE: true` flag — leave it.

**Post-publish failure (next real changeset, if provenance fails):**
revert release.yml change as above; the next changeset publishes via
NPM_TOKEN fallback (still wired) without provenance attestation.
Re-investigate Trusted Publisher config + provenance prerequisites
in a fresh brief.

---

## Brain post-ship admin (NOT executor scope — listed for transparency)

After report-back lands, brain will:

1. Update `CLAUDE.md` Release flow section: drop "Trusted Publishing
   queued for v0.2.0+ — TODO(post-v0.1.0)" line; replace with "Trusted
   Publishing ENABLED 2026-05-10 in M0.5c (provenance on by default)."
2. Save memory entry: `project_pipeline_kit_m0_5b_shipped.md` (publish
   shipped 2026-05-09; Q1 RESOLVED via NODE_AUTH_TOKEN fix; 17 packages
   live at @idriszade/*@0.1.0).
3. Save memory entry: `project_pipeline_kit_m0_5c_shipped.md`
   (provenance enabled; release pipeline unblocked from spike lint
   regression).
4. Triage M0.5b discovered debt #1 (process-classify peer-dep
   auto-major) + #3 (ci.yml on `main` not `master`) + #4 (local pnpm
   9.15.4 vs CI pnpm 10) — bake into v0.2.0 brief or drop as
   non-blocking.

---

*End of brief. Author: pipeline-kit brain (Opus 4.7, 1M ctx). Drafted
2026-05-10. Branch: `m0-5c-post-publish` off `master` tip `81dcd61`.
Predecessor: M0.5b ship at GHA run `25613752860` (2026-05-09 22:46 UTC)
+ CLAUDE.md release-flow lock at `2caf05e`.*
