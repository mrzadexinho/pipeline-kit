#!/usr/bin/env bash
# Cat IX spike #3 — LSP-style Content-Length framing comparison.
# Usage (from repo root):  bash research/spikes/cross-runtime/run-rpc.sh
# Pipeline: TS Source (3 framed atoms) -> Python Process (frame-by-frame) -> TS Sink.
# Exits 0 only when the framed stream emits exactly 1 OK + 2 ERR(schema, business_rule).

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SPIKE_DIR"

echo "==> [1/3] TS emits 3 Atom<Job> Results, LSP Content-Length-framed"
echo "==> [2/3] Python parses frames: schema + business rules"
echo "==> [3/3] TS sink verifies 1 OK + 2 ERR(schema, business_rule)"
echo

node ts/atom-emit-rpc.ts \
  | uv run --quiet --with 'pydantic>=2' python3 py/process_rpc.py \
  | node ts/result-validate-rpc.ts

echo
echo "==> spike OK: LSP framing + error-branch round-trip succeeded"
