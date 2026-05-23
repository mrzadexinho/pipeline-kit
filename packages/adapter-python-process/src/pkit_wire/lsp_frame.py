"""lsp_frame — Strict LSP Content-Length frame parser (ADR IX-1).

Frame format:
  Content-Length: N\\r\\n
  [traceparent: <value>\\r\\n]
  [tracestate: <value>\\r\\n]
  \\r\\n
  <N UTF-8 body bytes>

Strict rules (closes spike-3 silent-pass):
  - First non-empty header line MUST be 'Content-Length: <digits>'.
  - Only 'traceparent' and 'tracestate' allowed as additional keys.
  - Header block capped at 8 KiB.
  - Content-Length counts UTF-8 bytes, NOT Unicode characters.

NEVER use print() to stdout. stderr only for debug.
Reference: packages/core/src/wire/lsp-frame.ts
"""

from __future__ import annotations

import re
from dataclasses import dataclass

HEADER_MAX_BYTES = 8192
CRLF = b"\r\n"
HEADER_TERMINATOR = b"\r\n\r\n"
_CL_RE = re.compile(rb"^Content-Length:\s*(\d+)\s*$", re.IGNORECASE)


class WireLspError(ValueError):
    """LSP wire protocol violation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class LspFrame:
    """Successfully parsed LSP frame."""

    body: str
    traceparent: str | None = None
    tracestate: str | None = None


def encode_lsp_frame(
    body: str,
    traceparent: str | None = None,
    tracestate: str | None = None,
) -> bytes:
    """Encode body + optional trace headers to LSP wire bytes (UTF-8 byte-counted)."""
    body_bytes = body.encode("utf-8")
    hdr = f"Content-Length: {len(body_bytes)}\r\n"
    if traceparent is not None:
        hdr += f"traceparent: {traceparent}\r\n"
        if tracestate is not None:
            hdr += f"tracestate: {tracestate}\r\n"
    hdr += "\r\n"
    return hdr.encode("utf-8") + body_bytes


def decode_lsp_frame(data: bytes) -> LspFrame:
    """Parse a single LSP frame. Raises WireLspError on any protocol violation."""
    term = data.find(HEADER_TERMINATOR)
    if term == -1:
        code = "wire/header_too_large" if len(data) >= HEADER_MAX_BYTES else "wire/truncated_body"
        msg = (
            f"Header block exceeds {HEADER_MAX_BYTES} byte limit"
            if code == "wire/header_too_large"
            else "Incomplete header block: no \\r\\n\\r\\n terminator"
        )
        raise WireLspError(code=code, message=msg)

    if term >= HEADER_MAX_BYTES:
        raise WireLspError(
            code="wire/header_too_large",
            message=f"Header block exceeds {HEADER_MAX_BYTES} byte limit",
        )

    lines = [ln for ln in data[:term].split(CRLF) if ln]
    if not lines:
        raise WireLspError(code="wire/unknown_header", message="Empty header block")

    cl_m = _CL_RE.match(lines[0])
    if not cl_m:
        near = lines[0][:64].decode("utf-8", errors="replace")
        raise WireLspError(
            code="wire/unknown_header",
            message=f"First header line is not Content-Length: {near}",
        )
    content_length = int(cl_m.group(1))

    traceparent: str | None = None
    tracestate: str | None = None
    for line in lines[1:]:
        colon = line.find(b":")
        if colon == -1:
            raise WireLspError(
                code="wire/unknown_header",
                message=f"Malformed header line: {line[:64].decode('utf-8', errors='replace')}",
            )
        key = line[:colon].strip().lower().decode("utf-8", errors="replace")
        val = line[colon + 1:].strip().decode("utf-8", errors="replace")
        if key == "traceparent":
            traceparent = val
        elif key == "tracestate":
            tracestate = val
        else:
            raise WireLspError(code="wire/unknown_header", message=f"Unknown header key: {key}")

    body_start = term + 4
    body_bytes = data[body_start: body_start + content_length]
    if len(body_bytes) < content_length:
        raise WireLspError(
            code="wire/truncated_body",
            message=f"Expected {content_length} body bytes, got {len(body_bytes)}",
        )
    try:
        body_str = body_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise WireLspError(code="wire/utf8_invalid", message=f"Invalid UTF-8: {exc}") from exc

    return LspFrame(body=body_str, traceparent=traceparent, tracestate=tracestate)
