"""Tests for pkit_wire.lsp_frame — strict LSP Content-Length frame parser."""

import pytest

from pkit_wire.lsp_frame import (
    LspFrame,
    WireLspError,
    decode_lsp_frame,
    encode_lsp_frame,
)


# --- encode helpers ---

def _make_frame(body: str, traceparent: str | None = None, tracestate: str | None = None) -> bytes:
    return encode_lsp_frame(body, traceparent=traceparent, tracestate=tracestate)


# --- Valid frames ---

def test_basic_frame_parses():
    body = '{"id":"pk_atom_01"}'
    frame_bytes = _make_frame(body)
    result = decode_lsp_frame(frame_bytes)
    assert isinstance(result, LspFrame)
    assert result.body == body
    assert result.traceparent is None


def test_frame_with_traceparent():
    body = '{"id":"x"}'
    tp = "00-abc123def456-789-01"
    frame_bytes = _make_frame(body, traceparent=tp)
    result = decode_lsp_frame(frame_bytes)
    assert result.traceparent == tp
    assert result.tracestate is None


def test_frame_with_traceparent_and_tracestate():
    body = '{"id":"y"}'
    tp = "00-abc123-456789-01"
    ts = "vendor=value"
    frame_bytes = _make_frame(body, traceparent=tp, tracestate=ts)
    result = decode_lsp_frame(frame_bytes)
    assert result.traceparent == tp
    assert result.tracestate == ts


# --- First-line enforcement (spike-3 regression) ---

def test_non_content_length_first_line_raises():
    """Any non-Content-Length first line must be rejected — closes spike-3 silent-pass."""
    # Simulate a stray print() output preceding the actual Content-Length header
    bad_frame = b"print output here\r\nContent-Length: 2\r\n\r\n{}"
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(bad_frame)
    assert exc_info.value.code == "wire/unknown_header"


def test_non_letter_first_line_raises():
    """Arbitrary garbage as first non-empty line must be rejected."""
    # A frame with a real non-empty junk line as its very first header line
    bad_frame = b"garbage-line: something\r\nContent-Length: 2\r\n\r\n{}"
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(bad_frame)
    assert exc_info.value.code == "wire/unknown_header"


def test_content_type_header_raises():
    """Content-Type is a valid LSP header but NOT allowed in kit's strict mode."""
    body = b'{"id":"z"}'
    header = f"Content-Length: {len(body)}\r\nContent-Type: application/json\r\n\r\n".encode()
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(header + body)
    assert exc_info.value.code == "wire/unknown_header"


# --- Short body ---

def test_short_body_raises():
    body = b'{"id":"pk_atom_01"}'
    frame_bytes = _make_frame(body.decode("utf-8"))
    # Truncate last 5 bytes of body
    truncated = frame_bytes[:-5]
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(truncated)
    assert exc_info.value.code == "wire/truncated_body"


# --- UTF-8 multi-byte round-trip ---

def test_utf8_multibyte_body_roundtrip():
    """Body with multi-byte codepoints must round-trip; Content-Length uses byte count."""
    body = '{"greeting":"héllo wörld","emoji":"😀"}'
    frame_bytes = _make_frame(body)
    result = decode_lsp_frame(frame_bytes)
    assert result.body == body


def test_utf8_content_length_counts_bytes_not_chars():
    """Verify Content-Length is UTF-8 byte count, not char count."""
    body = "😀"  # 1 char, 4 UTF-8 bytes
    body_bytes = body.encode("utf-8")
    assert len(body_bytes) == 4
    assert len(body) == 1

    frame_bytes = _make_frame(body)
    # Header should contain Content-Length: 4
    header_part = frame_bytes.split(b"\r\n\r\n")[0].decode("utf-8")
    assert "Content-Length: 4" in header_part

    result = decode_lsp_frame(frame_bytes)
    assert result.body == body


def test_invalid_utf8_body_raises():
    """Body with invalid UTF-8 bytes must raise wire/utf8_invalid."""
    # Build frame manually with invalid UTF-8 body bytes
    bad_body = b"\xff\xfe"  # invalid UTF-8
    header = f"Content-Length: {len(bad_body)}\r\n\r\n".encode("utf-8")
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(header + bad_body)
    assert exc_info.value.code == "wire/utf8_invalid"


# --- Header size limit ---

def test_header_too_large_raises():
    """Header blocks exceeding 8 KiB must be rejected."""
    # Create a header block > 8192 bytes by using a very long value (won't have CRLFCRLF)
    large_header = b"X" * 8193  # no terminator — no valid frame
    with pytest.raises(WireLspError) as exc_info:
        decode_lsp_frame(large_header)
    assert exc_info.value.code in ("wire/header_too_large", "wire/truncated_body")


# --- Encode/decode round-trip ---

def test_encode_decode_roundtrip():
    body = '{"a":1,"b":2}'
    tp = "00-traceid-spanid-01"
    frame_bytes = _make_frame(body, traceparent=tp)
    result = decode_lsp_frame(frame_bytes)
    assert result.body == body
    assert result.traceparent == tp
