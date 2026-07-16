#!/usr/bin/env bash
#
# m365-race-probe.sh — PROVE the C1-RACE write-guard TOCTOU is closed (callback-first interleaving).
#
# pgTAP runs in a SINGLE transaction and cannot express a two-session race, so this is the real
# concurrent proof against the LIVE local DB. It drives Luna's exact callback/lifecycle interleaving
# with TWO concurrent psql sessions:
#
#   Session A (the OAuth callback, service-role):  BEGIN; INSERT a connection through the
#                                                  m365_connection_write_guard; HOLD.
#   Session B (the lifecycle writer):              disable the user (UPDATE profiles status='disabled')
#                                                  — or toggle the feature off (UPDATE org_features
#                                                  enabled=false).
#   Session A:                                     COMMIT.
#   ASSERT:                                        ZERO surviving connections for the target.
#
# Expected end-state:
#   • OLD (unlocked) guard — A's INSERT takes no row lock. B's lifecycle UPDATE runs immediately
#     (no conflict); its AFTER-trigger cascade deletes only rows visible to B's MVCC snapshot, so it
#     CANNOT see A's uncommitted connection. B commits, then A commits → A's live encrypted refresh
#     token SURVIVES for a disabled user / disentitled org (NFR-M365-107 violated). count = 1. FAIL.
#   • NEW (FOR UPDATE) guard — A's INSERT locks the profiles row (and the org_features entitlement
#     row) FOR UPDATE. B's lifecycle UPDATE BLOCKS on that lock until A commits; once A commits, B's
#     UPDATE proceeds and its AFTER-trigger cascade now SEES A's committed connection and deletes it.
#     count = 0. PASS. (Lifecycle-first is safe under BOTH guards, so only callback-first is probed.)
#
# B uses a DIRECT UPDATE rather than the admin_set_user_status / operator_toggle_feature RPCs. That is
# LOCK-EQUIVALENT: each RPC's body is, internally, exactly this UPDATE on profiles / org_features
# (the only statement that takes the contended row lock), and the SAME AFTER trigger fires. The RPC
# auth guards (is_active_member / Operator) are irrelevant to the lock contention, so the direct
# UPDATE is the minimal, faithful repro. (The pgTAP suite already proves the real RPC paths.)
#
# Usage:
#   scripts/with-db-lock.sh scripts/m365-race-probe.sh [user|feature]   (preferred — wraps the lock)
#   scripts/m365-race-probe.sh [user|feature]                           (self-wraps the lock)
#
# Exit 0 = race CLOSED (0 surviving connections). Exit 1 = race OPEN (≥1 surviving) or probe error.
# Requires the local Supabase stack UP. Self-contained: seeds + tears down its own fixture.

set -euo pipefail

MODE="${1:-user}"
case "$MODE" in
  user|feature) ;;
  *) echo "usage: $0 [user|feature]" >&2; exit 2 ;;
esac

# Self-wrap in the shared DB lock if not already held (docs: every DB-driving command goes through
# scripts/with-db-lock.sh — the local stack is ONE shared Docker DB).
if [ -z "${PMO_DB_LOCK_HELD:-}" ]; then
  export PMO_DB_LOCK_HELD=1
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  exec "$ROOT/scripts/with-db-lock.sh" "$ROOT/scripts/m365-race-probe.sh" "$MODE"
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# PATH defense: Homebrew's libpq (psql) is keg-only / not on PATH.
export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

# ── Resolve the local DB URL (prefer `supabase status`, fall back to the known local default). ──
resolve_db_url() {
  local url
  url="$(supabase status 2>&1 | grep -oE 'postgresql://[^[:space:]]+/postgres' | head -1 || true)"
  if [ -z "$url" ]; then
    # Local Docker default (supabase status sometimes omits the DB card).
    url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  fi
  printf '%s' "$url"
}
DB_URL="$(resolve_db_url)"
echo "[probe] DB_URL=${DB_URL}"

# ── Fixture (unique marker UUIDs; idempotent seed + teardown). ────────────────────────────────
# Org, an active Engineer (the OAuth-connecting user / offboard target), an active Admin (so the org
# is never left Admin-less), and an ENABLED m365_integration entitlement.
ORG="a15000ff-0000-0000-0000-000000000001"
USR="a15000ff-0000-0000-0000-0000000000a1"   # Engineer — the connect/offboard target
ADM="a15000ff-0000-0000-0000-0000000000aa"   # a second active member (unused by lockout; presence only)
TENANT="11111111-2222-3333-4444-555555555555"

