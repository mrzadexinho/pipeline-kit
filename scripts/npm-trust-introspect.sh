#!/usr/bin/env bash
#
# npm-trust-introspect.sh
#
# Dump the `npm trust list --json` output for a single @idriszade/* package, or
# loop over all of them. Output goes to tmp/tp-oidc-diagnosis/<pkg>.json.
#
# This script is DIAGNOSTIC ONLY. It does NOT mutate trust configuration.
# The user must execute mutating `npm trust github ...` commands manually
# under OTP elevation; see docs/development/tp-oidc-claim-diagnosis.md.
#
# Usage:
#   bash scripts/npm-trust-introspect.sh @idriszade/core
#   bash scripts/npm-trust-introspect.sh --all
#
# Note: per kit memory feedback_npm_trust_list_lag, `npm trust list` may
# return empty JSON for minutes after a successful trust create/update.
# Empty output is NOT a failure — retry in 5+ minutes.

set -euo pipefail

OUT_DIR="tmp/tp-oidc-diagnosis"
mkdir -p "$OUT_DIR"

introspect_one() {
  local pkg="$1"
  local safe_name
  safe_name="$(printf '%s' "$pkg" | sed 's:[/@]:_:g')"
  local out_file="$OUT_DIR/${safe_name}.json"

  echo "==> $pkg"
  echo "    output: $out_file"

  if npm trust list "$pkg" --json > "$out_file" 2>&1; then
    if [[ ! -s "$out_file" || "$(cat "$out_file")" == "[]" ]]; then
      echo "    (empty — see feedback_npm_trust_list_lag; retry in 5+ minutes)"
    else
      echo "    captured $(wc -l < "$out_file") lines"
    fi
  else
    echo "    ERROR: npm trust list exited non-zero (see $out_file for stderr)"
    return 1
  fi
}

if [[ "${1:-}" == "--all" ]]; then
  echo "Looping over all @idriszade/* packages..."
  # List all packages by reading package.json files in packages/*/
  for pkg_json in packages/*/package.json; do
    pkg_name="$(node -p "require('./$pkg_json').name")"
    if [[ "$pkg_name" == @idriszade/* ]]; then
      introspect_one "$pkg_name" || true
    fi
  done
elif [[ -n "${1:-}" ]]; then
  introspect_one "$1"
else
  echo "Usage: bash scripts/npm-trust-introspect.sh @idriszade/<pkg>" >&2
  echo "       bash scripts/npm-trust-introspect.sh --all" >&2
  exit 1
fi

echo
echo "Done. Diagnostic captures are in $OUT_DIR/ (gitignored)."
