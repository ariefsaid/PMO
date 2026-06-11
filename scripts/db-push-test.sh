#!/usr/bin/env bash
#
# Push migrations to the TEST Supabase environment (the SAFE default).
# Target is explicit (--db-url) so it never depends on the remembered link.
#   Usage:  scripts/db-push-test.sh            # push migrations only
#           scripts/db-push-test.sh --seed     # push, then load supabase/seed.sql
#
# Reads supabase/.env.test (gitignored). Create it from the template in
# docs/environments.md. See that doc for the full multi-env rules.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="supabase/.env.test"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ Missing $ENV_FILE — create it from the template in docs/environments.md." >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_TEST_DB_URL:?set SUPABASE_TEST_DB_URL in $ENV_FILE}"

# Echo only the host (never the credentials) so the target is visible in logs.
echo "→ TEST target: ${SUPABASE_TEST_DB_URL##*@}"
supabase db push --db-url "$SUPABASE_TEST_DB_URL"

if [ "${1:-}" = "--seed" ]; then
  echo "→ Seeding TEST from supabase/seed.sql …"
  psql "$SUPABASE_TEST_DB_URL" -f supabase/seed.sql
fi

echo "✓ TEST is up to date."
