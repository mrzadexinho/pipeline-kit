#!/usr/bin/env bash
# Cat VIII spike #1 — where-does-it-live: three variants over a shared mock.
# Usage (from repo root):  bash research/spikes/identity-secrets/where-does-it-live/run-spike-1.sh
# Mirrors cross-runtime/run-*.sh: invokes node directly on .ts (Node 22+ strip-types).
# Exits 0 only if all three variants complete cleanly.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SPIKE_DIR"

echo "==> [1/3] Variant A — ctx.secrets (Context concern)"
node variant-a-context-concern.ts
echo

echo "==> [2/3] Variant B — Source.create({ deps: { secrets } }) (adapter dep)"
node variant-b-adapter-dep.ts
echo

echo "==> [3/3] Variant C — Secrets.fetch(name).through(source) (stage type)"
node variant-c-stage-type.ts
echo

echo "==> spike OK: all three variants completed"
