#!/usr/bin/env bash
# Cat IX spike #1 — end-to-end stdio JSON round-trip.
# Usage (from repo root):  bash research/spikes/cross-runtime/run.sh
# Pipeline: TS Source -> Python Process -> TS Validator (sink).
# Exits 0 on round-trip success.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SPIKE_DIR"

echo "==> [1/3] TS emits Atom<Job> wrapped in Result"
echo "==> [2/3] Python validates + mutates (title -> UPPER) + re-emits"
echo "==> [3/3] TS validates round-tripped Result"
echo

node ts/atom-emit.ts \
  | uv run --quiet --with 'pydantic>=2' python3 py/process_atom.py \
  | node ts/result-validate.ts

echo
echo "==> spike OK: round-trip succeeded"
