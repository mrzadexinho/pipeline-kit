#!/usr/bin/env bash
# Cat VIII spike #4 leg-1 — version-aware-resolver.
# Usage (from repo root):
#   bash research/spikes/identity-secrets/version-aware-resolver/run-spike-4.sh
# Mirrors spike-#3 runner shape: invokes node directly on .ts (Node 22+
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

echo "==> [1/2] Variant B.1 — close-over + version-aware wrapper (cells (a) + (c))"
"${RUNNER[@]}" variant-b1-version-aware.ts
echo
echo "----------------------------------------------------------------------"
echo

echo "==> [2/2] Variant B.2 — re-resolve + version-aware wrapper (cells (b) + (d))"
"${RUNNER[@]}" variant-b2-version-aware.ts
echo

echo "==> spike OK: version-aware-resolver harness completed for B.1 and B.2"
