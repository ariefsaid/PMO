#!/usr/bin/env bash
# Standing cross-org isolation proof (#612): throwaway tenants on the LOCAL / CI stack, then
# scripts/isolation-probe.sh twice — read mode, and write mode (PROBE_A_DISPOSABLE=1) — failing on any leak,
# probe error, a crashed probe, or a write probe that was skipped for lack of a disposable tenant A.
#   scripts/with-db-lock.sh scripts/isolation-proof.sh        # run (needs the local stack up)
#   scripts/isolation-proof.sh --self-test                    # prove the verdict logic can fail
# Never aimed at a hosted project: it refuses any API or database host that is not this machine.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$SCRIPT_DIR/isolation-probe.sh"
A_ORG=a6120000-0000-4000-8000-00000000000a
B_ORG=a6120000-0000-4000-8000-00000000000b
# A floor on checks and a ceiling on skips, per mode (skips are probes the fixtures cannot fill: no seed row, or a
# table the copy could not write). More checks or fewer skips pass; a shrunk probe or more skips fail. Add probes
# for new or uncovered tables; never raise a bound.
SKIPS_READ=393 SKIPS_WRITE=273 MIN_CHECKS_READ=474 MIN_CHECKS_WRITE=594

# judge <read|write> <probe exit code> <probe output file>: print the counts, return 0 only for a clean run.
judge(){
  local mode=$1 rc=$2 log=$3 line checks leaks errors skipped bad=0
  line=$(grep -E '^=== checks: [0-9]+ +leaks: [0-9]+ +probe_errors: [0-9]+ +skipped: [0-9]+' "$log" | tail -1)
  [ -n "$line" ] || { echo "isolation-proof[$mode]: probe printed no summary (rc=$rc): crashed or refused to run" >&2; return 1; }
  read -r checks leaks errors skipped <<< "$(sed -E 's/^=== checks: ([0-9]+) +leaks: ([0-9]+) +probe_errors: ([0-9]+) +skipped: ([0-9]+).*/\1 \2 \3 \4/' <<< "$line")"
  echo "isolation-proof[$mode]: checks=$checks leaks=$leaks probe_errors=$errors skipped=$skipped (probe rc=$rc)"
  local max_skips=$SKIPS_READ min_checks=$MIN_CHECKS_READ
  if [ "$mode" = write ]; then max_skips=$SKIPS_WRITE min_checks=$MIN_CHECKS_WRITE; fi
  [ "$checks" -ge "$min_checks" ] || { echo "  FAIL: $mode: $checks checks, below the floor of $min_checks. Add probes for the new or uncovered tables; do not raise the bound." >&2; bad=1; }
  [ "$skipped" -le "$max_skips" ] || { echo "  FAIL: $mode: $skipped skipped, above the ceiling of $max_skips. Add probes for the new or uncovered tables; do not raise the bound." >&2; bad=1; }
  [ "$leaks" = 0 ] || { echo "  FAIL: $leaks leak(s)" >&2; bad=1; }
  [ "$errors" = 0 ] || { echo "  FAIL: $errors probe error(s)" >&2; bad=1; }
  [ "$rc" = 0 ] || { echo "  FAIL: probe exit code $rc" >&2; bad=1; }
  if [ "$mode" = write ]; then
    if grep -q 'needs disposable tenant A' "$log"; then echo "  FAIL: a write probe was skipped for lack of a disposable tenant A" >&2; bad=1; fi
  fi
  [ "$bad" = 0 ]
}

