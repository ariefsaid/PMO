#!/usr/bin/env bash
#
# m365-race-probe.sh — PROVE the C1-RACE write-guard TOCTOU is CLOSED (Luna re-verify round 2), in
# BOTH interleavings: callback-FIRST and lifecycle-FIRST.
#
# pgTAP runs in a SINGLE transaction and cannot express a two-session race, so this drives the real
# concurrent interleaving against the LIVE local DB with two psql sessions. HONESTY NOTE (Luna
# round-3 LOW-f): the probe drives DIRECT SQL (a raw INSERT that fires the write-guard trigger), NOT
# the real OAuth-callback RPC / JWT-auth path — the guard is the AUTHORITY either way (it fires for
# every role and on every INSERT/UPDATE, including the 0105 lock-order RPCs), so a direct INSERT
# faithfully exercises its serialization. The real RPC + auth paths are covered by the pgTAP suite
# (0149/0150/0151). The lock-ORDER / DEADLOCK regression lives in scripts/m365-deadlock-probe.sh.
#
# SYNCHRONIZATION (Luna round-3 LOW-b): readiness is signalled via pg_stat_activity on per-session
# application_name tags — NOT a fixed `sleep`, and NOT psql stdout markers (psql block-buffers
# stdout to a file, so mid-stream markers are unreliable). Each session SETs a unique
# application_name as its first statement; the probe polls the backend's state/wait_event to decide
# it has reached the contended point before driving the next step.
#
# ── callback-FIRST (A=callback, B=lifecycle) ──────────────────────────────────────────────────
#   A: BEGIN; INSERT (write-guard takes PROFILES+ORG_FEATURES FOR UPDATE); A idle-in-transaction.
#   B: lifecycle UPDATE → BLOCKS on A's lock (wait_event='Lock').
#   A: COMMIT → releases → B's UPDATE completes (cascade deletes A's row); B COMMIT.
#   ASSERT: A exit 0; B exit 0; ZERO surviving connections.
#
# ── lifecycle-FIRST (B=lifecycle, A=callback) ─────────────────────────────────────────────────
#   B: BEGIN; lifecycle UPDATE → locks parent; B idle-in-transaction.
#   A: INSERT → guard's FOR UPDATE BLOCKS on B (wait_event='Lock').
#   B: COMMIT (parent disabled/false) → A's guard re-checks the COMMITTED state → raises 42501.
#   ASSERT: A REJECTED (exit≠0, 42501/user_not_active/org_not_entitled); B exit 0; ZERO surviving.
#
# B uses a DIRECT UPDATE rather than admin_set_user_status / operator_toggle_feature — LOCK-
# EQUIVALENT (each RPC's body is this UPDATE + the SAME AFTER trigger). pgTAP proves the real RPCs.
#
# Usage:
#   scripts/with-db-lock.sh scripts/m365-race-probe.sh [user|feature]   (preferred)
#   scripts/m365-race-probe.sh [user|feature]                           (self-wraps the lock)
# Exit 0 = race CLOSED in BOTH interleavings. Requires the local Supabase stack UP.

set -uo pipefail

TARGET="${1:-user}"
case "$TARGET" in
  user|feature) ;;
  *) echo "usage: $0 [user|feature]" >&2; exit 2 ;;
esac

# Cooperative self-wrap (with-db-lock.sh exports PMO_DB_LOCK_HELD=1 into the child env, so a
# documented invocation like `with-db-lock.sh scripts/m365-race-probe.sh` does NOT re-lock recursively).
if [ -z "${PMO_DB_LOCK_HELD:-}" ]; then
  export PMO_DB_LOCK_HELD=1
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  exec "$ROOT/scripts/with-db-lock.sh" "$ROOT/scripts/m365-race-probe.sh" "$TARGET"
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
echo "[probe] DB_URL=${DB_URL}  target=${TARGET}"

ORG="a15000ff-0000-0000-0000-000000000001"
USR="a15000ff-0000-0000-0000-0000000000a1"
ADM="a15000ff-0000-0000-0000-0000000000aa"
TENANT="11111111-2222-3333-4444-555555555555"

