"""canonical_json — RFC 8785 JSON Canonicalization Scheme (JCS).

Produces deterministic UTF-8 bytes for wire-hash idempotency:
  - Keys sorted lexicographically (sort_keys=True)
  - No whitespace (separators=(',',':'))
  - ensure_ascii=False preserves non-ASCII UTF-8 codepoints
  - Integers outside [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] are rejected

MAX_SAFE_INTEGER = 9_007_199_254_740_991 (2^53 - 1 per ECMAScript)
Callers wanting BigInt-style integers MUST pre-convert to string.

Reference: packages/core/src/wire/canonical-json.ts
"""

from __future__ import annotations

import json
from typing import Any

MAX_SAFE_INTEGER = 9_007_199_254_740_991


def _check_integers(obj: Any) -> None:
    """Recursively validate all integers in obj are within MAX_SAFE_INTEGER."""
    if isinstance(obj, bool):
        # bool is subclass of int; booleans are wire-safe
        return
    if isinstance(obj, int):
        if abs(obj) > MAX_SAFE_INTEGER:
            raise TypeError(
                f"canonical_json: integer {obj} is outside safe integer range "
                f"[-{MAX_SAFE_INTEGER}, {MAX_SAFE_INTEGER}]; pre-convert to string"
            )
    elif isinstance(obj, dict):
        for v in obj.values():
            _check_integers(v)
    elif isinstance(obj, list):
        for item in obj:
            _check_integers(item)


def canonical_json(obj: Any) -> bytes:
    """Encode obj to RFC 8785 canonical JSON bytes.

    Args:
        obj: Any JSON-serialisable Python value.

    Returns:
        UTF-8 encoded canonical JSON bytes with sorted keys and no whitespace.

    Raises:
        TypeError: if any integer exceeds MAX_SAFE_INTEGER, or obj contains
                   non-JSON-serialisable types (NaN, Infinity, etc.).
    """
    _check_integers(obj)
    return json.dumps(
        obj,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
    ).encode("utf-8")
