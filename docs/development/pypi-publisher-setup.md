# PyPI Pending Publisher Setup

M9 prepares the Python package `pkit-process` for PyPI publishing via GitHub Trusted Publisher OIDC. The actual publish workflow ships in M10. This document is the configuration handoff to set up the pending publisher BEFORE the first publish.

## Chosen package name

`pkit-process` — verified available on PyPI 2026-05-23 (HTTP 404 from `https://pypi.org/pypi/pkit-process/json`).

## STOP gate — user action required

Navigate to <https://pypi.org/manage/account/publishing/> and configure a pending publisher with these EXACT field values:

| Field | Value |
|---|---|
| PyPI project name | `pkit-process` |
| GitHub owner | `mrzadexinho` |
| GitHub repository | `pipeline-kit` |
| GitHub workflow filename | `release.yml` |
| Environment name | `pypi` |

The PyPI environment `pypi` does not need to exist as a GitHub Environment yet — M10 will create it when the publish workflow ships.

## What this does

PyPI pending publishers allow publishing a previously-non-existent package via a GitHub OIDC workflow. The first successful OIDC publish creates the package and binds the trust relationship. No PyPI API token is involved at any point.

## M10 activation plan

When M10 ships the publish workflow:

1. Add `environment: pypi` to the publish job.
2. Add `permissions: id-token: write` to the publish job.
3. Use `uv publish` (or `pypa/gh-action-pypi-publish`) — no token in env.
4. The first successful run will lift the pending publisher into a regular trusted publisher.

## PEP 740 (attestations) — deferred to M11

Build provenance attestations via PEP 740 require `uv publish --attestations` and sigstore integration. Defer until M11 after M10 baseline OIDC publish is validated.
