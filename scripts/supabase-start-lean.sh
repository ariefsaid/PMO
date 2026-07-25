#!/usr/bin/env bash
#
# supabase-start-lean.sh — bring the local Supabase stack up WITHOUT the containers
# CI already skips (T4). Under load — a full `verify` plus a build plus other
# worktrees' vitest — the analytics/vector containers wedge and block
# `supabase db reset`; the reliable recovery is a full stop followed by a lean
# start. This wraps that recovery so it is one command instead of folklore.
#
#   scripts/supabase-start-lean.sh            # stop (if up) then lean start
#
# Excluded: vector,imgproxy,studio,realtime,logflare,supavisor — none are used by
# the local test loop (pgTAP, e2e) and CI omits them too, so locally they are pure
# RAM and wedge surface. Need Studio? Run a normal `supabase start` instead.
#
# Idempotent: safe when the stack is already down (the stop is best-effort).
# Must run from the repo root — the supabase CLI resolves config from ./supabase.
#
# NOTE: this drives the ONE machine-global Supabase stack, so it is a DB-driving
# command like any other — take the db lock if other agents may be running:
#   scripts/with-db-lock.sh scripts/supabase-start-lean.sh
set -euo pipefail

EXCLUDE="vector,imgproxy,studio,realtime,logflare,supavisor"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "supabase-start-lean: not inside a git repository" >&2; exit 1; }
cd "$ROOT"
[ -d supabase ] || { echo "supabase-start-lean: no ./supabase at repo root ($ROOT)" >&2; exit 1; }

echo "supabase-start-lean: stopping any running stack (best-effort)..."
supabase stop || true   # non-zero when already down — not an error here

echo "supabase-start-lean: starting without: $EXCLUDE"
supabase start -x "$EXCLUDE"
