#!/usr/bin/env bash
# Standing cross-org isolation proof (#612): throwaway tenants on the LOCAL / CI stack, then
# scripts/isolation-probe.sh twice — read mode, and write mode (PROBE_A_DISPOSABLE=1) — failing on any leak,
# probe error, a crashed probe, or a write probe that was skipped for lack of a disposable tenant A.
#   scripts/with-db-lock.sh scripts/isolation-proof.sh        # run (needs the local stack up)
#   scripts/isolation-proof.sh --self-test                    # prove the verdict logic can fail
# Never aimed at a hosted project: it refuses any API URL that is not this machine.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="${ISOLATION_PROBE:-$SCRIPT_DIR/isolation-probe.sh}"
A_ORG=a6120000-0000-4000-8000-00000000000a
B_ORG=a6120000-0000-4000-8000-00000000000b
# Write-mode skips the fixtures cannot fill (tables the seed has no row for). Lower it when the fixtures improve;
# a rise means a fixture stopped copying a table and coverage shrank.
WRITE_SKIP_CEILING="${WRITE_SKIP_CEILING:-248}"

# judge <read|write> <probe exit code> <probe output file>: print the counts, return 0 only for a clean run.
judge(){
  local mode=$1 rc=$2 log=$3 line checks leaks errors skipped bad=0
  line=$(grep -E '^=== checks: [0-9]+ +leaks: [0-9]+ +probe_errors: [0-9]+ +skipped: [0-9]+' "$log" | tail -1)
  [ -n "$line" ] || { echo "isolation-proof[$mode]: probe printed no summary (rc=$rc): crashed or refused to run" >&2; return 1; }
  read -r checks leaks errors skipped <<< "$(sed -E 's/^=== checks: ([0-9]+) +leaks: ([0-9]+) +probe_errors: ([0-9]+) +skipped: ([0-9]+).*/\1 \2 \3 \4/' <<< "$line")"
  echo "isolation-proof[$mode]: checks=$checks leaks=$leaks probe_errors=$errors skipped=$skipped (probe rc=$rc)"
  [ "$checks" -gt 0 ] || { echo "  FAIL: no checks ran" >&2; bad=1; }
  [ "$leaks" = 0 ] || { echo "  FAIL: $leaks leak(s)" >&2; bad=1; }
  [ "$errors" = 0 ] || { echo "  FAIL: $errors probe error(s)" >&2; bad=1; }
  [ "$rc" = 0 ] || { echo "  FAIL: probe exit code $rc" >&2; bad=1; }
  if [ "$mode" = write ]; then
    if grep -q 'needs disposable tenant A' "$log"; then echo "  FAIL: a write probe was skipped for lack of a disposable tenant A" >&2; bad=1; fi
    [ "$skipped" -le "$WRITE_SKIP_CEILING" ] || { echo "  FAIL: $skipped skips, ceiling is $WRITE_SKIP_CEILING (fixtures lost coverage)" >&2; bad=1; }
  fi
  [ "$bad" = 0 ]
}

self_test(){
  local d; d=$(mktemp -d) || exit 2; trap 'rm -rf "$d"' RETURN
  WRITE_SKIP_CEILING=5
  mk(){ printf '%b' "$2" > "$d/$1"; }
  mk ok    '  PASS x\n=== checks: 40  leaks: 0  probe_errors: 0  skipped: 3\n'
  mk leak  '=== checks: 40  leaks: 1  probe_errors: 0  skipped: 0\n'
  mk err   '=== checks: 40  leaks: 0  probe_errors: 2  skipped: 0\n'
  mk none  'curl: (7) refused\n'
  mk zero  '=== checks: 0  leaks: 0  probe_errors: 0  skipped: 0\n'
  mk many  '=== checks: 40  leaks: 0  probe_errors: 0  skipped: 6\n'
  mk disp  '  ⚠ SKIPPED  t update — needs disposable tenant A\n=== checks: 40  leaks: 0  probe_errors: 0  skipped: 1\n'
  local fails=0
  expect(){ # expect <pass|fail> <mode> <rc> <file>
    judge "$2" "$3" "$d/$4" >/dev/null 2>&1; local got=$?
    if { [ "$1" = pass ] && [ $got != 0 ]; } || { [ "$1" = fail ] && [ $got = 0 ]; }; then echo "self-test FAIL: $2/$4 rc=$3 expected $1" >&2; fails=1; fi
  }
  expect pass read 0 ok;   expect pass write 0 ok
  expect fail read 1 leak; expect fail write 0 leak
  expect fail read 4 err;  expect fail read 0 err
  expect fail read 2 none; expect fail read 0 zero
  expect fail write 0 many; expect pass read 0 many
  expect fail write 0 disp; expect pass read 0 disp
  expect fail read 3 ok
  [ "$fails" = 0 ] && echo "isolation-proof self-test: ok (verdicts redden on leak, error, crash, no checks, skipped write probes, lost coverage)"
  return $fails
}

