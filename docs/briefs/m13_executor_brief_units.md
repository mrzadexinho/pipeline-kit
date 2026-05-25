# M13 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m13_executor_brief.md`](m13_executor_brief.md)):**
> - U1 = `.github/dependabot.yml` cosmetic fix (drop `include: scope`) + merge 6 safe PRs; defer
>   #20/#23/#25 to U5.
> - U2 = `.github/workflows/codeql.yml` (new, TS+Python matrix, security-extended) +
>   `docs/development/scorecard-baseline.md` + job-level `permissions:` hardening across all
>   workflows. CodeQL first-run populates code-scanning dashboard; SAST 0→10.
> - U3 = `packages/adapter-python-process-extract/` scaffold + Python port of TS
>   `process-extract` + `publish-python-process-extract` job in `release.yml` + PyPI TP
>   registration (manual pre-flight). `pkit-process-extract 0.1.0` on PyPI with PEP 740.
> - U4 = ADR IX-6 append to `docs/research-notes-v1-cat-IX.md` (Status: Accepted; gate relaxed
>   to "2nd adapter any language"); spec index 55→56. Docs-only, no code.
> - U5 = Merge #23 (zod 4) → #20 (fast-check 4) → #25 (vitest 4) in that order; patch breaking
>   changes before each merge; cascade publish advances bridge counter 2/6→3/6.
> - Wave plan: U1 + U2 + U3 in parallel (Wave 1); U4 + U5 sequential after Wave 1 (Wave 2).
> Read entry brief for all 17 verification gates, working rules, and out-of-scope list.

---

## U1 — Dependabot triage + cosmetic config fix

### Goal

Clear 6 of 9 open Dependabot PRs; fix the double-prefix commit-message bug introduced in M12;
defer the 3 major v-bumps (zod/fast-check/vitest) to U5.

### Background: double-prefix bug

M12 shipped `dependabot.yml` with `commit-message.include: scope` on all three ecosystem blocks.
Dependabot's behavior when `include: scope` is set alongside a custom `prefix-development` is to
append the detected scope in parentheses after the prefix — producing titles like
`chore(deps-dev)(deps-dev): bump X`. Root cause: Dependabot treats the group name as the scope
and injects it after the custom prefix, which already contains the scope hint. Fix: drop
`include: scope` from all three blocks; keep `prefix:` and `prefix-development:`.

### Subtask U1.1 — Cosmetic config fix

Edit `.github/dependabot.yml`:
- Lines 25-28 (npm block): remove `include: scope` key; keep `prefix: "chore(deps)"` and
  `prefix-development: "chore(deps-dev)"`.
- Lines 45-47 (github-actions block): remove `include: scope`; keep `prefix: "chore(ci)"`.
- Lines 69-71 (uv/python block): remove `include: scope`; keep `prefix: "chore(deps-py)"`.

Verify YAML is still valid after edit: `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"`.

### Subtask U1.2 — Merge safe group PRs

**PR #17** (actions/github-script 7→9, github-actions-all group): merge directly. v9 is a
well-tested, widely-deployed release with no breaking API changes for script steps.

**PR #18** (js-dev-minor-patch group, 5 updates): BEFORE merging, run
`gh pr view 18 --json files,body` to confirm group contents. Reject merge if group includes
vitest, fast-check, or zod patches (those belong to U5 majors). If clean, merge.

**PR #19** (js-prod-minor-patch group, 4 updates): same pre-flight check — confirm no zod patch
in group. If clean, merge.

### Subtask U1.3 — Merge individual majors with low blast radius

**PRs #21 + #22** (testcontainers + @testcontainers/redis 10→11): MUST merge together; they are
a paired major bump (shared internal ABI). Pre-merge: grep for constructor usage:
`grep -rn "new GenericContainer\|new RedisContainer\|new TestContainer" packages/*/tests/ packages/*/src/__tests__/`
Review any direct constructor calls against testcontainers v11 release notes (main change:
constructor accepts `ImageName` object in v11; bare string still works but deprecated). Patch if
needed. Stage both PR merges in sequence before running tests.

