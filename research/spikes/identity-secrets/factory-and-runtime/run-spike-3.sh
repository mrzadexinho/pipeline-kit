#!/usr/bin/env bash
# Cat VIII spike #3 — factory-and-runtime.
# Usage (from repo root):
#   bash research/spikes/identity-secrets/factory-and-runtime/run-spike-3.sh
# Mirrors spike-#2 runner shape: invokes node directly on .ts (Node 22+
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

echo "==> [1/2] Variant A — ctx.secrets, deferred-construction (A.2 + A.3)"
"${RUNNER[@]}" variant-a-factory-runtime.ts
echo
echo "----------------------------------------------------------------------"
echo

echo "==> [2/2] Variant B — adapter-dep, two sub-cells (B.1 close-over + B.2 re-resolve)"
"${RUNNER[@]}" variant-b-factory-runtime.ts
echo

echo "==> spike OK: factory-and-runtime harness completed for both variants"
