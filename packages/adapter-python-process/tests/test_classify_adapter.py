"""Subprocess tests for examples/classify/adapter.py.

Invokes the adapter via `python -m examples.classify.adapter` with a single
NDJSON frame on stdin and asserts the output frame shape on stdout.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Project root for invoking the adapter as a module
_PKG_ROOT = str(Path(__file__).parent.parent)


def _run_adapter(frame: dict) -> dict:
    """Invoke the adapter with one input frame; return the parsed output frame."""
    payload = json.dumps(frame, separators=(",", ":")) + "\n"
    result = subprocess.run(
        [sys.executable, "-m", "examples.classify.adapter"],
        input=payload,
        capture_output=True,
        text=True,
        cwd=_PKG_ROOT,
        timeout=15,
    )
    assert result.returncode == 0, f"adapter exited non-zero: {result.stderr}"
    lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1, f"expected exactly 1 output line, got: {result.stdout!r}"
    return json.loads(lines[0])


def test_happy_path_short_text() -> None:
    """Happy path: short text produces bucket='short', no error."""
    out = _run_adapter({"body": {"text": "hello world", "metadata": {}}})
    assert out["body"]["data"]["bucket"] == "short"
    assert out["body"].get("error") is None


def test_missing_text_field_error() -> None:
    """Missing text field produces process_error with code classify/missing_input."""
    out = _run_adapter({"body": {"metadata": {}}})
    assert out["body"].get("data") is None
    err = out["body"]["error"]
    assert err["type"] == "process_error"
    assert err["code"] == "classify/missing_input"
    assert err["message"]  # non-empty message


def test_idempotency_key_round_trip() -> None:
    """idempotencyKey in input metadata is echoed in output data."""
    out = _run_adapter(
        {"body": {"text": "hello", "metadata": {"idempotencyKey": "test-key-123"}}}
    )
    assert out["body"]["data"]["idempotencyKey"] == "test-key-123"
    assert out["body"].get("error") is None


def test_no_traceparent_exits_zero() -> None:
    """Adapter exits 0 without a traceparent header (no live OTel exporter needed)."""
    out = _run_adapter({"body": {"text": "no trace", "metadata": {}}})
    # If we reach here the process exited 0 (asserted in _run_adapter).
    assert out["body"]["data"]["bucket"] in {"short", "medium", "long"}


def test_with_traceparent_exits_zero() -> None:
    """Adapter accepts a valid W3C traceparent without crashing."""
    traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    out = _run_adapter(
        {"body": {"text": "traced input", "metadata": {"traceparent": traceparent}}}
    )
    assert out["body"]["data"]["bucket"] in {"short", "medium", "long"}
    assert out["body"].get("error") is None
