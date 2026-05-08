#!/usr/bin/env bash
# Cat IX spike #2 — NDJSON multi-atom + error-branch round-trip.
# Usage (from repo root):  bash research/spikes/cross-runtime/run-stream.sh
# Pipeline: TS Source (3 atoms) -> Python Process (per-line) -> TS Sink (pattern check).
# Exits 0 only when the stream emits exactly 1 OK + 2 ERR(schema, business_rule).

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SPIKE_DIR"

echo "==> [1/3] TS emits 3 Atom<Job> Results, NDJSON one-per-line"
echo "==> [2/3] Python processes line-by-line: schema + business rules"
echo "==> [3/3] TS sink verifies 1 OK + 2 ERR(schema, business_rule)"
echo

node ts/atom-emit-stream.ts \
  | uv run --quiet --with 'pydantic>=2' python3 py/process_stream.py \
  | node ts/result-validate-stream.ts

echo
echo "==> spike OK: NDJSON stream + error-branch round-trip succeeded"
