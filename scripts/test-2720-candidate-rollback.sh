#!/usr/bin/env bash
# #2915: round trip of migration 2720. Run under scripts/with-db-lock.sh (it resets the local database twice).
#   A = catalog snapshot at the level before 2720, B = after 2720, C = after its down file, D = after the up again.
# Required: C equals A (functions, grants, policies, triggers, bucket) and D equals B. One transaction, rolled back.
set -euo pipefail
cd "$(dirname "$0")/.."
UP=supabase/migrations/2720_retire_candidate_work_order_functions.sql
DOWN=supabase/migrations/rollback/2720_retire_candidate_work_order_functions_down.sql
SNAP=scripts/candidate-retire-snapshot.sql
DB=${PMO_DB_CONTAINER:-supabase_db_pmo-portal}
psqlc() { docker exec -i "$DB" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

supabase db reset --version 2690 --yes >/dev/null 2>&1
psqlc -A -t < "$SNAP" > "$work/A"
supabase db reset --yes >/dev/null 2>&1
psqlc -A -t < "$SNAP" > "$work/B"
{
  echo 'begin;'; cat "$DOWN"; echo '\t on'; echo '\pset format unaligned'; echo "select 'MARK-C';"; cat "$SNAP"
  cat "$UP"; echo "select 'MARK-D';"; cat "$SNAP"; echo 'rollback;'
} | psqlc -A -t > "$work/out"
sed -n '/^MARK-C$/,/^MARK-D$/p' "$work/out" | sed '1d;$d' > "$work/C"
sed -n '/^MARK-D$/,$p' "$work/out" | sed '1d' > "$work/D"
test -s "$work/A" && test -s "$work/C"
echo "snapshot lines: before=$(wc -l < "$work/A") after-up=$(wc -l < "$work/B") after-down=$(wc -l < "$work/C") after-up-again=$(wc -l < "$work/D")"
if grep '^fn ' "$work/B" | grep -qv '^fn audit_work_order_candidate_row'; then echo "FAIL: functions remain after the up"; exit 1; fi
diff "$work/A" "$work/C" && echo "OK down restores the pre-2720 catalog exactly"
diff "$work/B" "$work/D" && echo "OK up applies again cleanly to the same catalog"
