"""Cat IX spike #1 — Python Process<Atom[], Atom[]>.

Reads JSON Result envelope from stdin, validates with Pydantic, mutates
deterministically (uppercases title), re-emits Result on stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import ValidationError

from schema import ResultOk


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("process_atom: empty stdin", file=sys.stderr)
        return 2
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"process_atom: JSON parse error: {e}", file=sys.stderr)
        return 3

    # Must be Result envelope. Reject if error is non-null upstream.
    if not isinstance(payload, dict) or "data" not in payload or "error" not in payload:
        print("process_atom: missing Result discriminants {data,error}", file=sys.stderr)
        return 4
    if payload["error"] is not None:
        print(f"process_atom: upstream error: {payload['error']}", file=sys.stderr)
        return 5

    try:
        result = ResultOk.model_validate(payload)
    except ValidationError as e:
        print(f"process_atom: schema validation failed:\n{e}", file=sys.stderr)
        return 6

    # Deterministic mutation: uppercase title in each atom's data.
    out_atoms: list[dict[str, Any]] = []
    for atom in result.data:
        # model_dump preserves field order + types; mode='json' coerces datetime → ISO string etc.
        d = atom.model_dump(mode="json")
        d["data"]["title"] = d["data"]["title"].upper()
        # Stamp a metadata trace of the python hop.
        d["metadata"]["py_hop"] = "process_atom.py"
        out_atoms.append(d)

    out = {"data": out_atoms, "error": None}
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
