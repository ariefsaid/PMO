#!/usr/bin/env bash
#
# with-erpnext-lock.sh — mutual exclusion for the ERPNext v15 dev-bed Docker stack
# (docs/environments.md "ERPNext v15 dev bed (P2)"). A SECOND shared resource on this
# host, distinct from the local Supabase stack (locked by with-db-lock.sh) — the
# ERPNext bench is a single machine-global Docker Compose project
# (`~/Coding/frappe-docker-pmo`), so two agents driving money e2e against it at once
# (creating/submitting/cancelling the same doctypes) corrupt each other's runs. Same
# flock idiom as with-db-lock.sh, a DIFFERENT lockfile — these two locks are
# independent and BOTH must be held for the full money-e2e recipe:
#
#   scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
#     npx playwright test e2e/AC-ENA-053-*
#
# Cooperative: it only works if ALL agents route ERPNext work through it. The lock
# is an ADVISORY fcntl.flock (kernel-released on exit; no stale lock). macOS has no
# flock(1), hence python3 (stdlib fcntl). The flock core lives in
# scripts/lib/flock-run.sh.
#
# ── ACQUISITION ORDER (machine-global, outermost first): erpnext -> db -> test ──
# This lock sits BETWEEN the db lock (outer) and the test lock (inner). Acquire db
# first, then this, then test — never the reverse (see scripts/lib/flock-run.sh).
#
#   PMO_ERPNEXT_LOCK          override the lock path (default ~/.pmo-erpnext.lock)
#   PMO_ERPNEXT_LOCK_TIMEOUT  seconds to wait before giving up (default: wait forever)
set -euo pipefail

LOCK="${PMO_ERPNEXT_LOCK:-$HOME/.pmo-erpnext.lock}"
TIMEOUT="${PMO_ERPNEXT_LOCK_TIMEOUT:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>   (wraps an ERPNext-bench-driving command in the shared lock)" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/lib/flock-run.sh" "erpnext-lock" "$LOCK" "$TIMEOUT" "PMO_ERPNEXT_LOCK_HELD" \
  "the shared ERPNext dev bed" -- "$@"
