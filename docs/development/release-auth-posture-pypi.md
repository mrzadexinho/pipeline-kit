# ADR M12-1: PyPI publish auth posture (Trusted Publishing + PEP 740 attestations)

## Status
Proposed — 2026-05-25 (M12 U3 implementation). Update to Accepted after Gate 13 verified.

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
- Authored: 2026-05-25 (M12 U3 brief).
- Status track: ADR M11-1 (npm) → M12 audits Python publish path → uv publish lacks
  attestations → swap to pypa-action with attestations:true → verification publish at
  run ID <run ID TBD post-publish>.
