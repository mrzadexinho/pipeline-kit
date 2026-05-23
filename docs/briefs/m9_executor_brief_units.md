# M9 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m9_executor_brief.md`](m9_executor_brief.md)):**
> - Unit 1 = `packages/adapter-python-process/src/pkit_wire/` (5 modules, ≤400 LOC total) — Python parity for decode_result, ndjson, lsp_frame, canonical_json, timestamp.
> - Unit 2 = `packages/cli/fixtures/wire-schemas/sample-error-frame.ts` + Pydantic snapshot — discriminated-union codegen coverage gap.
> - Unit 3 = `packages/adapter-python-process/examples/classify/` (≤300 LOC) — end-to-end Python process-classify reference adapter.
> - Unit 4 = `.github/workflows/ci.yml` new `test-python` job — `["3.12","3.13"]` matrix via `astral-sh/setup-uv@v8.1.0`.
> - Unit 5 = PyPI pending publisher STOP gate + `docs/development/pypi-publisher-setup.md`.
> - Unit 6 = TP-OIDC Phase 1 (agent-runnable) + Phase 2 STOP (user OTP) + Phase 3 verification.
> Read entry brief first for wave sequencing, risk flags, working rules, verification gates.

---

## Unit 1 — `pkit_wire` Python Helper Package

**State:** NO Python code exists in this repo at M9 start. `packages/adapter-python-process/` does not exist. Source of truth: `packages/core/src/wire/` (TS implementations) + `packages/core/src/wire/README.md` + `docs/research-notes-m9-python-adapter.md` §Wire-protocol Python implementor map.

**Scope:** Create `packages/adapter-python-process/` with `pyproject.toml` + 5 Python modules under `src/pkit_wire/`. Module list and semantic constraints are binding — match TS behavior exactly.

**Tasks:**

1. Create `packages/adapter-python-process/pyproject.toml`:
   ```toml
   [project]
   name = "pkit-wire"
   version = "0.1.0"
   requires-python = ">=3.12"
   dependencies = [
     "anyio>=4.0",
     "pydantic>=2.13.4",
   ]

   [project.optional-dependencies]
   test = [
     "pytest>=9.0",
     "pytest-asyncio>=0.24",
     "hypothesis>=6.100",
   ]

   [tool.pytest.ini_options]
   asyncio_mode = "auto"

   [tool.uv]
   dev-dependencies = ["pytest>=9.0", "pytest-asyncio>=0.24", "hypothesis>=6.100"]
   ```

2. Create `src/pkit_wire/__init__.py` (empty; marks package).

3. Create `src/pkit_wire/decode_result.py` — ADR IX-3 namedtuple shape:
   - `Ok(kind="ok", value=...)` and `Err(kind="err", error=...)` namedtuples.
   - `decode_result(frame: dict) -> Ok | Err` — raises `ValueError` if both-null or both-non-null (the typo guard equivalent; use a `WireDecodeError` dataclass instead of ValueError if preferred for parity).
   - Adapter authors MUST call this; hand-rolling the discriminant check is prohibited (document in module docstring).

4. Create `src/pkit_wire/canonical_json.py`:
   - `canonical_json(obj: object) -> bytes` — `json.dumps(obj, separators=(",",":"), sort_keys=True, ensure_ascii=False).encode("utf-8")`.
   - Validate integers against `9007199254740991` (Number.MAX_SAFE_INTEGER); raise on overflow.
   - Reference: `docs/research-notes-m9-python-adapter.md` §canonical-json.

