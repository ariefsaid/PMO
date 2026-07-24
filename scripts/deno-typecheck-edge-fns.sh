#!/usr/bin/env bash
# deno-typecheck-edge-fns.sh — typecheck EVERY edge function entry point, from the local gate.
#
# ⚑ WHY THIS EXISTS. `supabase/functions/**` are Deno programs: they are outside `tsc` and outside
# ESLint, so `npm run verify` — the binding pre-push gate — could not see a single type error in them.
# CI had a `deno check` step, but a break therefore surfaced only after a push, and in the BFY build
# a real typecheck break in `adapter-dispatch/index.ts` (Phase C) was invisible to every LOCAL gate.
# This script closes that: `npm run verify` now runs it, and CI runs THIS SAME script, so the local
# gate and the remote gate can no longer disagree about which functions are checked.
#
# The function list is DISCOVERED, not hand-maintained: every directory with a `deno.json` and an
# `index.ts`. A hand-kept list is exactly how a new function ends up unchecked by both gates.
#
# `--lock … --frozen` when a `deno.lock` exists: a floating/uncommitted dependency bump fails here
# rather than drifting silently (the same posture as the CI step this replaces).
#
# Usage: scripts/deno-typecheck-edge-fns.sh
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno-typecheck-edge-fns: deno is not installed — install it (repo pins 2.7.11) or run the gate in CI." >&2
  exit 1
fi

status=0
checked=0
for cfg in supabase/functions/*/deno.json; do
  fn_dir="$(dirname "$cfg")"
  [ -f "$fn_dir/index.ts" ] || continue
  lock_args=()
  [ -f "$fn_dir/deno.lock" ] && lock_args=(--lock "$fn_dir/deno.lock" --frozen)
  echo "── deno check $fn_dir/index.ts ──"
  # macOS ships bash 3.2: "${arr[@]}" on an EMPTY array trips `set -u`, hence the `+` guard.
  if ! deno check --config "$cfg" "${lock_args[@]+"${lock_args[@]}"}" "$fn_dir/index.ts"; then
    status=1
  fi
  checked=$((checked + 1))
done

if [ "$checked" -eq 0 ]; then
  echo "deno-typecheck-edge-fns: found NO edge functions to check — that is a bug in this script, not a pass." >&2
  exit 1
fi

echo "deno-typecheck-edge-fns: $checked edge function entry point(s) typechecked (exit $status)"
exit "$status"