seed() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into organizations (id, name) values ('$ORG','M365 Race Probe Org')
  on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('$USR','m365-race-user@example.com'),
  ('$ADM','m365-race-admin@example.com')
  on conflict (id) do nothing;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('$USR','$ORG','Race User','m365-race-user@example.com','Engineer','active'),
  ('$ADM','$ORG','Race Admin','m365-race-admin@example.com','Admin','active')
  on conflict (id) do update set org_id = excluded.org_id, status = excluded.status, role = excluded.role;
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('$ORG','m365_integration',true,null)
  on conflict (org_id, feature_key) do update set enabled = true;
-- clean slate for the probe (any leftover connection from a prior run).
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

echo "[probe] mode=$MODE  seeding fixture…"
seed

# ── Two concurrent sessions. A is driven statement-by-statement via a FIFO so it can HOLD its
#    transaction open (INSERT done, not yet committed) exactly while B runs the lifecycle. ──────
WORK="$(mktemp -d)"
FIFO_A="$WORK/a.sql"; LOG_A="$WORK/a.log"; LOG_B="$WORK/b.log"
mkfifo "$FIFO_A"

# Session A reads SQL from the FIFO; stdout → log so we can detect its 'A_READY' marker.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q < "$FIFO_A" > "$LOG_A" 2>&1 &
PID_A=$!
exec 3> "$FIFO_A"   # open the FIFO for writing (unblocks psql's open-for-read)

send_a() { printf '%s\n' "$1" >&3; }
wait_marker() {
  local marker="$1" log="$2" i=0
  until grep -q "$marker" "$log" 2>/dev/null; do
    sleep 0.1; i=$((i + 1))
    if [ "$i" -gt 300 ]; then echo "[probe] TIMEOUT waiting for marker '$marker' in $log" >&2; return 1; fi
  done
}

# A: BEGIN → INSERT the connection (the write-guard runs here; under the FIX it takes the row locks
#    and HOLDS them until COMMIT). Then emit A_READY and block on the next FIFO read (we send COMMIT
#    only after B has had its turn).
echo "[probe] session A: BEGIN + INSERT connection (through the write-guard)…"
send_a "BEGIN;"
send_a "INSERT INTO ms_graph_connections (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status) VALUES ('$ORG','$USR','$TENANT', ARRAY['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active');"
send_a "SELECT 'A_READY';"
wait_marker "A_READY" "$LOG_A"
echo "[probe] session A holding its transaction open (connection inserted, NOT committed)."

# B: the lifecycle writer. Runs in its OWN session/transaction. Under the FIX, its UPDATE blocks on
#    A's FOR UPDATE lock until A commits; under the OLD guard it runs immediately (the race).
echo "[probe] session B: lifecycle ($MODE) — concurrent with A's open transaction…"
if [ "$MODE" = "user" ]; then
  B_SQL="UPDATE profiles SET status='disabled' WHERE id='$USR';"
else
  B_SQL="UPDATE org_features SET enabled=false WHERE org_id='$ORG' AND feature_key='m365_integration';"
fi
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "$B_SQL" > "$LOG_B" 2>&1 &
PID_B=$!

# Give B a moment to either finish (old guard) or settle into its blocked wait (new guard), then
# release A. The exact sleep length is not load-bearing for correctness — only for letting B reach
# its (blocked or fast) UPDATE before A commits.
sleep 2

echo "[probe] session A: COMMIT (releases any row locks → unblocks B under the fix)…"
send_a "COMMIT;"
exec 3>&-            # close the FIFO → A's psql sees EOF → exits
wait "$PID_A" 2>/dev/null || true
wait "$PID_B" 2>/dev/null || true

# ── Assert the end state. ─────────────────────────────────────────────────────────────────────
COUNT="$(psql "$DB_URL" -Atc "SELECT count(*) FROM ms_graph_connections WHERE org_id='$ORG' AND user_id='$USR';")"
echo "[probe] A.log tail:"; tail -n 3 "$LOG_A" 2>/dev/null | sed 's/^/    /'
echo "[probe] B.log tail:"; tail -n 3 "$LOG_B" 2>/dev/null | sed 's/^/    /'
echo "[probe] surviving connections for ($MODE) target = $COUNT"

if [ "$COUNT" = "0" ]; then
  echo "[probe] PASS ($MODE): 0 surviving connections — the callback/lifecycle race is CLOSED."
  exit 0
else
  echo "[probe] FAIL ($MODE): $COUNT surviving connection(s) for a disabled/disentitled target — race is OPEN." >&2
  exit 1
fi
