"""Cat IX spike #2 — Python Process<Atom, Atom> for NDJSON streaming.

Reads NDJSON from stdin, ONE Result<Atom, E> envelope per line. For each line:
  1. Parse the JSON envelope (parse error → Result.err, do NOT halt the stream).
  2. If `error` is non-null, pass it through verbatim (upstream already
     classified — Process should not double-classify).
  3. If `error` is null, validate the atom via day-1's `schema.Atom` model.
     ValidationError → emit Result.err({type:"schema", code, message}).
  4. If schema-valid, run business rules (`business_rules.run_all`). Failure →
     emit Result.err with the business-rule envelope.
  5. Otherwise mutate (uppercase title) + stamp metadata + emit Result.ok.

Streaming contract: NEVER halt mid-stream on a single-line failure. atom #2
failing must NOT prevent atom #3 from being processed (spike question D).

Output is line-buffered with explicit flush — relying on Python's default
line buffering for stdout-as-pipe is a known framing footgun.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import ValidationError

from business_rules import run_all
from schema import Atom


def _emit(envelope: dict[str, Any]) -> None:
    """Write one Result envelope as a single NDJSON line, flushed."""
    sys.stdout.write(json.dumps(envelope) + "\n")
    sys.stdout.flush()


def _err_envelope(type_: str, code: str, message: str) -> dict[str, Any]:
    return {"data": None, "error": {"type": type_, "code": code, "message": message}}


def _process_line(line: str, line_no: int) -> dict[str, Any]:
    """Pure transformation: line → Result envelope. No I/O."""
    # Step 1: parse the wire envelope.
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as e:
        return _err_envelope(
            "wire", "json_parse_error", f"line {line_no}: {e.msg} at col {e.colno}"
        )

    # Step 2: discriminator check (day-1 Q1 — convention not tag).
    if not isinstance(payload, dict) or "data" not in payload or "error" not in payload:
        return _err_envelope(
            "wire", "missing_discriminants", f"line {line_no}: missing data/error keys"
        )

    # Step 3: pass-through upstream errors verbatim.
    if payload["error"] is not None:
        return payload  # already a Result.err — do not re-wrap

    atom_payload = payload["data"]
    if not isinstance(atom_payload, dict):
        return _err_envelope(
            "wire",
            "data_not_object",
            f"line {line_no}: per-line spike expects Result<Atom, E>, got {type(atom_payload).__name__}",
        )

    atom_id = atom_payload.get("id", "<unknown>")

    # Step 4: schema validation via day-1's Pydantic model (UNCHANGED).
    try:
        atom = Atom.model_validate(atom_payload)
    except ValidationError as e:
        # Identify the offending atom in the message — mid-stream errors must
        # be traceable back to the atom that caused them (spike question D).
        # Code naming: probe the first error to give a stable, machine-grep
        # code rather than a free-form pydantic message. Spike-only heuristic.
        first = (e.errors() or [{}])[0]
        first_msg = str(first.get("msg", ""))
        first_loc = ".".join(str(x) for x in first.get("loc", ())) or "?"
        if "not ISO 8601" in first_msg or "fromisoformat" in first_msg or first_loc.endswith("created_at"):
            code = "iso_8601_invalid"
        else:
            code = "schema_invalid"
        return _err_envelope(
            "schema",
            code,
            f"atom {atom_id}: {e.error_count()} error(s) at {first_loc}; first: {first_msg}",
        )

    # Step 5: business rules (post-schema, pre-emit).
    job_dict = atom.data.model_dump(mode="json")
    rule = run_all(job_dict)
    if not rule["ok"]:
        err = rule["err"]
        return _err_envelope(
            err["type"],
            err["code"],
            f"atom {atom_id}: {err['message']}",
        )

    # Step 6: deterministic mutation + Python-hop trace, then re-emit Result.ok.
    out_atom = atom.model_dump(mode="json")
    out_atom["data"]["title"] = out_atom["data"]["title"].upper()
    out_atom["metadata"]["py_hop"] = "process_stream.py"
    return {"data": out_atom, "error": None}


def main() -> int:
    line_no = 0
    for raw in sys.stdin:
        line_no += 1
        line = raw.strip()
        if not line:
            continue  # tolerate stray blank lines (NDJSON convention)
        _emit(_process_line(line, line_no))
    if line_no == 0:
        sys.stderr.write("process_stream: no input lines\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
