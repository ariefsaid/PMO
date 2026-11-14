#!/usr/bin/env bash
# Run the edge-function and shared Deno assertion suites.
# Shared by CI and the local PR-to-main simulation so their test inventory and
# permissions cannot drift.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

MODE="${1:-run}"
if [[ "$MODE" != "run" && "$MODE" != "--list" ]]; then
  echo "usage: $0 [--list]" >&2
  exit 2
fi

FUNCTIONS_ROOT="${SUPABASE_FUNCTIONS_ROOT:-$REPO/supabase/functions}"
tests_inventory="$(mktemp "${TMPDIR:-/tmp}/pmo-deno-tests.XXXXXX")"
dirs_inventory="$(mktemp "${TMPDIR:-/tmp}/pmo-deno-dirs.XXXXXX")"
trap 'rm -f "$tests_inventory" "$dirs_inventory"' EXIT

# Search recursively: functions may keep tests in __tests__/ or another nested
# directory. Materializing the result propagates discovery errors and lets an
# empty inventory fail closed.
find "$FUNCTIONS_ROOT" -mindepth 2 -name '*.test.ts' -print | sort > "$tests_inventory"
if [[ ! -s "$tests_inventory" ]]; then
  echo "Deno unit inventory is empty under $FUNCTIONS_ROOT" >&2
  exit 1
fi

while IFS= read -r test_file; do
  relative="${test_file#"$FUNCTIONS_ROOT"/}"
  fn_name="${relative%%/*}"
  if [[ "$fn_name" != "_shared" ]]; then
    printf '%s/%s\n' "$FUNCTIONS_ROOT" "$fn_name"
  fi
done < "$tests_inventory" | sort -u > "$dirs_inventory"
shared_tests=0
if grep -Fq "$FUNCTIONS_ROOT/_shared/" "$tests_inventory"; then
  shared_tests=1
  printf '%s/_shared\n' "$FUNCTIONS_ROOT" >> "$dirs_inventory"
fi

if [[ "$MODE" == "--list" ]]; then
  cat "$dirs_inventory"
  exit 0
fi

while IFS= read -r fn_dir; do
  if [[ "$fn_dir" == "$FUNCTIONS_ROOT/_shared" ]]; then
    continue
  fi
  if [[ ! -f "$fn_dir/deno.json" ]]; then
    echo "missing Deno config for tested function directory: $fn_dir" >&2
    exit 1
  fi

  echo "── deno test $fn_dir ──"
  (
    cd "$fn_dir"
    deno test . --config deno.json --allow-env --allow-net --allow-read
  )
done < "$dirs_inventory"

if [[ "$shared_tests" == "1" ]]; then
  echo "── deno test $FUNCTIONS_ROOT/_shared (not reachable from a fn dir) ──"
  (
    cd "$FUNCTIONS_ROOT/erpnext-sweep"
    deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
  )
fi
