#!/usr/bin/env bash
# Migration 0575 (#1462) rollback proof. Run under the DB lock after a reset:
#   scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-budget-archive-legacy-rollback.sh'
#
# The migration's down file REFUSES while any legacy archive decision exists (dropping the kind would
# destroy audit and permit an unsafe replay), and round-trips exactly when only account decisions exist.
# The REAL migration files are exercised (not a copy), because a refusal cannot be asserted from inside
# a pgTAP transaction — the failing DDL would abort the test that is asserting it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
up="supabase/migrations/0575_budget_legacy_archive_cancel.sql"
down="supabase/migrations/rollback/0575_budget_legacy_archive_cancel_down.sql"
org="0575ba00-0000-0000-0000-000000000001"
db_container="${PMO_DB_CONTAINER:-supabase_db_pmo-portal}"

# Local psql if it exists, otherwise the one inside the local Supabase database container (the CLI
# provisions that container for `supabase db reset`, and CI never runs this script).
if command -v psql >/dev/null 2>&1; then
  db_url="${PMO_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
  client=(psql "$db_url" -v ON_ERROR_STOP=1 -q)
else
  client=(docker exec -i "$db_container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
fi
# Every fixture, rollback, and trap cleanup statement gets a finite lock and statement bound.
# The deliberately blocked-writer assertions use a separate 500ms timeout in the main pgTAP file.
client_run() { PGOPTIONS='-c statement_timeout=20s -c lock_timeout=5s' "${client[@]}" "$@"; }
sql() { client_run -tAc "$1"; }
file() { client_run -f - < "$1"; }

fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  sql "delete from public.notifications where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.budget_archive_cancel_intents where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.budget_archive_requests where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.budget_version_account_erp_mirror where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.budget_version_erp_mirror where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.budget_versions where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.projects where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.profiles where org_id='$org';" >/dev/null 2>&1 || true
  sql "delete from public.organizations where id='$org';" >/dev/null 2>&1 || true
  sql "delete from auth.users where id='0575ba00-0000-0000-0000-0000000000a1';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

client_run <<SQL
insert into auth.users (id, email) values ('0575ba00-0000-0000-0000-0000000000a1', 'rollback-archive@example.invalid');
insert into public.organizations (id, name) values ('$org', 'Rollback archive org');
insert into public.profiles (id, org_id, full_name, email, role, status)
values ('0575ba00-0000-0000-0000-0000000000a1', '$org', 'Rollback Finance', 'rollback-archive@example.invalid', 'Finance', 'active');
insert into public.projects (id, org_id, name, status)
values ('0575ba00-0000-0000-0000-0000000000c1', '$org', 'Rollback project', 'Ongoing Project');
insert into public.budget_versions (id, org_id, project_id, version, name, status, activated_at)
values ('0575ba00-0000-0000-0000-0000000000d1', '$org', '0575ba00-0000-0000-0000-0000000000c1', 1, 'Rollback version', 'Archived', '2026-10-28T00:00:00Z');
insert into public.budget_archive_requests (id, org_id, project_id, budget_version_id, requested_by, cancel_erp)
values ('0575ba00-0000-0000-0000-0000000000e1', '$org', '0575ba00-0000-0000-0000-0000000000c1', '0575ba00-0000-0000-0000-0000000000d1', '0575ba00-0000-0000-0000-0000000000a1', true);
insert into public.budget_version_erp_mirror (id, org_id, budget_version_id, fiscal_year, push_state, erp_budget_name)
values ('0575ba00-0000-0000-0000-0000000000f1', '$org', '0575ba00-0000-0000-0000-0000000000d1', '2026', 'pushed', 'BUD-ROLLBACK');
insert into public.budget_version_account_erp_mirror
  (id, org_id, budget_version_id, fiscal_year, erp_account, budget_intent, push_state, erp_budget_name, erp_docstatus)
values ('0575ba00-0000-0000-0000-0000000000f2', '$org', '0575ba00-0000-0000-0000-0000000000d1', '2026', '5100 - Labor - RB', 'ensure', 'pushed', 'BUD-ACCOUNT-ROLLBACK', 1);
insert into public.budget_archive_cancel_intents
  (id, org_id, request_id, project_id, budget_version_id, source_kind, source_mirror_id, actor_user_id,
   fiscal_year, erp_account, erp_budget_name, activated_at_witness, state)
values ('0575ba00-0000-0000-0000-0000000000a2', '$org', '0575ba00-0000-0000-0000-0000000000e1',
        '0575ba00-0000-0000-0000-0000000000c1', '0575ba00-0000-0000-0000-0000000000d1', 'legacy',
        '0575ba00-0000-0000-0000-0000000000f1', '0575ba00-0000-0000-0000-0000000000a1',
        '2026', null, 'BUD-ROLLBACK', '2026-10-28T00:00:00Z', 'complete');
insert into public.budget_archive_cancel_intents
  (id, org_id, request_id, project_id, budget_version_id, source_kind, source_mirror_id, actor_user_id,
   fiscal_year, erp_account, erp_budget_name, activated_at_witness)
values ('0575ba00-0000-0000-0000-0000000000a3', '$org', '0575ba00-0000-0000-0000-0000000000e1',
        '0575ba00-0000-0000-0000-0000000000c1', '0575ba00-0000-0000-0000-0000000000d1', 'account',
        '0575ba00-0000-0000-0000-0000000000f2', '0575ba00-0000-0000-0000-0000000000a1',
        '2026', '5100 - Labor - RB', 'BUD-ACCOUNT-ROLLBACK', '2026-10-28T00:00:00Z');
SQL

if out=$(file "$down" 2>&1); then
  fail "the rollback must refuse while a legacy archive decision exists"
fi
case "$out" in
  *"legacy budget archive cancellations prevent rollback"*) ;;
  *) fail "refused for an unexpected reason: $out" ;;
