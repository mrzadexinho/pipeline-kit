# Brief — M11 TP-OIDC Structural Fix + ADR M11-1 (entry)

> **Summary (decisions front-loaded):**
> - 3 units, sequential; M11 headline is U1 TP-OIDC structural plumbing fix + ADR M11-1.
> - Wave 1 order: U2 diagnosis doc rewrite first (corrects falsified claims), then U3 observe
>   exports fix, then U1 TP-OIDC plumbing + ADR M11-1 last (release.yml destructive; must land
>   after doc and observe fixes prove clean).
> - U2 lands first because `tp-oidc-claim-diagnosis.md` contains falsified Hyp A+B conclusions
>   from M9/M10 that would mislead U1 investigation; must be corrected before touching release.yml.
> - U1 root causes: `actions/setup-node` `registry-url` writes `_authToken` to `.npmrc` that npm
>   CLI prioritizes over OIDC even when env unset (npm/cli #8730); `changesets/action` `publish:`
>   subprocess does NOT inherit OIDC env vars (npm/cli #8976); upstream fix not merged
>   (actions/setup-node PR #1477). Community working pattern: drop `registry-url`, strip
>   `publish:` from changesets/action, add bare-shell `npm publish` step with `id-token: write`.
> - U1 STOP-and-bump policy: if OIDC publish 404s/403s, do NOT add NPM_TOKEN back. Freeze branch.
>   Capture full log. Up to 3 variant fixes before brain ratifies ADR M11-1 'Bridge' path.
> - ADR M11-1 ratified at U1 close in `docs/development/release-auth-posture.md`. Status set to
>   'Success' or 'Bridge' per publish outcome. 3 revisit triggers locked regardless of outcome.
> - ADR ledger: 55/55 Cat-scoped UNCHANGED. M11-1 is infrastructure, tracked separately.
> - No changeset needed for U2 or U3. U1 includes one no-op patch changeset to trigger publish.

**Branch prefix:** `m11-u{N}-<slug>` per unit (see unit table below).
**Author (brain):** 2026-05-24
**Estimated executor effort:** 6-12 hours (1-2 sessions)
**Status:** Ready for executor pickup. Cut each unit branch from master tip `0652267`.
**Predecessor:** M10 shipped PARTIAL 2026-05-23 at `a3626f6`; master tip `0652267`;
TP-OIDC carry is M11 headline.

Per-unit detail in [`m11_executor_brief_units.md`](m11_executor_brief_units.md).

---

## State at M11 start

- Master tip: `0652267` (M10 close-out + gitignore/format fixes).
- Tests: 1373+ passing (26 Bun-skipped unchanged). Confirm baseline with `pnpm test` at session start.
- ADRs: 55/55 Cat-scoped — fully ratified. M11 produces 1 NEW infrastructure ADR (M11-1) tracked
  separately in `docs/development/release-auth-posture.md`.
- Packages on npm: 33 `@idriszade/*` packages with sigstore provenance; NPM_TOKEN auth (M10
  rollback). All 33 have Trusted Publishing configured on npmjs.com.
- Python: `pkit-process 0.1.0` live on PyPI (M10 U2 success).
- GHA actions: `ci.yml` + `release.yml` on Node 24-compatible SHAs (M10 U3 shipped).
- TP-OIDC: 4 failed attempts across M7-M10; structural root causes now known via community evidence
  (npm/cli #8730 + #8976). U1 implements the community working pattern.

**Industry context (OpenSSF + OpenJS 2025-2026 publish-auth posture):**
npm classic tokens REVOKED 2025-12-09 (no grandfather). Granular tokens capped at 90-day max
lifetime. npm Trusted Publishing GA 2025-07-31; explicitly recommended for OSS publish
(https://docs.npmjs.com/trusted-publishers/). Working OSS examples: vitejs/vite (pure OIDC,
separate publish.yml), vercel/ai (changesets + OIDC, no NPM_TOKEN — pre-existing packages
sidestepped npm/cli #8544 initial-publish bug). "NPM_TOKEN long-term" framing is structurally
untenable; bridge-token-with-revisit-triggers is the modern posture.

## What ALREADY exists (do not recreate)

- `.github/workflows/release.yml` — Node 24-compatible SHAs; NPM_TOKEN auth restored after M10 U1
  rollback; changesets/action with `publish:` param active. **Known gaps fixed by U1:**
  `changesets/action@v1` is FLOATING (not SHA-pinned) and step has no `id:` field; both required
  for the bare-shell publish step's `steps.changesets.outputs.hasChangesets` reference.
- `.github/workflows/oidc-token-debug.yml` — diagnostic workflow; re-run at U1 pre-flight.
- `docs/development/tp-oidc-claim-diagnosis.md` — 301 lines; contains falsified Hyp A+B conclusions
  (U2 corrects this). Diagnostic recipe sections (Steps 1-4) remain valid and are preserved.
- `packages/observe/package.json` — exports map pointing to `./src/index.ts` (U3 fixes this).
- `docs/development/pypi-publisher-setup.md` — M9 reference doc; no changes in M11.

---

## Package surface

| Package | Tier | Change | Version bump |
|---------|------|--------|--------------|
| `@idriszade/core` (+ transitive) | 1-3 | no new package; U1 no-op patch changeset only | patch on one pkg |
| `@idriszade/observe` | 2 | `package.json` exports map fix only | no version bump (build config fix) |
| `pkit-process` (PyPI) | Python | no changes in M11 | unchanged at 0.1.0 |

---

## Scope — 3 units (one-liner table)

| Unit | Name | Branch | Detail |
|------|------|--------|--------|
| 2 | TP-OIDC diagnosis doc rewrite | `m11-u2-diagnosis-rewrite` | Correct falsified Hyp A+B in `tp-oidc-claim-diagnosis.md`; add community evidence sections |
| 3 | @idriszade/observe exports fix | `m11-u3-observe-exports` | Point `exports` map to `./dist/index.js`; Gate 7 green under Node 26 |
| 1 | TP-OIDC structural fix + ADR M11-1 | `m11-u1-tpoidc-fix` | Drop `registry-url`; strip `changesets/action publish:`; add bare-shell `npm publish` step; ratify ADR M11-1 |

---

## Wave sequencing

```
Wave 1 — sequential (brain gates between each):

  Step 1: U2 diagnosis doc rewrite  (m11-u2-diagnosis-rewrite)
          Pure docs. No release.yml touched.
          FF-merge after biome+typecheck green + brain inline review.

  Step 2: U3 observe exports fix  (m11-u3-observe-exports)
          Single package.json edit; Gate 7 local + CI green.
          FF-merge after Gate 7 verified.

  Step 3: U1 TP-OIDC structural fix + ADR M11-1  (m11-u1-tpoidc-fix)
          Headline; STOP-gated; ADR ratification at close.
          FF-merge only after either:
            (a) OIDC publish verified via run log + ADR M11-1 'Success' path ratified, OR
            (b) <= 3 publish variants exhausted + ADR M11-1 'Bridge' path ratified.
```

---

## ADR ledger after M11

| Item | Status after M11 |
|------|-----------------|
| All 55 Cat-scoped ADRs | UNCHANGED |
| ADR M11-1 (publish auth posture) | NEW — `docs/development/release-auth-posture.md` |
| ADR IX-6 (idempotencyKey wire shape) | Still informal; defer to M12 when >= 2 adapters use it |

---

## Risk / ADR-surface

**U1 STOP-and-bump policy (binding):**
If OIDC publish returns 404 or 403 after plumbing changes:
- Do NOT add NPM_TOKEN back automatically.
- Freeze branch. Capture full publish step log.
- Attempt up to 3 variant fixes if root cause suggests one (permissions placement,
  workspace form, etc.).
- After 3 failed publish variants: STOP. Brain ratifies ADR M11-1 'Bridge' path.
- No milestone close until ADR M11-1 ratified with documented direction.

**U3 STOP trigger:**
If consumers break after observe exports change (e.g., observe-vercel can't resolve
symbols), STOP and capture import error. Escalate to brain before proceeding.

**No new Cat-scoped ADR surface expected.** If executor finds a design-forcing constraint,
STOP and escalate rather than deciding inline.

---

## Carry-forwards expected into M12+

**REMOVED from M10 list (now in M11):**
- TP-OIDC publish path fix
- tp-oidc-claim-diagnosis.md falsification corrections
- @idriszade/observe exports fix

**NEW from M11:**
- changesets/action #515 monitoring (revisit trigger; link in ADR M11-1).
- npm/cli #8544 monitoring (initial-version OIDC for future new packages).
- NPM_TOKEN removal (if ADR M11-1 'Success' path; auto-cleanup after 6 clean TP-OIDC publishes).

**KEPT from M10 (still deferred):**
- ADR IX-6 idempotencyKey wire shape (no 2nd adapter in M11).
- 26 Bun-incompatible skipped tests.
- `packages/core/src/wire/lsp-frame.ts` 456-LOC split (preventive).
- `process-extract` Python mirror.
- PEP 740 PyPI attestations.
- Renovate/Dependabot setup.
- Branch protection / require-PR-for-master (separate session).
- Cat IX cf #1/#2/#3/#5 (separate research session).

---

## Non-goals (explicit — reject in review if raised)

- New Cat-scoped (I-X) ADR ratification in M11.
- `process-extract` Python mirror.
- PEP 740 PyPI attestations.
- Bun-compat skipped test fixes.
- Renovate/Dependabot setup.
- Branch protection rules.
- `packages/core/src/wire/lsp-frame.ts` refactor.
- Cat IX cf spikes.
- Removing `secrets.NPM_TOKEN` from GitHub repo secrets (keep 6 months minimum even on
  ADR M11-1 'Success' path).

---

## Verification gates

All 10 must be green before M11 ship:

```bash
pnpm typecheck                                         # Gate 1
pnpm biome check . --max-diagnostics=500               # Gate 2 (NOT pnpm lint)
pnpm test                                              # Gate 3 — Vitest 1373+ passing
pnpm build                                             # Gate 4
pnpm format                                            # Gate 5
uv run --frozen pytest packages/adapter-python-process/  # Gate 6
pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
  --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
  --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check  # Gate 7
# Gate 8: ci.yml green on PR (gh run view <run-id> --log; Node 20+22 + python matrix)
# Gate 9 (NEW): release.yml publish step shows OIDC indicator in run log
#   ("publishing via trusted publisher" or equivalent) OR ADR M11-1 'Bridge' path
#   ratified with documented bridge-token outcome.
# Gate 10 (NEW): docs/development/release-auth-posture.md exists; Status + Decision +
#   3 revisit triggers all present; ADR M11-1 ratified.
```

---

## Working rules (BINDING)

- **Model routing:** sonnet = CRUD/tests/scaffolding; haiku = trivial git lookups; opus = judgment.
  Always pass `model:` explicitly.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Branch discipline:** each unit has its own branch; executor bound to branch explicitly.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **SHA-pin GHA actions:** match existing `@<SHA> # <semver>` pattern; no `@v6` floating pins.
- **U1 STOP-and-bump:** never auto-rollback on 404/403; freeze + escalate (see Risk section).
- **U1 cumulative-failure cap:** <= 3 publish variants before ADR M11-1 'Bridge' ratification.
- **ADR M11-1 ratification gate:** brain decides Success vs Bridge direction at U1 close.
- **U3 consumer-break STOP:** if observe-vercel or any consumer breaks after exports change,
  freeze branch and escalate before proceeding.
- **File-size limits:** 300 LOC soft, 500 LOC hard (TS/YAML files).
- **No `--amend`, `--force`, `--no-verify`, `--no-edit` on commits.**

---

## Report-back format

On completion, executor writes `docs/briefs/m11_report_back.md` with:
- Commits table (hash + description, one row per commit).
- Per-unit summary paragraph.
- Gates table (gate name / status / detail).
- ADR M11-1 ratified direction (Success vs Bridge) with evidence.
- OIDC token claim diff vs M9 baseline (or "no drift observed").
- NPM_TOKEN type verification result (granular vs automation; expiry date).
- Each publish attempt outcome (URL + HTTP code if applicable).
- Revisit trigger watch list with current issue status snapshot.
- Carry-forwards (new from M11 + outstanding from M10+).

---

*M11 brief locked 2026-05-24. Cut each unit branch from master tip `0652267`. Confirm 1373+ test
baseline and Gates 1-7 green before Wave 1 step 1 (U2).*