# local_only <api|db> <url>: succeed only when the host parses as exactly 127.0.0.1, localhost or [::1].
local_only(){
  local host='(127\.0\.0\.1|localhost|\[::1\])'
  case "$1" in
    api) [[ $2 =~ ^http://$host:[0-9]+/?$ ]] ;;
    db) [[ $2 =~ ^postgres(ql)?://([^/@?#]*@)?$host:[0-9]+/[A-Za-z0-9_]+$ ]] ;;
  esac
}

self_test(){
  local d; d=$(mktemp -d) || exit 2; trap 'rm -rf "$d"' RETURN
  SKIPS_READ=3 SKIPS_WRITE=5 MIN_CHECKS_READ=40 MIN_CHECKS_WRITE=40
  local fails=0 n=0
  # t <pass|fail> <mode> <probe rc> <checks> <leaks> <errors> <skips> [extra log line]
  t(){
    n=$((n+1)); printf '%b=== checks: %s  leaks: %s  probe_errors: %s  skipped: %s\n' "${8:-}" "$4" "$5" "$6" "$7" > "$d/$n"
    judge "$2" "$3" "$d/$n" >/dev/null 2>&1; local got=$?
    if { [ "$1" = pass ] && [ $got != 0 ]; } || { [ "$1" = fail ] && [ $got = 0 ]; }; then echo "self-test FAIL: $2 rc=$3 checks=$4 leaks=$5 errors=$6 skips=$7 expected $1" >&2; fails=1; fi
  }
  t pass read 0 40 0 0 3;  t pass write 0 40 0 0 5; t pass read 0 41 0 0 3; t pass write 0 41 0 0 5
  t fail read 1 40 1 0 3;  t fail write 0 40 1 0 5          # leak
  t fail read 4 40 0 2 3;  t fail read 0 40 0 2 3           # probe error
  t fail read 0 0 0 0 3;   t fail read 0 39 0 0 3; t fail write 0 39 0 0 5   # no checks / the probe shrank
  t fail read 0 40 0 0 4;  t pass read 0 40 0 0 2           # a skip above the ceiling fails, below passes
  t fail write 0 40 0 0 6; t pass write 0 40 0 0 4
  t fail read 3 40 0 0 3                                    # probe exit code
  t fail write 0 40 0 0 5 '  SKIPPED  t update - needs disposable tenant A\n'; t pass read 0 40 0 0 3 '  SKIPPED  t update - needs disposable tenant A\n'
  printf 'curl: (7) refused\n' > "$d/none"; judge read 2 "$d/none" >/dev/null 2>&1 && { echo 'self-test FAIL: crashed probe passed' >&2; fails=1; }
  lo(){ # lo <pass|fail> <api|db> <url>
    local_only "$2" "$3"; local got=$?
    if { [ "$1" = pass ] && [ $got != 0 ]; } || { [ "$1" = fail ] && [ $got = 0 ]; }; then echo "self-test FAIL: host guard $2 $3 expected $1" >&2; fails=1; fi
  }
  lo pass api http://127.0.0.1:54321;  lo pass api http://localhost:54321/;  lo pass api 'http://[::1]:54321'
  lo fail api https://example.supabase.co;  lo fail api http://localhost:x@other.example/;  lo fail api http://127.0.0.1.other.example:54321
  lo fail api http://127.0.0.1:54321@other.example;  lo fail api ''
  lo pass db postgresql://postgres:postgres@127.0.0.1:54322/postgres;  lo pass db 'postgres://u@[::1]:54322/postgres'
  lo fail db postgresql://postgres:pw@db.example.supabase.co:5432/postgres;  lo fail db 'postgresql://postgres@127.0.0.1:54322/postgres?host=other.example'
  lo fail db postgresql://127.0.0.1:x@other.example:5432/postgres;  lo fail db ''
  [ "$fails" = 0 ] && echo "isolation-proof self-test: ok (verdicts redden on leak, error, crash, shrunk probe, check below the floor, skip above the ceiling, skipped write probes; host guard refuses non-loopback)"
  return $fails
}

[ "${1:-}" != --self-test ] || { self_test; exit $?; }

command -v jq >/dev/null && command -v curl >/dev/null || { echo 'isolation-proof: jq and curl are required' >&2; exit 2; }
# Nothing from the caller's shell may stand in for the local stack's values, and no probe knob may shrink the run.
unset API_URL ANON_KEY SERVICE_ROLE_KEY DB_URL RPC_ONLY ISOLATION_VALIDATE_ONLY PROBE_A_DISPOSABLE TABLES_JSON
eval "$(cd "$SCRIPT_DIR/.." && supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
for v in API_URL ANON_KEY SERVICE_ROLE_KEY DB_URL; do [ -n "${!v:-}" ] || { echo "isolation-proof: local stack not running ($v missing)" >&2; exit 2; }; done
local_only api "$API_URL" && local_only db "$DB_URL" || { echo 'isolation-proof: refusing a host that is not this machine' >&2; exit 2; }

if command -v psql >/dev/null; then sql(){ psql "$DB_URL" -X -At -q -v ON_ERROR_STOP=1 "$@"; }
else sql(){ docker exec -i "${SUPABASE_DB_CONTAINER:-supabase_db_pmo-portal}" psql -U postgres -d postgres -X -At -q -v ON_ERROR_STOP=1 "$@"; }; fi
work=$(mktemp -d "${TMPDIR:-/tmp}/isolation-proof.XXXXXX") || exit 2
b_password=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')Aa1
fixtures(){ sql -v action="$1" -v b_password="$b_password" < "$SCRIPT_DIR/isolation-fixtures.sql"; }
cleanup(){
  fixtures down >/dev/null 2>&1
  left=$(sql -c "select (select count(*) from organizations where id in ('$A_ORG','$B_ORG')) + (select count(*) from auth.users where email = 'isolation-proof-b@example.invalid') + (select count(*) from auth.sessions where user_id = 'a6120000-0000-4000-8000-0000000000b1')" 2>/dev/null)
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