5. Create `src/pkit_wire/timestamp.py`:
   - `validate_timestamp(value: str) -> str` — raise `ValueError` if fractional seconds != exactly 3 digits.
   - Pattern: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$`.
   - Do NOT use Python's `fromisoformat` as primary validator — it silently truncates ≥7-digit fractions (Cat IX spike-2 finding). Regex first, then parse.
   - Reference: `docs/research-notes-m9-python-adapter.md` §timestamp.

6. Create `src/pkit_wire/ndjson.py`:
   - Async line reader over `anyio`-wrapped `sys.stdin.buffer` (UTF-8 re-wrapped TextIOWrapper).
   - Per-frame `model_validate_json(line, strict=True)` — pass raw bytes directly to jiter; no intermediate `json.loads`.
   - Per-frame emit: `model_dump_json(by_alias=True, exclude_unset=True)` + newline + `await stdout.flush()`.
   - Never use `print()` to stdout — module-level comment enforcing this.
   - Reference: `docs/research-notes-m9-python-adapter.md` §NDJSON codec + §Finding 4 (block-buffering) + §Finding 6 (jiter).

7. Create `src/pkit_wire/lsp_frame.py`:
   - Binary header parser over `sys.stdin.buffer`.
   - First header line MUST match `Content-Length: <digits>` — reject anything else (closes spike-3 silent-pass).
   - Only `traceparent` and `tracestate` allowed as additional header lines; any other key → raise.
   - 8 KiB header bound.
   - Body byte-count: `len(body.encode("utf-8"))` not `len(body)`.
   - Extract `traceparent` header value and return alongside decoded body.
   - Reference: `docs/research-notes-m9-python-adapter.md` §LSP codec.

8. Create `tests/` directory with pytest tests:
   - `tests/test_decode_result.py` — `{data: {...}, error: null}` → Ok; `{data: null, error: {...}}` → Err; both-null raises; both-non-null raises.
   - `tests/test_canonical_json.py` — key ordering; separator correctness; MAX_SAFE_INTEGER boundary.
   - `tests/test_timestamp.py` — 3-digit fractional passes; 7-digit fractional raises; no fractional raises.
   - `tests/test_ndjson.py` — round-trip a known NDJSON line; verify flush discipline via mock.
   - `tests/test_lsp_frame.py` — valid frame parses; non-Content-Length first line raises; short body raises; UTF-8 multi-byte round-trip.
   - Add `hypothesis` property tests for canonical_json and decode_result if coverage is thin (cheap; include).

**Verification:**
- `uv run --frozen pytest packages/adapter-python-process/` — all tests green.
- `uv run python -c "from pkit_wire import decode_result, canonical_json"` — imports cleanly.

**Out-of-scope:** OTel SDK setup, anyio task group (Unit 3 adds those), pip/Poetry (uv only), hypothesis-heavy suites.

**LOC budget:** ≤400 LOC total across all 5 helper modules (excludes tests and `__init__.py`).

---

## Unit 2 — Codegen Discriminated-Union Fixture

**State:** `packages/cli/fixtures/wire-schemas/sample-atom.ts` exists (M8, no `z.discriminatedUnion`). `packages/cli/fixtures/wire-schemas/__snapshot__/sample-atom.py` exists. Gap: `z.discriminatedUnion()` path is untested in codegen — an M10 surprise if skipped. Source of truth: `packages/cli/src/commands/gen-py-schema.ts` (M8 codegen command).

**Scope:** Add one new Zod fixture exercising `z.discriminatedUnion()` and commit its Pydantic snapshot. Wire a `--check` CI step for it. Do NOT modify `sample-atom.ts` or its snapshot.

**Tasks:**

1. Create `packages/cli/fixtures/wire-schemas/sample-error-frame.ts`:
   ```ts
   import { z } from "zod";

   const DataFrame = z.object({
     type: z.literal("data"),
     payload: z.object({ value: z.string() }),
   });

   const ErrorFrame = z.object({
     type: z.literal("error"),
     code: z.string(),
     message: z.string(),
   });

   const ProgressFrame = z.object({
     type: z.literal("progress"),
     percent: z.number().int().min(0).max(100),
   });

   export const WireFrame = z.discriminatedUnion("type", [
     DataFrame,
     ErrorFrame,
     ProgressFrame,
   ]);
   ```

2. Run `pk gen-py-schema` (via `node packages/cli/dist/index.js gen-py-schema`) against the new fixture and capture output to `packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py`. Commit the snapshot.

3. If `datamodel-code-generator` emits a malformed or incorrect union: document the gap in a comment header at the top of `sample-error-frame.py`. Add an inline workaround (e.g., hand-correct `Union[DataFrameModel, ErrorFrameModel, ProgressFrameModel]`) and flag it with `# TODO(M10): upstream discriminatedUnion codegen gap — verify with datamodel-codegen >= 0.26`. Do NOT block the unit on this — ship the best output available with the gap documented.

4. Pin `datamodel-code-generator` version in the `packages/cli/src/lib/datamodel-codegen.ts` invocation: `uv run --with 'datamodel-code-generator[http]==<current-resolved-version>'` — prevents silent drift when the tool releases. Determine current version by running `uv run --with 'datamodel-code-generator[http]' datamodel-codegen --version` and hardcoding the result.

5. Add a `gen-py-schema:check-union` workspace script to the root `package.json` (mirroring the existing `gen-py-schema:check` pattern from M8) that verifies the new fixture snapshot.

**Verification:**
- `node packages/cli/dist/index.js gen-py-schema --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts --out /tmp/test-union.py && uv run python -m py_compile /tmp/test-union.py` — exits 0.
- `gen-py-schema:check-union` script exits 0 when snapshot matches; exits non-zero on artificial drift (edit snapshot, run, confirm non-zero, revert).

