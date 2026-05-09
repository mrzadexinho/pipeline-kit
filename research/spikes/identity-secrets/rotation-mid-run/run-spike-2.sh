#!/usr/bin/env bash
# Cat VIII spike #2 — rotation-mid-run.
# Usage (from repo root):
#   bash research/spikes/identity-secrets/rotation-mid-run/run-spike-2.sh
# Mirrors spike-#1 runner shape: invokes node directly on .ts (Node 22+
# strip-types). Falls back to bun if node is absent. Exits 0 only if both
# variant runs complete cleanly.

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

echo "==> [1/2] Variant A — ctx.secrets + run-scope cache wrapper"
"${RUNNER[@]}" variant-a-rotation.ts
echo
echo "----------------------------------------------------------------------"
echo

echo "==> [2/2] Variant B — adapter-dep, two sub-cases (CoA + CoR)"
"${RUNNER[@]}" variant-b-rotation.ts
echo

echo "==> spike OK: rotation harness completed for both variants"
