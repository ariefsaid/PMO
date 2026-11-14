#!/usr/bin/env bash
# scripts/db-seed-prod.test.sh — Issue #2256
# Tests that db-seed-prod.sh refuses when the target DB holds client organizations or non-seed profiles.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/db-seed-prod.sh"

echo "=== Running db-seed-prod.sh --self-test ==="
"$SCRIPT" --self-test

echo "=== Testing decision function via isolated subshell tests ==="
SEED_ORG="00000000-0000-0000-0000-000000000001"
CLIENT_ORG="99999999-9999-9999-9999-999999999999"
CLIENT_PROFILE_ORG="88888888-8888-8888-8888-888888888888"

# 1. Empty input -> allowed
out=$(mktemp)
err=$(mktemp)
trap 'rm -f "$out" "$err"' EXIT

# Test 1: Empty input (no organizations, no profiles)
if ! bash -c ". '$SCRIPT' --source-only && check_seed_safety ''" >"$out" 2>"$err"; then
  echo "FAIL: empty input was refused" >&2
  cat "$err" >&2
  exit 1
fi
echo "✓ Test 1: Empty target is allowed"

# Test 2: Seed only
if ! bash -c ". '$SCRIPT' --source-only && check_seed_safety '$SEED_ORG'" >"$out" 2>"$err"; then
  echo "FAIL: seed only input was refused" >&2
  cat "$err" >&2
  exit 1
fi
echo "✓ Test 2: Seed-only target is allowed"

# Test 3: Seed plus another organization -> refused
seed_plus_other=$(printf "%s\n%s" "$SEED_ORG" "$CLIENT_ORG")
if bash -c ". '$SCRIPT' --source-only && check_seed_safety '$seed_plus_other'" >"$out" 2>"$err"; then
  echo "FAIL: seed plus another organization was NOT refused" >&2
  exit 1
fi
if ! grep -q "Refusing to seed" "$err" || ! grep -q "ADR-0101" "$err"; then
  echo "FAIL: expected refusal message mentioning reason and ADR-0101, got:" >&2
  cat "$err" >&2
  exit 1
fi
echo "✓ Test 3: Seed plus another organization is refused with clear message"

# Test 4: Another organization only -> refused
if bash -c ". '$SCRIPT' --source-only && check_seed_safety '$CLIENT_ORG'" >"$out" 2>"$err"; then
  echo "FAIL: client organization alone was NOT refused" >&2
  exit 1
fi
echo "✓ Test 4: Client organization alone is refused"

# Test 5: Profile outside seed organization -> refused
profile_outside=$(printf "%s\n%s" "$SEED_ORG" "$CLIENT_PROFILE_ORG")
if bash -c ". '$SCRIPT' --source-only && check_seed_safety '$profile_outside'" >"$out" 2>"$err"; then
  echo "FAIL: profile outside seed organization was NOT refused" >&2
  exit 1
fi
echo "✓ Test 5: Profile outside seed organization is refused"

# Test 6: Profile with null org_id -> refused
profile_null=$(printf "%s\n%s" "$SEED_ORG" "null")
if bash -c ". '$SCRIPT' --source-only && check_seed_safety '$profile_null'" >"$out" 2>"$err"; then
  echo "FAIL: null profile org_id was NOT refused" >&2
  exit 1
fi
echo "✓ Test 6: Null profile org_id is refused"

echo "=== All seed guard tests PASSED ==="