**PR #24** (google-auth-library 9→10): blast radius is `packages/adapter-secrets-oidc/` only
(the `gcp.ts` adapter uses a lazy dynamic import of `googleapis` and `google-auth-library`).
Before merging: check v10 changelog for `GoogleAuth` constructor changes and `getAccessToken()`
return shape. Current usage pattern in `gcp.ts` uses `new GoogleAuth({ scopes: [...] })` +
`.getAccessToken()`. If API unchanged, merge; if breaking, patch `gcp.ts` first.

### Subtask U1.4 — Defer remaining 3 to U5

PRs #20 (fast-check 3→4), #23 (zod 3→4), #25 (vitest 3→4): DO NOT merge. Add a comment to each
PR: "Deferred to M13 U5 — will be merged with pre-emptive breaking-change patching."

### STOP gate

6 PRs closed (#17, #18, #19, #21, #22, #24). `gh pr list --author "app/dependabot" --json
number,title` returns exactly 3 PRs: #20, #23, #25.

### Verification

```bash
gh pr list --author "app/dependabot" --json number,title
# Expected: [{"number":25,...},{"number":23,...},{"number":20,...}] — exactly 3

pnpm -r build && pnpm test && pnpm biome check . --max-diagnostics=500
```

### Commit policy

1. `chore(ci): fix dependabot commit-message double-prefix (drop include: scope)`
2. Individual merge commits per PR (GitHub squash-merge; no custom message needed)

---

## U2 — Scorecard baseline + CodeQL + Token-Permissions hardening

### Goal

Advance OpenSSF Scorecard from 4.3/10 to ~5.5–6.5/10 by adding CodeQL (SAST 0→10) and
hardening workflow token permissions (Token-Permissions 0→9+). Capture the 4.3 baseline as a
reference document before any score changes.

### Research anchor

OpenSSF Scorecard check definitions (2026):
- SAST: repository must run a recognized SAST tool (CodeQL, Semgrep, Snyk) in CI. Score 10 = tool
  runs on every PR. CodeQL `security-extended` query suite is the highest-signal default.
- Token-Permissions: workflows must declare `permissions: read-all` top-level OR all jobs must
  declare explicit `permissions:` blocks. Score 10 = all jobs have explicit declarations.
- Code-Review, Maintained, Signed-Releases: not targeted in M13 (branch protection = separate
  session; signed releases already at npm/PyPI layer but Scorecard checks git tags).

### Subtask U2.1 — Scorecard baseline document

Create `docs/development/scorecard-baseline.md`:

```markdown
# OpenSSF Scorecard — Baseline (M12 close, 2026-05-25)

**Score:** 4.3 / 10
**Source:** https://scorecard.dev/viewer/?uri=github.com/mrzadexinho/pipeline-kit
**API:** https://api.securityscorecards.dev/projects/github.com/mrzadexinho/pipeline-kit

## Per-check breakdown (at M12 close)

| Check | Score | Notes |
|-------|-------|-------|
| Pinned-Dependencies | 9 | SHA-pinned GHA actions; minor gaps |
| Packaging | 10 | npm publish detectable |
| License | 10 | MIT license in repo |
| Dangerous-Workflow | 10 | No untrusted input in run: steps |
| Binary-Artifacts | 10 | No committed binaries |
| Fuzzing | 10 | Not applicable (no fuzz target) |
| SAST | 0 | CodeQL not yet added (M13 U2) |
| Token-Permissions | 0 | Job-level permissions blocks not yet added (M13 U2) |
| Code-Review | 0 | Branch protection intentionally deferred (separate user session) |
| Maintained | 0 | Score based on commit frequency heuristic; may update as activity continues |
| Signed-Releases | -1 | npm + PyPI sigstore provenance present but Scorecard checks git-tag signing |

## Post-M13 projection

SAST fix (+CodeQL): 0→10 (+1.0 weighted)
Token-Permissions fix (+job-level perms): 0→9 (+0.9 weighted)
Expected range: 5.5–6.5 / 10

## Intentionally deferred zeros

- Code-Review (0): requires branch protection rules. Deferred to separate user session.
- Maintained (0): purely activity-heuristic; no action needed.
- Signed-Releases (-1): Scorecard looks for GPG/SSH-signed git tags. npm/PyPI provenance
  attestations are not equivalent in Scorecard's model. Deferred — not a priority vs other checks.
```

### Subtask U2.2 — CodeQL workflow

Create `.github/workflows/codeql.yml`:

```yaml
name: CodeQL analysis
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
  schedule:
    - cron: '25 3 * * 1'  # Monday 03:25 UTC
  workflow_dispatch:

permissions: read-all

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      actions: read
      contents: read
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, python]
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Initialize CodeQL
        uses: github/codeql-action/init@7211b7c8077ea37d8641b6271f6a365a22a5fbfa # v4.36.0
        with:
          languages: ${{ matrix.language }}
          queries: security-extended

      - name: Autobuild
        uses: github/codeql-action/autobuild@7211b7c8077ea37d8641b6271f6a365a22a5fbfa # v4.36.0

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@7211b7c8077ea37d8641b6271f6a365a22a5fbfa # v4.36.0
        with:
          category: '/language:${{ matrix.language }}'