**Out-of-scope:** modifying `sample-atom.ts`, the existing snapshot, or `gen-py-schema.ts` command logic. If a codegen gap surfaces requiring CLI changes, escalate to brain.

**LOC budget:** ~60-100 LOC fixture; snapshot size varies by codegen output.

---

## Unit 3 — Reference Python Adapter (process-classify)

**State:** Unit 1 must be committed before Unit 3 starts. `packages/adapter-python-process/examples/classify/` does not exist. Pattern reference: `packages/process-classify/src/classify-process.ts` (NOT `process-extract` — classify is simpler, no LLM-provider noise). Wire protocol reference: `packages/core/src/wire/README.md`.

**Scope:** A single Python script that reads NDJSON frames from `sys.stdin.buffer`, classifies text by length bucket (trivial logic — no external API), emits result frames, picks up `idempotencyKey` from `body.metadata.idempotencyKey`, starts an OTel child span from `traceparent`. Includes a subprocess pytest harness.

**Tasks:**

1. Create `packages/adapter-python-process/examples/classify/__init__.py` (empty).

2. Create `packages/adapter-python-process/examples/classify/adapter.py`:
   - Imports: `anyio`, `sys`, `io.TextIOWrapper`, `pydantic`, `opentelemetry.propagate.extract`, `opentelemetry.trace`, `pkit_wire.decode_result`, `pkit_wire.ndjson`.
   - Re-wrap stdio before anyio event loop:
     ```python
     stdin = anyio.wrap_file(TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"))
     stdout = anyio.wrap_file(TextIOWrapper(sys.stdout.buffer, encoding="utf-8"))
     ```
   - `async def stdin_reader()`: read NDJSON lines; parse via `InputFrame.model_validate_json(line, strict=True)`; send to anyio memory channel.
   - `async def stdout_writer()`: receive from channel; classify; emit result frame; `await stdout.write(frame + "\n")`; `await stdout.flush()`.
   - `idempotencyKey` pickup: `frame.body.metadata.idempotencyKey` if present — carry through to output frame `body.metadata.idempotencyKey` (echo the key, do not generate a new one).
   - `traceparent` pickup: `frame.body.metadata.traceparent` if present — `extract({"traceparent": traceparent})`; `tracer.start_as_current_span("classify.process", context=ctx)`.
   - Classify logic (trivial): bucket by `len(text)` — e.g., `"short"` (<100), `"medium"` (100-500), `"long"` (>500).
   - Output frame: `{data: {bucket: "short"|"medium"|"long", idempotencyKey: "..."}, error: null}` on success; `{data: null, error: {type: "process_error", code: "classify/missing_input", message: "..."}}` on missing text field.
   - `Field(discriminator="type")` for the output error envelope discriminated union (Pydantic `Union` with type literal).
   - All log/debug output to `sys.stderr` exclusively. Never `print()` to stdout.
   - Dependencies to add in `pyproject.toml`: `opentelemetry-api>=1.0`, `opentelemetry-sdk>=1.0`.

3. Create `packages/adapter-python-process/examples/classify/models.py`:
   - Pydantic v2 models: `InputMetadata`, `InputBody`, `InputFrame`, `OutputData`, `OutputError`, `OutputBody`, `OutputFrame`.
   - `idempotencyKey: str | None = None` on `InputMetadata` and `OutputData`.
   - `traceparent: str | None = None` on `InputMetadata`.
   - `extra="forbid"` on all models (explicit wire boundary).

4. Create `tests/test_classify_adapter.py` in `packages/adapter-python-process/tests/`:
   - Use `subprocess` with `stdin`/`stdout` pipes to invoke the adapter script directly.
   - Happy-path test: write a known NDJSON input frame (text = "hello world"); assert byte-exact output frame matches expected `{data: {bucket: "short"}, error: null}` JSON.
   - Error-path test: write a frame with missing `text` field; assert output is `{data: null, error: {type: "process_error", code: "classify/missing_input", ...}}`.
   - idempotencyKey round-trip: write frame with `idempotencyKey: "test-key-123"`; assert output frame carries the same key.
   - No live OTel exporter in tests — verify the span is started by mocking `trace.get_tracer` or by confirming the process exits 0 without traceparent present.

**Verification:**
- `uv run --frozen pytest packages/adapter-python-process/tests/test_classify_adapter.py` — all 4 tests green.
- `echo '{"body":{"text":"hello","metadata":{}}}' | uv run python packages/adapter-python-process/examples/classify/adapter.py` — prints a valid NDJSON output frame.

