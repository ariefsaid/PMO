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
# Under ADR-0101 (shared multi-tenant project), this script REFUSES to seed if the target
# database holds any organization other than the demo seed organization, or any profile
# outside the seed organization. There is NO override flag.
#
# Secret handling mirrors db-push-prod.sh: the DB URL is fetched from 1Password via the
# sanctioned `op-get.sh` at runtime and never written to a file or printed.
#
#   scripts/db-seed-prod.sh             apply seed.sql (after guard check + typed 'prod-seed' confirm)
#   scripts/db-seed-prod.sh --check     resolve the secret + `select 1` (no seed)
#   scripts/db-seed-prod.sh --self-test run test cases for the guard logic
#
# Full rules: docs/environments.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# The canonical demo seed organization.
SEED_ORG_ID="00000000-0000-0000-0000-000000000001"

check_seed_safety() {
  local query_output="$1"
  local foreign=()
  local line

  while IFS= read -r line || [ -n "$line" ]; do
    line="$(echo "$line" | tr -d '\r ')"
    [ -z "$line" ] && continue
    if [ "$line" != "$SEED_ORG_ID" ]; then
      foreign+=("$line")
    fi
  done <<< "$query_output"

  if [ "${#foreign[@]}" -gt 0 ]; then
    echo "✗ Refusing to seed: target database holds organization(s) or profile(s) outside the seed organization ($SEED_ORG_ID)." >&2
    echo "  Found non-seed id(s): ${foreign[*]}" >&2
    echo "  The demo seed cannot be applied to a shared multi-tenant project (ADR-0101)." >&2
    return 1
  fi

  return 0
}

if [ "${1:-}" = "--source-only" ]; then
  # shellcheck disable=SC2317
  return 0 2>/dev/null || exit 0
fi

if [ "${1:-}" = "--self-test" ]; then
  # Test 1: empty database (no organizations, no profiles) -> allowed
  if ! check_seed_safety ""; then
    echo "self-test FAIL: empty input was refused" >&2
    exit 1
  fi

  # Test 2: seed only (only seed organization and profiles in seed org) -> allowed
  if ! check_seed_safety "$SEED_ORG_ID"; then
    echo "self-test FAIL: seed-only input was refused" >&2
    exit 1
  fi

  # Test 3: seed plus another organization -> refused
  seed_plus_other=$(printf "%s\n%s" "$SEED_ORG_ID" "11111111-1111-1111-1111-111111111111")
  if check_seed_safety "$seed_plus_other" 2>/dev/null; then
    echo "self-test FAIL: seed plus another organization was not refused" >&2
    exit 1
  fi

  # Test 4: profile outside seed organization -> refused
  profile_outside=$(printf "%s\n%s" "$SEED_ORG_ID" "22222222-2222-2222-2222-222222222222")
  if check_seed_safety "$profile_outside" 2>/dev/null; then
    echo "self-test FAIL: profile outside seed organization was not refused" >&2
    exit 1
  fi

  # Test 5: profile with null org_id -> refused
  profile_null=$(printf "%s\n%s" "$SEED_ORG_ID" "null")
  if check_seed_safety "$profile_null" 2>/dev/null; then
    echo "self-test FAIL: null profile org_id was not refused" >&2
    exit 1
  fi

  echo "✓ db-seed-prod self-test passed (empty, seed only, seed plus client org, non-seed profile, null profile)"
  exit 0
fi

# PATH defense: Homebrew's libpq (psql) is keg-only / not symlinked onto PATH.
export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

# Non-secret op-get coordinates (item / vault / field).
# shellcheck disable=SC1091
. supabase/op.prod.env
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

if [ -x "$OP_GET" ]; then
  if ! SUPABASE_PROD_DB_URL="$("$OP_GET" "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_PROD_ITEM' / '$OP_PROD_FIELD' in vault '$OP_PROD_VAULT'." >&2
    exit 1
  fi
elif [ -f supabase/.env.prod ]; then
  set -a
  # shellcheck disable=SC1091
  . supabase/.env.prod
  set +a
fi
: "${SUPABASE_PROD_DB_URL:?No PROD secret — set up 1Password (op-get.sh) or supabase/.env.prod. See docs/environments.md}"

if [ "${1:-}" = "--check" ]; then
  echo "→ PROD seed: secret resolved; checking DB reachability…"
  psql "$SUPABASE_PROD_DB_URL" -tAc 'select 1' >/dev/null
  echo "✓ PROD is reachable."
  exit 0
fi

# Guard: Refuse BEFORE applying anything if the target DB holds any client org
# or any profile outside the demo seed organization (ADR-0101 / #2256).
echo "→ Checking target database for existing client organizations (ADR-0101 guard)…"
ORGS_QUERY="select id::text from public.organizations union select coalesce(org_id::text, 'null') from public.profiles;"
query_output="$(psql "$SUPABASE_PROD_DB_URL" -v ON_ERROR_STOP=1 -tAc "$ORGS_QUERY")"
if ! check_seed_safety "$query_output"; then
  exit 1
fi

echo "⚠  DEMO SEED → the Supabase Cloud project (idempotent; on-conflict-do-nothing). Demo login users will exist on the live demo."
read -r -p "   Type 'prod-seed' to confirm: " ans
if [ "$ans" != "prod-seed" ]; then
  echo "Aborted." >&2
  exit 1
fi

psql "$SUPABASE_PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
echo "✓ PROD demo seed applied (supabase/seed.sql)."