```

Add CodeQL badge to `README.md` near the existing Scorecard badge:

```markdown
[![CodeQL](https://github.com/mrzadexinho/pipeline-kit/actions/workflows/codeql.yml/badge.svg)](https://github.com/mrzadexinho/pipeline-kit/actions/workflows/codeql.yml)
```

**SHA note:** The `7211b7c8077ea37d8641b6271f6a365a22a5fbfa` SHA is specified verbatim. Do NOT
re-resolve at edit time — use it exactly as given.

### Subtask U2.3 — Token-Permissions hardening

Inventory current state:
```bash
grep -l "permissions:" .github/workflows/*.yml
```
For each workflow file missing job-level `permissions:` blocks, add the minimum required. Pattern:
- Read-only jobs (CI lint/typecheck/test): `permissions: { contents: read }`
- Publish jobs (already have `id-token: write`): verify explicit declaration present
- Scorecard job: already has correct job-level permissions from M12
- New CodeQL job: specified in U2.2 above

Top-level `permissions: read-all` is the secure default where appropriate. The goal is: no job
relies on default `permissions: write-all` (GitHub's implicit default for older workflows).

### STOP gate

CodeQL workflow first run green on push to master (both TS and Python matrix legs pass);
`scorecard-baseline.md` committed; all workflows audited and job-level permissions present;
do NOT wait for Scorecard score rescan before closing U2 (rescan is weekly).

### Verification

```bash
# CodeQL first run
gh run list --workflow=codeql.yml --limit 3

# Permissions audit — should show all workflow files
grep -l "permissions:" .github/workflows/*.yml | wc -l
ls .github/workflows/*.yml | wc -l
# Both counts must match (every file has at least one permissions block)

# scorecard-baseline.md present
ls docs/development/scorecard-baseline.md
```

### Commit policy

1. `docs: add OpenSSF Scorecard baseline (M12 close, 4.3/10)`
2. `chore(ci): add CodeQL workflow (TS + Python, security-extended)`
3. `docs: add CodeQL badge to README`
4. `chore(ci): add job-level permissions blocks to all workflows (Token-Permissions hardening)`

---

## U3 — `process-extract` Python mirror

### Goal

Create `packages/adapter-python-process-extract/` — a Python port of the TS `process-extract`
adapter — and publish `pkit-process-extract 0.1.0` to PyPI with PEP 740 attestation via the M12
pypa-action pattern.

### Research anchor

TS source: `packages/process-extract/src/extract-process.ts` (236 LOC).
- `ExtractProcessConfig<I,O>` at line 16 (10 fields)
- `createExtractProcess<I,O>(config)` at line 157 — builds a `Process<I,O>` with provider
  dispatch, JSON Schema extraction via `zod.toJSONSchema`, and retry-on-schema-parse-failure loop

Python equivalence:
- `ExtractProcessConfig` → Pydantic model (same 10 fields; `output_schema` takes a Pydantic model
  class; `input_schema` optional Pydantic model class)
- JSON Schema: `output_schema.model_json_schema()` (Pydantic v2 built-in; mirrors `zod.toJSONSchema`)
- Provider dispatch: lazy dynamic import per `provider` field (mirrors TS dynamic require pattern)
- Result envelope: `ProcessResult` dataclass with `ok: bool`, `data: O | None`, `error: dict | None`
  — OR reuse `pkit_wire.decode_result` shape if it matches; executor decides based on what's
  available in the pkit-process package

### Subtask U3.1 — Package scaffold

Create `packages/adapter-python-process-extract/` with:

**`pyproject.toml`:**
- `[project]` name = `pkit-process-extract`, version = `0.1.0`, `requires-python = ">=3.12"`
- Build system: `hatchling` (mirrors pkit-process)
- Wheel target: `src/pkit_process_extract`
- Runtime deps: `anyio>=4.0`, `pydantic>=2.13.4`, `opentelemetry-api>=1.0`,
  `opentelemetry-sdk>=1.0`
- Optional extras: `[project.optional-dependencies]` — `anthropic = ["anthropic"]`,
  `openai = ["openai"]`, `gemini = ["google-generativeai"]`
- Dev deps: `[dependency-groups] dev` (uv convention) — `pytest>=9.0`, `pytest-asyncio>=0.24`,
  `hypothesis>=6.100`
- `[tool.hatch.build.targets.wheel] packages = ["src/pkit_process_extract"]`
- `[tool.pytest.ini_options] asyncio_mode = "auto"` (mirrors pkit-process)

**Source tree:**
- `src/pkit_process_extract/__init__.py` — re-exports `ExtractProcessConfig`, `create_extract_process`
- `src/pkit_process_extract/extract_process.py` — main implementation

**Test tree:**
- `tests/__init__.py` (empty)
- `tests/test_extract_process.py`

**README.md** — document `ExtractProcessConfig` fields + 3 provider examples (anthropic/openai/gemini)

### Subtask U3.2 — Port TS extract-process functionality

`src/pkit_process_extract/extract_process.py` structure:

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Any, Type, TypeVar
import anyio

# ... provider lazy-import helpers ...

class ExtractProcessConfig(BaseModel):
    provider: Literal["anthropic", "openai", "gemini"]
    model: str
    prompt: str  # or callable — use str for v0.1; callable variant deferred
    output_schema: Type[BaseModel]
    input_schema: Type[BaseModel] | None = None
    api_key: str | None = None
    temperature: float | None = None
    max_retries_on_schema_failure: int = 2
    system_prompt: str | None = None
    # retry_policy: deferred to v0.2 (no RetryPolicy Python equivalent yet)

def create_extract_process(config: ExtractProcessConfig):
    """Returns a Process[I, O] callable (async fn: I -> ProcessResult[O])."""
    async def process(input_data: Any, ctx: Any = None):
        schema = config.output_schema.model_json_schema()
        # provider dispatch ...
        # retry loop on schema validation failure ...
        # return ProcessResult(ok=True, data=validated) or ProcessResult(ok=False, error={...})
    return process
```

Key implementation notes:
- `output_schema.model_json_schema()` produces the JSON Schema; pass to provider as structured
  output format spec (same role as `zod.toJSONSchema` in TS)
- Retry loop: attempt parse up to `max_retries_on_schema_failure + 1` times total; on
  `ValidationError`, retry with previous error in prompt (mirrors TS behavior at lines 190-210)
- Provider lazy import pattern: `importlib.import_module("anthropic")` inside the process closure;
  raise `ImportError` with helpful message if package not installed

### Subtask U3.3 — release.yml publish job

Edit `.github/workflows/release.yml` — add `publish-python-process-extract` job after
`publish-python`. Mirror the existing `publish-python` job exactly, changing only:
- `working-directory: packages/adapter-python-process-extract`
- `packages-dir: packages/adapter-python-process-extract/dist`
- Environment name: `pypi-process-extract` (must match new Trusted Publisher config)

**Pre-push operational step (manual, by executor):** Register Trusted Publisher on
PyPI for `pkit-process-extract`:
- Go to `https://pypi.org/manage/account/publishing/`
- Owner: `mrzadexinho`, Repo: `pipeline-kit`, Workflow: `release.yml`,
  Environment: `pypi-process-extract`
- Mirror M9 process documented at `docs/development/pypi-publisher-setup.md`
- This step MUST complete before pushing the `release.yml` edit to master.

Also add the `pypi-process-extract` environment to `release.yml` workflow environment list and
create it in repo Settings → Environments if it doesn't exist.

### Subtask U3.4 — Tests

`tests/test_extract_process.py` minimum test cases:

1. **Round-trip with mocked provider:** patch the provider's completion function; supply a schema
   that the mock response satisfies; assert `create_extract_process(config)(input)` returns a
   validated Pydantic instance.
2. **Schema-validation-failure retry:** mock returns invalid JSON first, then valid JSON on
   second call; assert retry consumed + final result is valid instance.
3. **Provider-not-installed error:** configure `provider="openai"` without installing `openai`;
   call process; assert `ImportError` with message containing "openai" and installation hint.

### STOP gate

`uv run --directory packages/adapter-python-process-extract pytest` passes all 3+ tests; PyPI
Trusted Publisher registered; release.yml edit pushed; `pkit-process-extract 0.1.0` published
with PEP 740 attestation; sigstore rekor entry present.

### Verification

```bash
# Local tests
uv run --directory packages/adapter-python-process-extract pytest

# PyPI existence (after publish)
curl -s https://pypi.org/pypi/pkit-process-extract/json | python3 -m json.tool | grep '"version"'

# PEP 740 attestation
curl -s "https://pypi.org/integrity/pkit-process-extract/0.1.0/pkit_process_extract-0.1.0-py3-none-any.whl/provenance"
```

### Commit policy

1. `feat(python): scaffold pkit-process-extract package (hatchling + pydantic)`
2. `feat(python): port process-extract to Python with provider lazy-import dispatch`
3. `test(python): add extract-process round-trip + retry + missing-provider tests`
4. `feat(release): add publish-python-process-extract job to release.yml`
5. `docs(python): README for pkit-process-extract`

---

## U4 — ADR IX-6 idempotencyKey wire-shape ratification

### Goal

Formally ratify the informal `idempotencyKey` wire convention (in use since M9) as ADR IX-6.
Docs-only — `SerializableContext` already exists at `packages/core/src/serializable-context.ts:8-12`.

### Background: gate relaxation

The original M12 carry-forward stated "no 2nd JS adapter" as the ratification gate. The gate is
relaxed at M13 because:
1. Wire shape is language-neutral by design — NDJSON + LSP framing carries it across any runtime.
2. Two Python consumers now exercise cross-adapter consensus: `pkit-process` (M9) and
   `pkit-process-extract` (M13 U3).
3. No JS-specific wire concern has surfaced in M9-M12 that would require the gate to hold.

### Subtask U4.1 — Append ADR IX-6

Append to `docs/research-notes-v1-cat-IX.md` (after the "End of v1 Cat IX research notes" line):

```markdown
---

### ADR-v1-IX-6 — Cross-runtime idempotency: `SerializableContext` as canonical wire shape

**Status:** Accepted — 2026-05-25 (M13 U4 ratification; gate relaxed from "2nd JS adapter" to
"2nd adapter any language").

**Decision:** `SerializableContext` (defined at `packages/core/src/serializable-context.ts:8-12`)
is the canonical cross-runtime wire shape for idempotency. The two load-bearing fields:
- LSP framing mode: `x-pipeline-idempotency-key` header alongside `Content-Length`
- NDJSON framing mode: `body.metadata.idempotencyKey` on each Atom envelope

**Context:** M9 shipped an informal convention for the Python `process-classify` adapter. The
gate phrased as "2nd JS adapter" was a conservatism-guard against JS-specific divergence. No
such divergence surfaced in M9-M12. `SerializableContext` is structurally language-neutral
(plain string field in a serializable record). Two Python consumers — `pkit-process` (M9) and
`pkit-process-extract` (M13 U3) — exercise the convention consistently. Gate relaxed to "2nd
adapter any language" per M13 brain session 2026-05-25.

**Consequences:**
- Positive: formal spec for cross-runtime idempotency closes the oldest deferred Cat IX ADR.
  All 5 prior IX ADRs now have a sixth sibling completing the wire-format surface.
- Positive: executor implementing future adapters can cite this ADR for idempotency wire shape.
- Negative: codifies the language-neutral assumption — revisit if a JS adapter surfaces a
  JS-specific wire concern.

**Revisit triggers:**
1. A future JS adapter (Source or Serve) discovers an idempotency edge case not covered by
   `SerializableContext` (e.g., HMAC-signed idempotency key requiring TS-only crypto).
2. A 2nd JS adapter diverges from the NDJSON `metadata.idempotencyKey` field name.

**Cross-references:**
- ADR-v1-IX-1..IX-5 — same file (framing, schema bridge, Result shape, OTel, wire ownership)
- `packages/core/src/serializable-context.ts:8-12` — canonical interface definition
- M9 memory entry: "M9 shipped informal convention; gate phrased as '2nd JS adapter'"
```

### Subtask U4.2 — Update spec index

Locate the ADR registry. Based on prior milestones, likely in `docs/spec.md` (search for "IX"
count) or in the research-notes-v1-cat-IX.md header. Increment Cat IX ADR count from 5 → 6.
Update the overall surface count wherever it appears (55/55 → 56/56).

Run: `grep -n "55/55\|IX.*ADR\|ADR candidates" docs/spec.md docs/research-notes-v1-cat-IX.md`
to locate the right lines before editing.

### STOP gate

ADR IX-6 in file with Status: Accepted; spec index shows 56/56 (or Cat IX shows 6 ADRs); no
code files modified (zero source file edits).

### Verification

```bash
grep -A3 "IX-6" docs/research-notes-v1-cat-IX.md
# Must show: "Status:** Accepted"

grep "56/56\|IX.*6 ADR\|six ADR" docs/spec.md docs/research-notes-v1-cat-IX.md
# Must show the updated count somewhere
```

### Commit policy

Single commit: `docs(adr): ratify ADR IX-6 — idempotencyKey wire shape (gate relaxed to 2nd
adapter any language)`

---

## U5 — High-impact major v-bumps batch (zod 4 → fast-check 4 → vitest 4)

### Goal

Clear the remaining 3 Dependabot major PRs in dependency order. Fix breaking changes before each
merge. Trigger one TP-OIDC npm publish to advance the NPM_TOKEN bridge counter 2/6 → 3/6.

### Order rationale

zod first: every Source/Serve boundary uses Zod schemas. A broken zod means broken type-checking
across the entire kit. Fix it first while the test suite is known-good otherwise.

fast-check second: property tests use fast-check but are independent of zod schemas. Low blast
radius, fast feedback. Warm-up before vitest.

vitest last: test-isolation diagnosis is easier when schemas and property tests are confirmed
working. Vitest v4 semantics change (`vi.restoreAllMocks`) affects test isolation, not runtime
behavior.

### Subtask U5.1 — Merge PR #23 (zod 3.25.76 → 4.4.3)

**Pre-merge research:**
```bash
# Find error-path code using ZodIssueCode or ZodError internals
grep -rn "ZodIssueCode\|ZodError\|z\.ZodError\|\.issues\[" packages/*/src packages/*/tests
```
Zod v4 changes: `ZodIssueCode` enum values are renamed (e.g., `invalid_type` stays, but some
codes changed). `z.ZodError.issues` shape changed (some fields renamed). Most common breakage:
test assertions on error shape.

Reference: `git show 9d57b38` for prior zod4 fix patterns from M0.5c — this commit patched
the first zod4 attempt; its diff is the fastest path to understanding expected breakage.

After merge:
```bash
pnpm -r build && pnpm test && pnpm biome check . --max-diagnostics=500
```
All tests must pass before proceeding to fast-check.

### Subtask U5.2 — Merge PR #20 (fast-check 3.23.2 → 4.7.0)

**Pre-merge research:**
```bash
# Find uuid and scheduler usages
grep -rn "fc\.uuid\|fc\.scheduler\|fc\.asyncScheduler" packages/*/tests packages/*/src/__tests__
```
fast-check v4 changes:
- `fc.uuid()` now defaults to UUIDv7 (was v4); use `fc.uuid({ version: 4 })` to pin.
- `fc.scheduler` interleaving consistency: v4 guarantees more deterministic scheduling.
  Most tests should be unaffected; check if any test asserts on scheduling order.
- `fc.subarray` → renamed in v4; check if used.

After merge:
```bash
pnpm test  # property tests must pass
pnpm biome check . --max-diagnostics=500
```

### Subtask U5.3 — Merge PR #25 (vitest 3.2.4 → 4.1.5)

**Pre-merge research:**
```bash
# Find restoreAllMocks usages
grep -rn "vi\.restoreAllMocks\|restoreAllMocks" packages/*/tests packages/*/src/__tests__

# Find snapshot tests that match on mock names
grep -rn "toMatchSnapshot\|toMatchInlineSnapshot" packages/*/tests packages/*/src/__tests__
```
vitest v4 changes:
- `vi.restoreAllMocks()` semantics: in v4 it restores mocks created with `vi.spyOn` but does
  NOT reset state of `vi.fn()` mocks. If any test calls `restoreAllMocks()` expecting `vi.fn()`
  counters to reset, it will fail. Fix: add explicit `vi.clearAllMocks()` before/after as needed.
- Snapshot mock names: `vi.fn()` mock functions now stringify as `'vi.fn()'` not `'spy'` in
  inline snapshots. Update any snapshot strings that match on spy name.
- `vi.useFakeTimers` API: verify `setSystemTime` / `advanceTimersByTime` still work (M5 fake-
  timer lesson: pin system time + advance ≤ 2_000ms).

After merge: full test pass on local + push to master to confirm CI green.

### Bridge counter advance

After U5 complete and CI green on master, the next `release.yml` run triggered by any changeset
merge or manual dispatch will publish via TP-OIDC. One successful npm TP-OIDC publish advances
the NPM_TOKEN bridge counter 2/6 → 3/6. Note in U5 report-back which run ID produced the
advance and verify: `gh run view <id> --log | grep -i "oidc\|sigstore"`.

### STOP gate

All 9 Dependabot PRs closed; `pnpm -r build && pnpm typecheck && pnpm test &&
pnpm biome check . --max-diagnostics=500` all pass; CI green on master; at least one
TP-OIDC npm publish completed (bridge counter 3/6).

### Verification

```bash
# All Dependabot PRs closed
gh pr list --author "app/dependabot"
# Expected: empty list

# Full local gate sweep
pnpm -r build && pnpm typecheck && pnpm test && pnpm biome check . --max-diagnostics=500

# Bridge counter advance (after publish)
gh run list --workflow=release.yml --limit 5
gh run view <last-run-id> --log | grep -iE "oidc|sigstore|provenance"
```

### Commit policy

No direct commits from U5 (changes come via GitHub's squash-merge of Dependabot PRs). Any
breaking-change patches applied before each PR merge get committed on a short-lived patch
branch and squash-merged with the Dependabot PR, or committed directly to master and the
Dependabot PR updated to include the fix (executor's judgment on cleanest approach).

---

*Drilldown companion to [`m13_executor_brief.md`](m13_executor_brief.md). Working rules, wave
sequencing, risk flags, and all 17 verification gates are in the entry brief.*
