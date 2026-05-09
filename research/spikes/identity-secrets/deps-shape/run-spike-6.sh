#!/usr/bin/env bash
# Cat VIII spike #6 leg-3 — deps-shape.
# Usage (from repo root):
#   bash research/spikes/identity-secrets/deps-shape/run-spike-6.sh
# Mirrors spike-#5 runner shape: invokes node directly on .ts (Node 22+
# strip-types). Falls back to bun if node is absent. Exits 0 only if both
# cell runs complete cleanly. Cell (2) is structurally disqualified — see
# FINDINGS-spike-6.md § 5.

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

echo "==> [1/2] Cell (1) — flat / single resolver, multi-resolve"
"${RUNNER[@]}" cell-1-flat.ts
echo
echo "----------------------------------------------------------------------"
echo

echo "==> [2/2] Cell (3) — scoped sub-resolver in deps"
"${RUNNER[@]}" cell-3-scope.ts
echo

echo "==> spike OK: deps-shape harness completed for cells (1) and (3)"
