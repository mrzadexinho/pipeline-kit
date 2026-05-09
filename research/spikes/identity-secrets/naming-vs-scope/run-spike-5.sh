#!/usr/bin/env bash
# Cat VIII spike #5 leg-2 sub-(1) — naming-vs-scope.
# Usage (from repo root):
#   bash research/spikes/identity-secrets/naming-vs-scope/run-spike-5.sh
# Mirrors spike-#4 runner shape: invokes node directly on .ts (Node 22+
# strip-types). Falls back to bun if node is absent. Exits 0 only if both
# cell runs complete cleanly.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SPIKE_DIR"

if command -v node >/dev/null 2>&1; then
  RUNNER=(node)
elif command -v bun >/dev/null 2>&1; then
  RUNNER=(bun run)
else
  echo "ERROR: neither node nor bun on PATH" >&2
  exit 2
fi

echo "==> [1/2] Cell (e) — flat hyphenated naming"
"${RUNNER[@]}" cell-e-flat.ts
echo
echo "----------------------------------------------------------------------"
echo

echo "==> [2/2] Cell (f) — structural scope"
"${RUNNER[@]}" cell-f-structural.ts
echo

echo "==> spike OK: naming-vs-scope harness completed for cells (e) and (f)"