seed() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations (id, name) values ('$ORG','M365 Race Probe Org') on conflict (id) do nothing;
insert into auth.users (id, email) values ('$USR','m365-race-user@example.com'),('$ADM','m365-race-admin@example.com') on conflict (id) do nothing;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('$USR','$ORG','Race User','m365-race-user@example.com','Engineer','active'),
  ('$ADM','$ORG','Race Admin','m365-race-admin@example.com','Admin','active')
  on conflict (id) do update set org_id = excluded.org_id, status = 'active', role = excluded.role;
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('$ORG','m365_integration',true,null) on conflict (org_id, feature_key) do update set enabled = true;
delete from ms_graph_connections where org_id = '$ORG';
SQL
}
reset_target_active() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
update profiles set status = 'active' where id = '$USR';
update org_features set enabled = true where org_id = '$ORG' and feature_key = 'm365_integration';
delete from ms_graph_connections where org_id = '$ORG';
SQL
}
teardown() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
delete from ms_graph_connections where org_id = '$ORG';
delete from org_features where org_id = '$ORG' and feature_key = 'm365_integration';
delete from profiles where org_id = '$ORG' and id in ('$USR','$ADM');
delete from auth.users where id in ('$USR','$ADM');
delete from organizations where id = '$ORG';
SQL
}
trap teardown EXIT
echo "[probe] seeding fixture…"
seed

# ── pg_stat_activity readiness helpers (application_name-tagged; no psql-stdout parsing). ───────
q() { psql "$DB_URL" -Atc "$1" 2>/dev/null || true; }
wait_app() {  # $1=app → 0 once the backend registers
  local app="$1" i=0 n
  until [ "$i" -gt 400 ]; do
    n="$(q "select count(*) from pg_stat_activity where application_name='$app' and datname='postgres';")"
    [ "$n" = "1" ] && return 0; sleep 0.05; i=$((i + 1))
  done; echo "[probe] TIMEOUT: $app never registered." >&2; return 1
}
wait_state() {  # $1=app $2=state → 0 once pg_stat_activity.state matches
  local app="$1" want="$2" i=0 st=""
  until [ "$i" -gt 400 ]; do
    st="$(q "select state from pg_stat_activity where application_name='$app' and datname='postgres' limit 1;")"
    [ "$st" = "$want" ] && return 0; sleep 0.05; i=$((i + 1))
  done; echo "[probe] TIMEOUT: $app never reached state='$want' (last='$st')." >&2; return 1
}
wait_blocked() {  # $1=app → 0 once wait_event_type='Lock'
  local app="$1" i=0 we
  until [ "$i" -gt 400 ]; do
    we="$(q "select wait_event_type from pg_stat_activity where application_name='$app' and datname='postgres' limit 1;")"
    [ "$we" = "Lock" ] && return 0; sleep 0.05; i=$((i + 1))
  done; echo "[probe] TIMEOUT: $app never blocked on a lock." >&2; return 1
}

lifecycle_sql() {
  if [ "$TARGET" = "user" ]; then echo "UPDATE profiles SET status='disabled' WHERE id='$USR';"
  else echo "UPDATE org_features SET enabled=false WHERE org_id='$ORG' AND feature_key='m365_integration';"; fi
}
INSERT_SQL="INSERT INTO ms_graph_connections (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status) VALUES ('$ORG','$USR','$TENANT', ARRAY['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active');"
final_count() { q "SELECT count(*) FROM ms_graph_connections WHERE org_id='$ORG' AND user_id='$USR';"; }

WORK="$(mktemp -d)"; FA="$WORK/a.sql"; FB="$WORK/b.sql"; LA="$WORK/a.log"; LB="$WORK/b.log"
mkfifo "$FA" "$FB"
APID=""; BPID=""

# start_sess <app> <fifo> <log>  — opens the FIFO write end + launches psql (reader) + sets app_name.
start_sess() {
  local app="$1" fifo="$2" log="$3"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q < "$fifo" > "$log" 2>&1 &
  case "$app" in
    m365-A) exec 3> "$fifo"; APID=$!; send m365-A "set application_name='m365-A';" ;;
    m365-B) exec 4> "$fifo"; BPID=$!; send m365-B "set application_name='m365-B';" ;;
  esac
}
send() { case "$1" in m365-A) printf '%s\n' "$2" >&3;; m365-B) printf '%s\n' "$2" >&4;; esac; }

