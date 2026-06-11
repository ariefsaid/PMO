#!/usr/bin/env bash
#
# Push migrations to PRODUCTION. GATED: requires typing "prod" to proceed, and
# uses an EXPLICIT --db-url (never the remembered link). It NEVER seeds — prod
# data is never demo data. See docs/environments.md for the full rules.
#   Usage:  scripts/db-push-prod.sh
#
# Reads supabase/.env.prod (gitignored). Create it from the template in
# docs/environments.md.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="supabase/.env.prod"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ Missing $ENV_FILE — create it from the template in docs/environments.md." >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_PROD_DB_URL:?set SUPABASE_PROD_DB_URL in $ENV_FILE}"

echo "⚠  PROD target: ${SUPABASE_PROD_DB_URL##*@}"
echo "   This applies migrations to PRODUCTION. Seed is NEVER run here."
read -r -p "   Type 'prod' to confirm: " ans
if [ "$ans" != "prod" ]; then
  echo "Aborted." >&2
  exit 1
fi

supabase db push --db-url "$SUPABASE_PROD_DB_URL"
echo "✓ PROD migrations applied."