[ "${1:-}" != --self-test ] || { self_test; exit $?; }

command -v jq >/dev/null && command -v curl >/dev/null || { echo 'isolation-proof: jq and curl are required' >&2; exit 2; }
eval "$(cd "$SCRIPT_DIR/.." && supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
for v in API_URL ANON_KEY SERVICE_ROLE_KEY DB_URL; do [ -n "${!v:-}" ] || { echo "isolation-proof: local stack not running ($v missing)" >&2; exit 2; }; done
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo 'isolation-proof: refusing a non-local API URL' >&2; exit 2 ;; esac

if command -v psql >/dev/null; then sql(){ psql "$DB_URL" -X -At -q -v ON_ERROR_STOP=1 "$@"; }
else sql(){ docker exec -i "${SUPABASE_DB_CONTAINER:-supabase_db_pmo-portal}" psql -U postgres -d postgres -X -At -q -v ON_ERROR_STOP=1 "$@"; }; fi
work=$(mktemp -d "${TMPDIR:-/tmp}/isolation-proof.XXXXXX") || exit 2
b_password=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')Aa1
fixtures(){ sql -v action="$1" -v b_password="$b_password" < "$SCRIPT_DIR/isolation-fixtures.sql"; }
cleanup(){
  fixtures down >/dev/null 2>&1
  left=$(sql -c "select (select count(*) from organizations where id in ('$A_ORG','$B_ORG')) + (select count(*) from auth.users where email = 'isolation-proof-b@example.invalid')" 2>/dev/null)
  rm -rf "$work"
  [ "$left" = 0 ] || { echo "isolation-proof: fixtures not fully removed (left=$left)" >&2; exit 5; }
}
trap cleanup EXIT

fixtures up | sed 's/^ISO-COPY-SKIPPED /  copy skipped: /' | cut -c1-200 || exit 2
# Sign B in with its password (never printed).
code=$(curl -sS -o "$work/login" -w '%{http_code}' -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg p "$b_password" '{email:"isolation-proof-b@example.invalid",password:$p}')" "$API_URL/auth/v1/token?grant_type=password")
[ "$code" = 200 ] || { echo "isolation-proof: B sign-in failed (HTTP $code)" >&2; exit 2; }
JWT_B=$(jq -er .access_token "$work/login") || exit 2
# One A row id per applicable table the fixtures filled; the probe verifies each belongs to A before using it.
rows_sql=$(jq -r --arg a "$A_ORG" '[.tables[]|select(.by_id=="applicable" and .has_org)|"select jsonb_build_object('"'"'table'"'"','"'"'\(.table)'"'"','"'"'pk'"'"','"'"'\(.pk)'"'"','"'"'id'"'"',(select \"\(.pk)\" from public.\"\(.table)\" where org_id='"'"'\($a)'"'"' limit 1)) as r"]|join(" union all ")' "$SCRIPT_DIR/isolation-probe-denominator.json")
sql -c "select coalesce(jsonb_agg(r), '[]') from ($rows_sql) q where r->>'id' is not null" > "$work/rows" || exit 2
[ -s "$work/rows" ] && jq -e 'length>0' "$work/rows" >/dev/null || { echo 'isolation-proof: fixtures produced no tenant A rows' >&2; exit 2; }
echo "isolation-proof: tenant A rows for $(jq length "$work/rows") tables"

export BASE="$API_URL" ANON="$ANON_KEY" SERVICE="$SERVICE_ROLE_KEY" JWT_B A_ORG B_ORG A_ROWS_JSON="$work/rows" STRICT=0
fail=0
for mode in read write; do
  if [ "$mode" = write ]; then export PROBE_A_DISPOSABLE=1; else unset PROBE_A_DISPOSABLE; fi
  "$PROBE" > "$work/$mode.log" 2>&1; rc=$?
  grep -E 'LEAK|PROBE-ERROR|SKIPPED' "$work/$mode.log" | sort | uniq -c | sort -rn
  judge "$mode" "$rc" "$work/$mode.log" || fail=1
  { echo "isolation-proof[$mode]: $(grep -E '^=== checks' "$work/$mode.log" | tail -1)"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
done
exit $fail
