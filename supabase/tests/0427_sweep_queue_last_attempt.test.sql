-- 0427_sweep_queue_last_attempt.test.sql — the sweep's recovery queues carry a durable last-attempt stamp
-- and a partial index that serves "never attempted first, then longest-waiting" (THEME-BACK-06).
begin;
select plan(9);

select has_column('public', 'budget_version_erp_mirror', 'last_attempt_at', 'AC-SWQ-001 legacy budget mirror carries the stamp');
select has_column('public', 'budget_version_account_erp_mirror', 'last_attempt_at', 'AC-SWQ-001 account budget mirror carries the stamp');
select has_column('public', 'timesheet_erp_mirror', 'last_attempt_at', 'AC-SWQ-001 timesheet mirror carries the stamp');
select has_column('public', 'budget_archive_cancel_intents', 'last_attempt_at', 'AC-SWQ-001 archive intents carry the stamp');

select col_is_null('public', 'timesheet_erp_mirror', 'last_attempt_at', 'AC-SWQ-002 the stamp is nullable: NULL means never attempted (sorts first)');

select ok(
  (select count(*) = 4 from pg_indexes
    where schemaname = 'public'
      and indexname in ('budget_version_erp_mirror_attempt_idx', 'budget_version_account_erp_mirror_attempt_idx',
                        'timesheet_erp_mirror_attempt_idx', 'budget_archive_cancel_attempt_idx')),
  'AC-SWQ-003 each queue has its ordered partial index');

-- The sweep stamps through the service role: it can update the column, an end user cannot reach it through RLS.
select ok(has_column_privilege('service_role', 'public.timesheet_erp_mirror', 'last_attempt_at', 'UPDATE'),
  'AC-SWQ-004 service_role can stamp timesheet_erp_mirror.last_attempt_at');
select ok(has_column_privilege('service_role', 'public.budget_archive_cancel_intents', 'last_attempt_at', 'UPDATE'),
  'AC-SWQ-004 service_role can stamp budget_archive_cancel_intents.last_attempt_at');
select ok(not has_table_privilege('authenticated', 'public.budget_archive_cancel_intents', 'UPDATE'),
  'AC-SWQ-005 an authenticated user still has no write path to the archive intents');

select * from finish();
rollback;