**Out-of-scope:** LLM calls, multiple adapters, bidirectional channels, OTel exporter config, `process-extract` Python mirror.

**LOC budget:** ≤300 LOC adapter source (`adapter.py` + `models.py`); tests excluded from LOC budget.

---

## Unit 4 — CI Matrix Expansion

**State:** `.github/workflows/ci.yml` has Node-side jobs only. No Python job exists. Unit 3 must be committed before this unit (test job needs the Python code to test against).

**Scope:** Add a single new job `test-python` to `.github/workflows/ci.yml` as a parallel sibling to existing Node jobs. Do NOT create a new workflow file. Do NOT modify any existing job.

**Tasks:**

1. Read `.github/workflows/ci.yml` (existing structure) before editing — understand job names and trigger blocks.

2. Add `test-python` job:
   ```yaml
   test-python:
     runs-on: ubuntu-latest
     strategy:
       matrix:
         python-version: ["3.12", "3.13"]
     steps:
       - uses: actions/checkout@v6
       - uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0
         with:
           enable-cache: true
           cache-dependency-glob: |
             **/pyproject.toml
             **/uv.lock
       - name: Run Python tests
         run: uv run --frozen pytest packages/adapter-python-process/
   ```
   Note: do NOT add `actions/setup-python` — uv manages Python versions internally.

