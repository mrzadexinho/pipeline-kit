"""Cat IX spike #3 — Python Process<Atom, Atom> for LSP-style Content-Length framing.

Reads Content-Length-prefixed messages from stdin (binary). For each frame:
  1. Read the header block (lines terminated by \\r\\n) until an empty line.
     Bound the header block at HEADER_MAX_BYTES so a runaway / corrupted
     stdin (e.g. someone's stray print() leaking onto the wire) can't keep
     us scanning forever.
  2. Parse the Content-Length header (decimal byte count).
  3. Slurp exactly N bytes of body — partial-frame-on-EOF is treated as a
     wire error and reported once before exit.
  4. Validate the atom via day-1's `schema.Atom` (UNCHANGED), run business
     rules from `business_rules.run_all` (UNCHANGED), and emit ONE framed
     Result envelope per input frame on stdout.

CRITICAL: NO `print()` calls in this file. Debug/diagnostic output goes to
stderr only. `print()` defaults to stdout and would corrupt the wire — the
controlled experiment in FINDINGS-rpc.md explicitly tests that failure mode.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import ValidationError

from business_rules import run_all
from schema import Atom

HEADER_MAX_BYTES = 8 * 1024  # 8 KiB — pathological-header guard (brief hint).


def _err_envelope(type_: str, code: str, message: str) -> dict[str, Any]:
    return {"data": None, "error": {"type": type_, "code": code, "message": message}}


def _emit_frame(envelope: dict[str, Any]) -> None:
    """Write one Result envelope as a Content-Length-framed message."""
    body = json.dumps(envelope).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def _read_header_block(stdin: Any) -> bytes | None:
    """Read until \\r\\n\\r\\n. Return raw header bytes (excluding terminator)
    or None on clean EOF. Raises ValueError on malformed/oversize headers."""
    buf = bytearray()
    while True:
        b = stdin.read(1)
        if not b:
            if not buf:
                return None  # clean EOF between frames
            raise ValueError(f"unexpected EOF in header block after {len(buf)} byte(s)")
        buf.extend(b)
        if buf.endswith(b"\r\n\r\n"):
            return bytes(buf[:-4])
        if len(buf) > HEADER_MAX_BYTES:
            raise ValueError(
                f"header block exceeded {HEADER_MAX_BYTES} bytes without terminator"
            )


def _parse_content_length(header_bytes: bytes) -> int:
    """Parse Content-Length: <decimal> from the header block."""
    text = header_bytes.decode("ascii", errors="replace")
    for raw_line in text.split("\r\n"):
        line = raw_line.strip()
        if not line:
            continue
        if ":" not in line:
            raise ValueError(f"malformed header line (no colon): {line!r}")
        name, _, value = line.partition(":")
        if name.strip().lower() == "content-length":
            v = value.strip()
            if not v.isdigit():
                raise ValueError(f"Content-Length not a non-negative integer: {v!r}")
            return int(v)
    raise ValueError("missing Content-Length header")


def _process_atom_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Pure transformation: parsed Result envelope -> Result envelope."""
    if "data" not in payload or "error" not in payload:
        return _err_envelope("wire", "missing_discriminants", "missing data/error keys")
    if payload["error"] is not None:
        return payload  # pass-through upstream errors verbatim

    atom_payload = payload["data"]
    if not isinstance(atom_payload, dict):
        return _err_envelope(
            "wire",
            "data_not_object",
            f"per-frame spike expects Result<Atom, E>, got {type(atom_payload).__name__}",
        )
    atom_id = atom_payload.get("id", "<unknown>")

    try:
        atom = Atom.model_validate(atom_payload)
    except ValidationError as e:
        first = (e.errors() or [{}])[0]
        first_msg = str(first.get("msg", ""))
        first_loc = ".".join(str(x) for x in first.get("loc", ())) or "?"
        if (
            "not ISO 8601" in first_msg
            or "fromisoformat" in first_msg
            or first_loc.endswith("created_at")
        ):
            code = "iso_8601_invalid"
        else:
            code = "schema_invalid"
        return _err_envelope(
            "schema",
            code,
            f"atom {atom_id}: {e.error_count()} error(s) at {first_loc}; first: {first_msg}",
        )

    job_dict = atom.data.model_dump(mode="json")
    rule = run_all(job_dict)
    if not rule["ok"]:
        err = rule["err"]
        return _err_envelope(err["type"], err["code"], f"atom {atom_id}: {err['message']}")

    out_atom = atom.model_dump(mode="json")
    out_atom["data"]["title"] = out_atom["data"]["title"].upper()
    out_atom["metadata"]["py_hop"] = "process_rpc.py"
    return {"data": out_atom, "error": None}


def main() -> int:
    stdin = sys.stdin.buffer  # binary; we count bytes, not chars
    frame_no = 0
    while True:
        try:
            header_bytes = _read_header_block(stdin)
        except ValueError as e:
            sys.stderr.write(f"process_rpc: header error after frame {frame_no}: {e}\n")
            return 3

        if header_bytes is None:
            break  # clean EOF
        frame_no += 1

        try:
            n = _parse_content_length(header_bytes)
        except ValueError as e:
            _emit_frame(_err_envelope("wire", "header_parse_error", f"frame {frame_no}: {e}"))
            continue

        body = stdin.read(n)
        if len(body) != n:
            sys.stderr.write(
                f"process_rpc: truncated body on frame {frame_no} "
                f"(expected {n} bytes, got {len(body)})\n"
            )
            _emit_frame(
                _err_envelope(
                    "wire",
                    "truncated_body",
                    f"frame {frame_no}: expected {n} bytes, got {len(body)}",
                )
            )
            return 4

        try:
            payload = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            _emit_frame(
                _err_envelope("wire", "json_parse_error", f"frame {frame_no}: {e}")
            )
            continue

        _emit_frame(_process_atom_payload(payload))

    if frame_no == 0:
        sys.stderr.write("process_rpc: no input frames\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
