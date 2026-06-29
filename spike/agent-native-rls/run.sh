#!/usr/bin/env bash
set -euo pipefail

# (a) Operate from the script's own directory.
cd "$(dirname "$0")"

# (b) Banner.
echo "================================================================"
echo " THROWAWAY SPIKE — ADR-0036 §9: Drizzle .rls() honors Supabase RLS"
echo " This proves: #1 RLS parity, #2 pull is read-only introspection."
echo "================================================================"

# (c) Ensure local Supabase is up. supabase CLI must run from the repo root
# (../.. relative to spike/agent-native-rls). Start it only if status fails.
echo
echo "==> [1/6] Ensuring local Supabase is up"
if ! (cd ../.. && npx supabase status >/dev/null 2>&1); then
  echo "    Supabase not running — starting it (repo root)."
  (cd ../.. && npx supabase start)
else
  echo "    Supabase already running."
fi

# Capture the local Postgres URL from `supabase status -o env`.
export SPIKE_DB_URL="$(cd ../.. && npx supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
if [ -z "${SPIKE_DB_URL:-}" ]; then
  echo "ERROR: could not resolve DB_URL from 'supabase status -o env'." >&2
  exit 1
fi
echo "    SPIKE_DB_URL resolved."

# (d) Apply migrations + seed to the LOCAL dev DB.
echo
echo "==> [2/6] Applying migrations + seed to the LOCAL dev DB"
echo "    NOTE: this resets the LOCAL dev DB only — NEVER prod (see CLAUDE.md prod rules)."
(cd ../.. && npx supabase db reset)

# (e) Install spike deps.
echo
echo "==> [3/6] Installing spike dependencies (npm install)"
npm install

# (f) Claim #1 — RLS parity harness (sibling agent's file).
echo
echo "==> [4/6] Claim #1 — RLS parity (node rls-parity.mjs)"
CLAIM1_RC=0
node rls-parity.mjs || CLAIM1_RC=$?

# (g) Claim #2 — read-only introspection.
echo
echo "==> [5/6] Claim #2 — drizzle-kit pull read-only introspection (pull-check.sh)"
CLAIM2_RC=0
bash pull-check.sh || CLAIM2_RC=$?

# (h) Final gate summary.
echo
echo "==> [6/6] GATE SUMMARY"
echo "----------------------------------------------------------------"
if [ "$CLAIM1_RC" -eq 0 ]; then
  echo "  Claim #1 (RLS parity):                 PASS"
else
  echo "  Claim #1 (RLS parity):                 FAIL (rc=$CLAIM1_RC)"
fi
if [ "$CLAIM2_RC" -eq 0 ]; then
  echo "  Claim #2 (read-only introspection):    PASS"
else
  echo "  Claim #2 (read-only introspection):    FAIL (rc=$CLAIM2_RC)"
fi
echo "  Claim #3 (SSO no-second-login):        MANUAL — see README.md"
echo "----------------------------------------------------------------"

if [ "$CLAIM1_RC" -ne 0 ] || [ "$CLAIM2_RC" -ne 0 ]; then
  echo "RESULT: one or more automated claims FAILED."
  exit 1
fi
echo "RESULT: both automated claims PASSED."
