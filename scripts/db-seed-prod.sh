#!/usr/bin/env bash
#
# Seed PROD (the Supabase Cloud project) with the DEMO dataset (supabase/seed.sql).
#
# ⚠ DEMO-DEPLOY POSTURE ONLY. The default rule (docs/environments.md) is that prod is NEVER
# seeded with demo data. This script exists because the Cloud project is currently a PUBLIC
# DEMO SHOWCASE (VITE_DEMO_MODE=true; the login page already advertises the acme.test demo
# creds). Applying the demo seed populates that showcase. seed.sql is IDEMPOTENT
# (every insert is `on conflict … do nothing/update`; no truncate/delete) so re-running is
# safe and never wipes data. If/when prod becomes a real tenant with real customer data,
# DELETE this script and never run a demo seed against it again.
#
# Secret handling mirrors db-push-prod.sh: the DB URL is fetched from 1Password via the
# sanctioned `op-get.sh` at runtime and never written to a file or printed.
#
#   scripts/db-seed-prod.sh           apply seed.sql (after a typed 'prod-seed' confirm)
#   scripts/db-seed-prod.sh --check   resolve the secret + `select 1` (no seed)
#
# Full rules: docs/environments.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# PATH defense: Homebrew's libpq (psql) is keg-only / not symlinked onto PATH.
export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

# Non-secret op-get coordinates (item / vault / field).
. supabase/op.prod.env
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

if [ -x "$OP_GET" ]; then
  if ! SUPABASE_PROD_DB_URL="$("$OP_GET" "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_PROD_ITEM' / '$OP_PROD_FIELD' in vault '$OP_PROD_VAULT'." >&2
    exit 1
  fi
elif [ -f supabase/.env.prod ]; then
  set -a; . supabase/.env.prod; set +a
fi
: "${SUPABASE_PROD_DB_URL:?No PROD secret — set up 1Password (op-get.sh) or supabase/.env.prod. See docs/environments.md}"

if [ "${1:-}" = "--check" ]; then
  echo "→ PROD seed: secret resolved; checking DB reachability…"
  psql "$SUPABASE_PROD_DB_URL" -tAc 'select 1' >/dev/null
  echo "✓ PROD is reachable."
  exit 0
fi

echo "⚠  DEMO SEED → the Supabase Cloud project (idempotent; on-conflict-do-nothing). Demo login users will exist on the live demo."
read -r -p "   Type 'prod-seed' to confirm: " ans
if [ "$ans" != "prod-seed" ]; then
  echo "Aborted." >&2
  exit 1
fi

psql "$SUPABASE_PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
echo "✓ PROD demo seed applied (supabase/seed.sql)."
