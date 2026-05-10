#!/usr/bin/env bash
# Cat V spike #3 — driver. Runs cell α (run-1 + run-2) then cell β (run-1 + run-2)
# as 4 SEPARATE bun-run invocations. Process boundary IS the durability axis.
# Cleans .spike-3-data/ between cells (each cell needs its own DB; α's
# duplicate-key state must not leak into β's enumeration).
set -euo pipefail
cd "$(dirname "$0")"

DATA_DIR="./.spike-3-data"

echo "### Cat V spike #3 — cross-run-persistence-and-verb-set (2 cells, 4 runs) ###"

# Clean state.
rm -rf "${DATA_DIR}"
mkdir -p "${DATA_DIR}"

echo "--- cell α run-1 (writes 3 atoms; process exits) ---"
bun run cell-alpha-minimum-verbs.ts run-1
echo "--- cell α run-2 (separate process; reads same 3 keys; α.2 probe) ---"
bun run cell-alpha-minimum-verbs.ts run-2

# Wipe between cells so β's namespace enumeration is not polluted by α's keys.
rm -rf "${DATA_DIR}"
mkdir -p "${DATA_DIR}"

echo "--- cell β run-1 (writes 5 atoms in a namespace; process exits) ---"
bun run cell-beta-verb-growth.ts run-1
echo "--- cell β run-2 (separate process; namespace-only Source; Listable enumeration) ---"
bun run cell-beta-verb-growth.ts run-2

echo "--- summary ---"
echo "all 4 invocations exited 0; spike #3 complete"
