#!/usr/bin/env bash
#
# m365-deadlock-probe.sh — PROVE the refresh/lifecycle DEADLOCK (Luna round-3 MED) is reproduced for
# the WRONG lock order and RESOLVED by the 0105 lock-order RPCs, in both the user-disable and
# feature-disable variants.
#
# The cycle Luna reproduced: a connection mutation locks the CONNECTION tuple first, then its BEFORE
# write-guard trigger reaches the PARENT row (child→parent); a concurrent lifecycle cascade goes
# parent→child → a real lock cycle → PostgreSQL `deadlock detected`. Security is NOT bypassed (the
# lifecycle commits and the connection count is 0), but one transaction dies — a liveness/DoS defect.
#
# This probe drives the EXACT interleaving with two psql sessions, in TWO modes:
#   • legacy  — session A does a DIRECT UPDATE on ms_graph_connections (the pre-fix edge-fn write
#               path: child→parent via the guard trigger). EXPECTED: PostgreSQL reports
#               `deadlock detected` (A's transaction is aborted). This is the BEFORE direction.
#   • fixed   — session A calls the m365_refresh_connection SECURITY-DEFINER RPC (0105: locks
#               PROFILES → ORG_FEATURES BEFORE the connection row). EXPECTED: NO deadlock; A's RPC
#               returns null (the row was cascade-deleted under it); B commits; the connection is
#               gone. This is the AFTER direction.
#
# To RELIABLY create the contended window, session B (the lifecycle) is simulated in two phases via a
# held transaction: (1) `SELECT … FROM <parent> FOR UPDATE` — mimics the lifecycle holding the parent
# row — then (2) `DELETE FROM ms_graph_connections …` — mimics the AFTER-trigger cascade. This is the
# SAME lock sequence the real lifecycle takes (admin_set_user_status → UPDATE profiles locks P, then
# the AFTER offboard trigger DELETEs C; operator_toggle_feature → UPDATE org_features locks F, then
# the AFTER disentitle trigger DELETEs C), split across two statements so the window is controllable.
#
# SYNCHRONIZATION: readiness via pg_stat_activity on per-session application_name tags (no fixed
# sleep, no psql-stdout markers). HONESTY NOTE: this drives DIRECT SQL, not the real edge-fn HTTP/RPC
# path; the RPC's lock behavior under direct invocation is identical to under the supabase client,
# and the pgTAP suite (0151) covers the RPC's deterministic contract.
#
# Usage:
#   scripts/with-db-lock.sh scripts/m365-deadlock-probe.sh            (preferred)
#   scripts/m365-deadlock-probe.sh                                     (self-wraps the lock)
# Exit 0 = legacy DEADLOCKED (reproduced) AND fixed did NOT deadlock (resolved) for BOTH targets.

set -uo pipefail

if [ -z "${PMO_DB_LOCK_HELD:-}" ]; then
  export PMO_DB_LOCK_HELD=1
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  exec "$ROOT/scripts/with-db-lock.sh" "$ROOT/scripts/m365-deadlock-probe.sh"
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

resolve_db_url() {
  local url
  url="$(supabase status 2>&1 | grep -oE 'postgresql://[^[:space:]]+/postgres' | head -1 || true)"
  if [ -z "$url" ]; then url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; fi
  printf '%s' "$url"
}
DB_URL="$(resolve_db_url)"
echo "[dl-probe] DB_URL=${DB_URL}"

ORG="a151dead-0000-0000-0000-000000000001"
USR="a151dead-0000-0000-0000-0000000000a1"
ADM="a151dead-0000-0000-0000-0000000000aa"
TENANT="11111111-2222-3333-4444-555555555555"
CONN=""

seed_fixture() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations (id, name) values ('$ORG','DL Probe Org') on conflict (id) do nothing;
insert into auth.users (id, email) values ('$USR','dl-user@example.com'),('$ADM','dl-admin@example.com') on conflict (id) do nothing;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('$USR','$ORG','DL U','dl-user@example.com','Engineer','active'),
  ('$ADM','$ORG','DL Admin','dl-admin@example.com','Admin','active')
  on conflict (id) do update set org_id=excluded.org_id, status='active', role=excluded.role;
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('$ORG','m365_integration',true,null) on conflict (org_id, feature_key) do update set enabled=true;
delete from ms_graph_connections where org_id='$ORG';
insert into ms_graph_connections (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('$ORG','$USR','$TENANT',array['offline_access'],'\x01'::bytea,'kek-v1','active');
SQL
  CONN="$(psql "$DB_URL" -Atc "select id from ms_graph_connections where org_id='$ORG' and user_id='$USR';")"
}
teardown() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
delete from ms_graph_connections where org_id='$ORG';
delete from org_features where org_id='$ORG' and feature_key='m365_integration';
delete from profiles where org_id='$ORG' and id in ('$USR','$ADM');
delete from auth.users where id in ('$USR','$ADM');
delete from organizations where id='$ORG';
SQL
}
trap teardown EXIT

q() { psql "$DB_URL" -Atc "$1" 2>/dev/null || true; }
wait_app() { local app="$1" i=0 n; until [ "$i" -gt 400 ]; do n="$(q "select count(*) from pg_stat_activity where application_name='$app' and datname='postgres';")"; [ "$n" = "1" ] && return 0; sleep 0.05; i=$((i+1)); done; echo "[dl-probe] TIMEOUT: $app never registered." >&2; return 1; }
wait_blocked() { local app="$1" i=0 we; until [ "$i" -gt 400 ]; do we="$(q "select wait_event_type from pg_stat_activity where application_name='$app' and datname='postgres' limit 1;")"; [ "$we" = "Lock" ] && return 0; sleep 0.05; i=$((i+1)); done; echo "[dl-probe] TIMEOUT: $app never blocked." >&2; return 1; }
wait_gone() { local app="$1" i=0 n; until [ "$i" -gt 200 ]; do n="$(q "select count(*) from pg_stat_activity where application_name='$app' and datname='postgres';")"; [ "$n" = "0" ] && return 0; sleep 0.1; i=$((i+1)); done; return 1; }