3. Update `docs/development/ci-and-release.md` (or `docs/development/README.md` if that's the actual path — read the directory first) with a one-paragraph entry explaining the `test-python` job role, matrix, and the `astral-sh/setup-uv` pin rationale.

4. Add `uv.lock` generation step: after `pyproject.toml` is finalized (Unit 1 + Unit 3 dep additions complete), run `uv lock` in `packages/adapter-python-process/` and commit `uv.lock`. The CI `--frozen` flag requires this lock file to exist.

**Verification:**
- `gh run view <run-id> --log` for a PR to `m9-python-adapter` shows `test-python` job green on both `3.12` and `3.13`.
- CI failure on the `test-python` job blocks merge (pre-merge gate confirmed by PR status checks).

**Out-of-scope:** macOS/Windows CI matrix, new workflow file, modifying any existing Node CI job, adding Python to `release.yml`.

---

## Unit 5 — PyPI Pending Publisher Config + Docs

**State:** No Python package exists on PyPI under any `@idriszade` or `pipeline-kit` name. No `docs/development/pypi-publisher-setup.md` exists. This is primarily a user-action STOP gate with a documentation artifact.

**Scope:** Pick the PyPI package name, verify availability, write the setup doc. The actual pending publisher web-form is a user action — executor documents what to do; executor does NOT submit the form.

**Tasks:**

1. Verify package name availability. Run:
   ```bash
   curl -s https://pypi.org/pypi/pkit-process/json | head -1
   curl -s https://pypi.org/pypi/pipeline-kit-process/json | head -1
   curl -s https://pypi.org/pypi/pk-process-py/json | head -1
   ```
   A 404 response means available. Pick the first available from that list (preference: `pkit-process`). If none are available, try `idriszade-pkit-process`. Record the chosen name.

2. Create `docs/development/pypi-publisher-setup.md` with these sections:
   - **Chosen package name** — the name from Task 1.
   - **STOP gate (user action required)**: Navigate to https://pypi.org/manage/account/publishing/ and configure a pending publisher with exact field values:
     - PyPI project name: `<chosen-name>`
     - GitHub owner: `mrzadexinho`
     - GitHub repository: `pipeline-kit`
     - GitHub workflow filename: `release.yml`
     - Environment name: `pypi` (to be created when M10 publish ships)
   - **What this does** — PyPI pending publisher allows publishing without a pre-existing token once the package is first created via a GHA OIDC workflow.
   - **M10 activation plan** — when M10 `uv publish` workflow ships, add `environment: pypi` + `permissions: id-token: write` to the publish job; remove any PyPI token from secrets.
   - **PEP 740 deferred to M11** — build provenance attestations require `uv publish --attestations` and `sigstore` integration; defer until M11 after M10 publish validates baseline OIDC path.

3. Update `packages/adapter-python-process/pyproject.toml` with the chosen name:
   ```toml
   [project]
   name = "<chosen-name>"
   ```

**Verification:**
- `curl -s https://pypi.org/pypi/<chosen-name>/json` returns 404 (not yet published).
- `docs/development/pypi-publisher-setup.md` exists with all 4 sections; STOP gate is clearly marked.

**Out-of-scope:** `uv publish` in M9, `release.yml` changes, any PyPI token secrets, PEP 740 attestations.

---

## Unit 6 — TP-OIDC 404 Remediation

**State:** Diagnostic infrastructure landed in M8 (`.github/workflows/oidc-token-debug.yml`, `scripts/npm-trust-introspect.sh`, `docs/development/tp-oidc-claim-diagnosis.md`). The 404 symptom remains unresolved — `NODE_AUTH_TOKEN` is still the active publish auth path. Source of truth: `docs/development/tp-oidc-claim-diagnosis.md`.

**Scope:** Three phases. Phase 1 is agent-runnable. Phase 2 is a USER STOP GATE — executor MUST halt and prompt the user with explicit commands. Phase 3 is verification after user completes Phase 2.

**Tasks:**

**Phase 1 (agent-runnable):**

1. Trigger the debug workflow:
   ```bash
   gh workflow run .github/workflows/oidc-token-debug.yml \
     -F audience=npm:registry.npmjs.org
   # Wait for completion:
   gh run list --workflow=oidc-token-debug.yml --limit 1
   # Capture run ID, then:
   gh run view <run-id> --log | grep -A 200 'OIDC token claims'
   ```

2. Download and diff claims. Cross-reference against `docs/development/tp-oidc-claim-diagnosis.md` §Step 3 — compare `sub`, `aud`, `ref`, `repository`, `workflow_ref`, `workflow`, `event_name`, `runner_environment`.

3. Identify the mismatch hypothesis (A, B, or C per the recipe doc). Produce a one-paragraph Phase 1 finding summary with the determined hypothesis and the corrected `npm trust github` command shape.

**Phase 2 (USER STOP GATE — executor MUST NOT run these commands):**

STOP. Do not proceed past this point. Prompt the user with the following:

> Phase 2 requires OTP elevation and re-running `npm trust github` for all 33 packages. Estimated 30-45 min.
>
> Based on Phase 1 findings (Hypothesis __), run for each package:
> ```bash
> npm trust github "@idriszade/<pkg>" \
>   --file .github/workflows/release.yml \
>   --repo mrzadexinho/pipeline-kit \
>   --allow-publish
> ```
>
> Package list (33 packages):
> `@idriszade/core`, `@idriszade/cli`, `@idriszade/memory`, `@idriszade/secrets`,
> `@idriszade/adapter-inngest`, `@idriszade/eval`, `@idriszade/observe`,
> `@idriszade/process-extract`, `@idriszade/process-classify`, `@idriszade/secrets-env`,
> `@idriszade/secrets-sops`, `@idriszade/secrets-oidc`, `@idriszade/pii-redact`,
> [and remaining packages — executor fills this list from `pnpm ls -r --depth 0`]
>
> After re-run, verify with:
> ```bash
> bash scripts/npm-trust-introspect.sh --all
> ```
> (Expect empty output for 5+ min per `feedback_npm_trust_list_lag`.)
>
> Signal when Phase 2 complete so Phase 3 verification can proceed.

**Phase 3 (post-trust verification — after user confirms Phase 2 done):**

4. Verify by creating a no-op test changeset on a scratch branch (do NOT remove `NODE_AUTH_TOKEN` from `release.yml` in M9):
   ```bash
   git checkout -b test/tp-oidc-probe
   pnpm changeset
   # Select @idriszade/core, patch, summary: "test: TP-OIDC probe"
   git add .changeset/ && git commit -m "test: tp-oidc probe changeset"
   gh pr create --title "test: TP-OIDC probe" --body "Phase 3 TP-OIDC trust verification."
   ```
   Observe the `release.yml` run on the Version Packages PR. If TP-OIDC publish succeeds for even one package, Phase 3 is confirmed. Close and delete the probe PR/branch — do not merge.

5. If Phase 3 confirms success: document in the M9 report-back as "TP-OIDC Phase 3 VERIFIED". `NODE_AUTH_TOKEN` removal deferred to a named subsequent milestone.

6. If Phase 3 still 404s: document hypothesis mismatch details in report-back; TP-OIDC carry-forward remains open.

**Verification:**
- Phase 1: OIDC token claims captured and hypothesis identified.
- Phase 2: user confirms all 33 packages re-trusted.
- Phase 3: at least one package publishes via OIDC (200 OK on PUT) OR 404 diagnosis updated with new evidence.

**Out-of-scope:** removing `NODE_AUTH_TOKEN` from `release.yml` in M9, disabling `NPM_TOKEN` secret, modifying `release.yml` beyond the test probe, publishing M9 packages via TP-OIDC in this milestone.

---

*Drilldown companion to m9_executor_brief.md. Working rules, wave sequencing, risk flags, and verification gates are in the entry brief.*