run_callback_first() {
  echo "[probe] ── callback-first ($TARGET) ──"
  reset_target_active; : > "$LA"; : > "$LB"
  start_sess m365-A "$FA" "$LA"; wait_app m365-A || { exec 3>&-; return 1; }
  send m365-A "BEGIN;"; send m365-A "$INSERT_SQL"
  wait_state m365-A "idle in transaction" || { exec 3>&-; return 1; }
  echo "[probe] A: connection inserted, transaction HELD (guard holds the parent locks)."

  start_sess m365-B "$FB" "$LB"; wait_app m365-B || { exec 3>&-; exec 4>&-; return 1; }
  send m365-B "$(lifecycle_sql)"
  wait_blocked m365-B || { exec 3>&-; exec 4>&-; return 1; }
  echo "[probe] B: lifecycle UPDATE blocked on A's held lock — serializing as designed."

  send m365-A "COMMIT;"; send m365-A "\q"; exec 3>&-; wait "$APID" 2>/dev/null; local a_rc=$?
  # B's lifecycle UPDATE is a single auto-commit statement: it was blocked on A's lock; once A
  # committed it finishes (the AFTER-trigger cascade deletes A's row) and auto-commits. Send \q
  # so B exits after the UPDATE completes.
  send m365-B "\q"; exec 4>&-; wait "$BPID" 2>/dev/null; local b_rc=$?
  local count; count="$(final_count)"
  echo "[probe] callback-first: A exit=$a_rc  B exit=$b_rc  surviving=$count"
  if [ "$a_rc" -eq 0 ] && [ "$b_rc" -eq 0 ] && [ "$count" = "0" ]; then
    echo "[probe] PASS callback-first ($TARGET)."; return 0
  fi
  echo "[probe] FAIL callback-first ($TARGET)." >&2; sed 's/^/    A|/' "$LA"|tail -3; sed 's/^/    B|/' "$LB"|tail -3; return 1
}

run_lifecycle_first() {
  echo "[probe] ── lifecycle-first ($TARGET) ──"
  reset_target_active; : > "$LA"; : > "$LB"
  start_sess m365-B "$FB" "$LB"; wait_app m365-B || { exec 4>&-; return 1; }
  send m365-B "BEGIN;"; send m365-B "$(lifecycle_sql)"
  wait_state m365-B "idle in transaction" || { exec 4>&-; return 1; }
  echo "[probe] B: lifecycle UPDATE done (parent disabled/false), transaction HELD open."

  start_sess m365-A "$FA" "$LA"; wait_app m365-A || { exec 4>&-; exec 3>&-; return 1; }
  send m365-A "$INSERT_SQL"
  wait_blocked m365-A || { exec 4>&-; exec 3>&-; return 1; }
  echo "[probe] A: callback INSERT blocked on B's held parent lock — serializing as designed."

  send m365-B "COMMIT;"; send m365-B "\q"; exec 4>&-; wait "$BPID" 2>/dev/null; local b_rc=$?
  exec 3>&-; wait "$APID" 2>/dev/null; local a_rc=$?   # A was rejected (42501) → exited on the error
  local count; count="$(final_count)"
  echo "[probe] lifecycle-first: A exit=$a_rc (expect ≠0)  B exit=$b_rc (expect 0)  surviving=$count"
  sed 's/^/    A|/' "$LA"|tail -4
  if [ "$a_rc" -ne 0 ] && [ "$b_rc" -eq 0 ] && [ "$count" = "0" ] && grep -aqi 'user_not_active\|org_not_entitled\|42501' "$LA" 2>/dev/null; then
    echo "[probe] PASS lifecycle-first ($TARGET): the late callback was REJECTED."; return 0
  fi
  echo "[probe] FAIL lifecycle-first ($TARGET)." >&2; return 1
}

overall=0
run_callback_first  || overall=1
run_lifecycle_first || overall=1
if [ "$overall" -eq 0 ]; then
  echo "[probe] PASS ($TARGET): C1-RACE write-guard TOCTOU is CLOSED in BOTH interleavings."; exit 0
fi
echo "[probe] FAIL ($TARGET): at least one interleaving did not hold — see above." >&2; exit 1
