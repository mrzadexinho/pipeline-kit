"""decode_result — ADR IX-3 sanctioned Result discriminator.

Every cross-runtime hop MUST funnel the {data, error} envelope through
decode_result(). Hand-rolling `error is None` checks is a typo-footgun
that silently flips ERR to OK. NEVER bypass this helper.

Namedtuple shape (ADR IX-3):
  Ok(kind="ok", value=<payload>)
  Err(kind="err", error=<error-envelope>)

Raises WireDecodeError on ambiguous frames (both-null or both-non-null).
"""

from __future__ import annotations

from typing import Any, NamedTuple, Union


class Ok(NamedTuple):
    """Successful result branch — ADR IX-3 namedtuple shape."""

    kind: str  # always "ok"
    value: Any


class Err(NamedTuple):
    """Error result branch — ADR IX-3 namedtuple shape."""

    kind: str  # always "err"
    error: Any


class WireDecodeError(ValueError):
    """Raised when the {data, error} envelope is ambiguous."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def decode_result(frame: dict[str, Any]) -> Union[Ok, Err]:
    """Discriminate a {data, error} wire frame into Ok or Err.

    Returns Ok when data is non-None and error is None.
    Returns Err when error is non-None and data is None.
    Raises WireDecodeError if both are None or both are non-None.
    """
    data = frame.get("data")
    error = frame.get("error")
    has_data = data is not None
    has_error = error is not None

    if has_data and not has_error:
        return Ok(kind="ok", value=data)
    if not has_data and has_error:
        return Err(kind="err", error=error)
    if not has_data and not has_error:
        raise WireDecodeError(
            code="wire/result_ambiguous",
            message="Both data and error are None; cannot determine result branch",
        )
    raise WireDecodeError(
        code="wire/result_ambiguous",
        message="Both data and error are non-None; result is ambiguous",
    )
