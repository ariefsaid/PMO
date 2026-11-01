#!/usr/bin/env bash
#
# with-odoo-lock.sh — mutual exclusion for the local stock Odoo 20 Community dev bed
# (docs/environments.md "Odoo 20 Community dev bed"). A THIRD machine-global shared
# resource on this host, beside the local Supabase stack (with-db-lock.sh) and the
# ERPNext bench (with-erpnext-lock.sh): the bed is one Docker Compose project, so two
# agents resetting / seeding / probing it at once corrupt each other. Same flock idiom,
# a DIFFERENT lockfile. Cooperative: only works if ALL agents route bed work through it.
#
#   scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh reset
#
# ── ACQUISITION ORDER (machine-global, outermost first): odoo -> erpnext -> db -> test ──
# This is the OUTERMOST lock (see scripts/lib/flock-run.sh).
#
#   PMO_ODOO_LOCK          override the lock path (default ~/.pmo-odoo.lock)
#   PMO_ODOO_LOCK_TIMEOUT  seconds to wait before giving up (default: wait forever)
set -euo pipefail

LOCK="${PMO_ODOO_LOCK:-$HOME/.pmo-odoo.lock}"
TIMEOUT="${PMO_ODOO_LOCK_TIMEOUT:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>   (wraps an Odoo-bed-driving command in the shared lock)" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/lib/flock-run.sh" "odoo-lock" "$LOCK" "$TIMEOUT" "PMO_ODOO_LOCK_HELD" \
  "the shared Odoo dev bed" -- "$@"
