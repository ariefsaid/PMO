#!/usr/bin/env bash
# Import every deployed edge-function entrypoint with Deno.serve stubbed.
# Shared by CI and the local PR-to-main simulation so their function inventory
# cannot drift.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

MODE="${1:-run}"
if [[ "$MODE" != "run" && "$MODE" != "--list" ]]; then
  echo "usage: $0 [--list]" >&2
  exit 2
fi

FUNCTIONS_ROOT="${SUPABASE_FUNCTIONS_ROOT:-$REPO/supabase/functions}"
inventory="$(mktemp "${TMPDIR:-/tmp}/pmo-deno-boot.XXXXXX")"
trap 'rm -f "$inventory"' EXIT

# Materialize discovery so a find error is observed by `set -e`; process
# substitution would otherwise make the loop succeed with an empty stream.
find "$FUNCTIONS_ROOT" -mindepth 2 -maxdepth 2 -name index.ts -print | sort > "$inventory"
if [[ ! -s "$inventory" ]]; then
  echo "Deno boot inventory is empty under $FUNCTIONS_ROOT" >&2
  exit 1
fi

if [[ "$MODE" == "--list" ]]; then
  cat "$inventory"
  exit 0
fi

while IFS= read -r entrypoint; do
  fn_dir="${entrypoint%/index.ts}"
  config="$fn_dir/deno.json"
  if [[ ! -f "$config" ]]; then
    echo "missing Deno config for deployed entrypoint: $entrypoint" >&2
    exit 1
  fi

  echo "── boot-smoke $entrypoint ──"
  deno run --allow-all --config "$config" scripts/deno-boot-smoke.ts "$entrypoint"
done < "$inventory"