parent_lock_sql() { if [ "$1" = "user" ]; then echo "SELECT 1 FROM profiles WHERE id='$USR' FOR UPDATE;"; else echo "SELECT 1 FROM org_features WHERE org_id='$ORG' AND feature_key='m365_integration' FOR UPDATE;"; fi; }
cascade_sql()    { if [ "$1" = "user" ]; then echo "DELETE FROM ms_graph_connections WHERE user_id='$USR';"; else echo "DELETE FROM ms_graph_connections WHERE org_id='$ORG';"; fi; }

WORK="$(mktemp -d)"; FA="$WORK/a.sql"; FB="$WORK/b.sql"; LA="$WORK/a.log"; LB="$WORK/b.log"
mkfifo "$FA" "$FB"; APID=""; BPID=""

start_b() {  # $1=target — B holds the parent lock, then cascades after A is blocked
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q < "$FB" > "$LB" 2>&1 & BPID=$!
  exec 4> "$FB"
  printf 'set application_name=%s;\n' "'m365-DL-B'" >&4
  printf 'BEGIN;\n%s\n' "$(parent_lock_sql "$1")" >&4
}
start_a() {  # $1=mode(legacy|fixed) — the connection mutation
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q < "$FA" > "$LA" 2>&1 & APID=$!
  exec 3> "$FA"
  printf 'set application_name=%s;\n' "'m365-DL-A'" >&3
  if [ "$1" = "legacy" ]; then
    printf "UPDATE ms_graph_connections SET updated_at=now() WHERE id='%s';\n" "$CONN" >&3
  else
    printf "SELECT public.m365_refresh_connection('%s','%s','%s','\\x11'::bytea,'\\x12'::bytea,now(),now());\n" "$ORG" "$USR" "$CONN" >&3
  fi
  printf '\\q\n' >&3   # explicit psql quit — robust session termination (FIFO EOF alone is unreliable here)
}

# run_one <target> <mode>  → sets RUN_OK
run_one() {
  local target="$1" mode="$2"
  echo "[dl-probe] ── target=$target mode=$mode ──"
  seed_fixture; : > "$LA"; : > "$LB"
  start_b "$target"; wait_app m365-DL-B || { exec 4>&-; RUN_OK=0; return; }
  echo "[dl-probe] B holds the $target parent lock (FOR UPDATE), transaction open."

  start_a "$mode"; wait_app m365-DL-A || { exec 4>&-; exec 3>&-; RUN_OK=0; return; }
  wait_blocked m365-DL-A || { exec 4>&-; exec 3>&-; RUN_OK=0; return; }   # A reached the contended parent lock
  echo "[dl-probe] A ($mode) is blocked on B's parent lock — readiness signalled."

  printf '%s\nCOMMIT;\n\\q\n' "$(cascade_sql "$target")" >&4   # B cascades + commits + quits
  exec 4>&-; wait "$BPID" 2>/dev/null; local b_rc=$?
  exec 3>&-   # close A's FIFO write end → A sees EOF once its statement finishes (fixed) / has already errored out (legacy)
  wait_gone m365-DL-A; wait "$APID" 2>/dev/null; local a_rc=$?
  local count; count="$(q "select count(*) from ms_graph_connections where org_id='$ORG' and user_id='$USR';")"
  echo "[dl-probe] $target/$mode: A exit=$a_rc  B exit=$b_rc  surviving=$count"
  sed 's/^/    A|/' "$LA" 2>/dev/null | tail -3

  if [ "$mode" = "legacy" ]; then
    if grep -aq 'deadlock detected' "$LA" 2>/dev/null && [ "$b_rc" -eq 0 ]; then
      echo "[dl-probe] PASS $target/legacy: deadlock REPRODUCED for the child→parent order (BEFORE)."; RUN_OK=1
    else
      echo "[dl-probe] FAIL $target/legacy: expected a deadlock in A (exit $a_rc)." >&2; RUN_OK=0
    fi
  else
    if ! grep -aq 'deadlock detected' "$LA" "$LB" 2>/dev/null && [ "$a_rc" -eq 0 ] && [ "$b_rc" -eq 0 ] && [ "$count" = "0" ]; then
      echo "[dl-probe] PASS $target/fixed: NO deadlock — the RPC's parent-first order resolved it (AFTER)."; RUN_OK=1
    else
      echo "[dl-probe] FAIL $target/fixed: a deadlock occurred or the end state was wrong." >&2; RUN_OK=0
    fi
  fi
}

overall=0
for target in user feature; do
  RUN_OK=1; run_one "$target" legacy; [ "$RUN_OK" = "1" ] || overall=1
  RUN_OK=1; run_one "$target" fixed;  [ "$RUN_OK" = "1" ] || overall=1
done

if [ "$overall" -eq 0 ]; then
  echo "[dl-probe] PASS: legacy DEADLOCKED (reproduced) and fixed RESOLVED (no deadlock) for BOTH targets."; exit 0
fi
echo "[dl-probe] FAIL: at least one direction/target did not hold — see above." >&2; exit 1
