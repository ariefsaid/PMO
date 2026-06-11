#!/usr/bin/env bash
#
# Push migrations to PROD = the Supabase Cloud project (functionally staging).
# The DB connection string is fetched from 1Password via the sanctioned host tool
# `op-get.sh <item> <vault> <field>` (it loads the service-account token itself — this
# script never touches the token file). Plaintext supabase/.env.prod is a fallback.
#
#   scripts/db-push-prod.sh           push migrations (after a typed 'prod' confirm)
#   scripts/db-push-prod.sh --check   resolve the secret + run `select 1` (NO push, NO confirm)
#                                     → the one-command "is PROD usable?" check
#
# NEVER seeds (prod data is never demo data). Uses an explicit --db-url, never the linked project.
# Full rules: docs/environments.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# Non-secret op-get coordinates (item / vault / field).
. supabase/op.prod.env
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

# 1) Preferred: fetch the secret from 1Password via op-get.sh.
if [ -x "$OP_GET" ]; then
  if ! SUPABASE_PROD_DB_URL="$("$OP_GET" "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_PROD_ITEM' / '$OP_PROD_FIELD' in vault '$OP_PROD_VAULT'." >&2
    echo "  Create that 1Password item (field '$OP_PROD_FIELD' = the pooler URI), or fall back to" >&2
    echo "  supabase/.env.prod. See docs/environments.md." >&2
    exit 1
  fi
# 2) Fallback: gitignored plaintext file.
elif [ -f supabase/.env.prod ]; then
  set -a; . supabase/.env.prod; set +a
fi
: "${SUPABASE_PROD_DB_URL:?No PROD secret — set up 1Password (op-get.sh / vault $OP_PROD_VAULT) or supabase/.env.prod. See docs/environments.md}"

if [ "${1:-}" = "--check" ]; then
  echo "→ PROD: secret resolved; checking DB reachability…"
  psql "$SUPABASE_PROD_DB_URL" -tAc 'select 1' >/dev/null \
    && echo "✓ PROD is usable (1Password resolved + DB reachable)."
  exit 0
fi

echo "⚠  PROD migration → the Supabase Cloud project. Seed is NEVER run here."
read -r -p "   Type 'prod' to confirm: " ans
if [ "$ans" != "prod" ]; then
  echo "Aborted." >&2
  exit 1
fi

supabase db push --db-url "$SUPABASE_PROD_DB_URL"
echo "✓ PROD migrations applied."
