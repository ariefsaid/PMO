#!/usr/bin/env bash
#
# DORMANT forward-compat: push migrations to a HOSTED test/staging Supabase project.
# In the current setup "test" = LOCAL Docker — use `supabase db reset` (applies migrations +
# seed locally), NOT this script. This exists only for when a separate hosted test env is added;
# it mirrors db-push-prod.sh (secret via op-get.sh, plaintext supabase/.env.test fallback).
#
#   scripts/db-push-test.sh           push migrations
#   scripts/db-push-test.sh --seed    push, then load supabase/seed.sql
#   scripts/db-push-test.sh --check   resolve the secret + `select 1` (no push)
#
# Full rules: docs/environments.md.
set -euo pipefail
cd "$(dirname "$0")/.."

. supabase/op.test.env
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

if [ -x "$OP_GET" ]; then
  if ! SUPABASE_TEST_DB_URL="$("$OP_GET" "$OP_TEST_ITEM" "$OP_TEST_VAULT" "$OP_TEST_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_TEST_ITEM' / '$OP_TEST_FIELD' in vault '$OP_TEST_VAULT'." >&2
    echo "  (Today 'test' = local Docker — use 'supabase db reset' instead.) See docs/environments.md." >&2
    exit 1
  fi
elif [ -f supabase/.env.test ]; then
  set -a; . supabase/.env.test; set +a
fi
: "${SUPABASE_TEST_DB_URL:?No hosted-test secret — today test = local Docker ('supabase db reset'). See docs/environments.md}"

if [ "${1:-}" = "--check" ]; then
  echo "→ TEST: secret resolved; checking DB reachability…"
  psql "$SUPABASE_TEST_DB_URL" -tAc 'select 1' >/dev/null \
    && echo "✓ hosted TEST is usable (1Password resolved + DB reachable)."
  exit 0
fi

echo "→ Pushing migrations to hosted TEST…"
supabase db push --db-url "$SUPABASE_TEST_DB_URL"
if [ "${1:-}" = "--seed" ]; then
  echo "→ Seeding hosted TEST from supabase/seed.sql…"
  psql "$SUPABASE_TEST_DB_URL" -f supabase/seed.sql
fi
echo "✓ hosted TEST is up to date."