esac

sql "delete from public.budget_archive_cancel_intents where id='0575ba00-0000-0000-0000-0000000000a2';" >/dev/null
file "$down"

remaining=$(sql "select count(*) from information_schema.columns
  where table_schema='public' and table_name='budget_archive_cancel_intents' and column_name='source_kind'")
[ "$remaining" = "0" ] || fail "rollback did not drop source_kind"

# Simulate an archive that predates this migration. Reapplication must create an actionable warning,
# never a cancellation job, and preserve the account-only intent already in the audit table.
"${client[@]}" <<SQL
insert into public.budget_versions (id, org_id, project_id, version, name, status, activated_at)
values ('0575ba00-0000-0000-0000-0000000000d2', '$org', '0575ba00-0000-0000-0000-0000000000c1', 2, 'Historical archived version', 'Archived', '2026-10-29T00:00:00Z');
insert into public.budget_version_erp_mirror (id, org_id, budget_version_id, fiscal_year, push_state, erp_budget_name)
values ('0575ba00-0000-0000-0000-0000000000f3', '$org', '0575ba00-0000-0000-0000-0000000000d2', '2026', 'failed', 'BUD-HISTORICAL');
SQL

file "$up"
restored=$(sql "select count(*) from information_schema.columns
  where table_schema='public' and table_name='budget_archive_cancel_intents' and column_name='source_kind'")
[ "$restored" = "1" ] || fail "re-applying the migration did not restore source_kind"

account_row=$(sql "select source_kind || ':' || erp_account from public.budget_archive_cancel_intents where id='0575ba00-0000-0000-0000-0000000000a3'")
[ "$account_row" = "account:5100 - Labor - RB" ] || fail "account-only archive intent did not survive rollback/re-apply: $account_row"
historical_notice=$(sql "select count(*) from public.notifications where org_id='$org' and owner_id='0575ba00-0000-0000-0000-0000000000a1' and metadata @> '{\"action_required\":\"budget-archive-legacy-live-erp\",\"versionId\":\"0575ba00-0000-0000-0000-0000000000d2\",\"targetCount\":1}'::jsonb")
[ "$historical_notice" = "1" ] || fail "reapplying migration did not surface the pre-existing archived legacy target"
historical_jobs=$(sql "select count(*) from public.budget_archive_cancel_intents where budget_version_id='0575ba00-0000-0000-0000-0000000000d2'")
[ "$historical_jobs" = "0" ] || fail "historical backfill invented a cancellation decision"

echo "OK: 0575 rollback refuses legacy history, preserves account-only history, and reapplication warns without queuing cancellation"
