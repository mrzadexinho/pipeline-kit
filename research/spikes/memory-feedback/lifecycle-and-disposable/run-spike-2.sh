#!/usr/bin/env bash
# Cat V spike #2 — driver. Runs cells α → β → γ in order.
# Aborts on first non-zero exit. Prints per-cell axis-1..5 markers + a
# trailing summary line.
set -euo pipefail
cd "$(dirname "$0")"
echo "### Cat V spike #2 — lifecycle-and-disposable (3 cells, sequential) ###"
echo "--- cell α ---"
bun run cell-alpha-close-on-contract.ts
echo "--- cell β ---"
bun run cell-beta-disposable-opt-in.ts
echo "--- cell γ ---"
bun run cell-gamma-composer-owned-lifetime.ts
echo "--- summary ---"
echo "all 3 cells exited 0; spike #2 complete"
