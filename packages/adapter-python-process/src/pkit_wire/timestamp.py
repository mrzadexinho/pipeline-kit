"""timestamp — RFC 3339 millisecond-precision timestamp validator.

Kit boundary: exactly 3 fractional-second digits (millisecond-precision).
Sub-millisecond or missing fractional seconds are rejected LOUD.

CRITICAL: Do NOT use Python's datetime.fromisoformat() as primary validator.
Python 3.12 fromisoformat() silently truncates >=7-digit fractional seconds
to microsecond precision — a wire-hash idempotency breakage (Cat IX spike-2).
Regex validation runs first; fromisoformat is never called here.

Accepted: YYYY-MM-DDTHH:mm:ss.sssZ  or  YYYY-MM-DDTHH:mm:ss.sss+HH:MM
Rejected: any other form

Reference: packages/core/src/wire/timestamp.ts
"""

from __future__ import annotations

import re

_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$"
)


def validate_timestamp(value: str) -> str:
    """Validate value is an RFC 3339 millisecond-precision timestamp.

    Args:
        value: candidate timestamp string.

    Returns:
        The original value if valid (passthrough for chaining).

    Raises:
        ValueError: if fractional seconds are not exactly 3 digits,
                    or the format does not match the required pattern.
    """
    if not isinstance(value, str):
        raise ValueError(f"timestamp: expected str, got {type(value).__name__}")

    # Check for fractional seconds digit count before full-pattern match
    # to provide a precise error message on sub-ms precision.
    dot_idx = value.find(".")
    if dot_idx != -1:
        # Extract only the digit run after the dot
        rest = value[dot_idx + 1 :]
        frac_digits = ""
        for ch in rest:
            if ch.isdigit():
                frac_digits += ch
            else:
                break
        if len(frac_digits) > 3:
            raise ValueError(
                f"timestamp: sub-millisecond precision ({len(frac_digits)} fractional digits); "
                "exactly 3 required"
            )

    if not _TIMESTAMP_RE.match(value):
        raise ValueError(
            f"timestamp: '{value[:64]}' does not match RFC 3339 millisecond-precision format "
            r"(YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm:ss.sss+HH:MM)"
        )

    return value
