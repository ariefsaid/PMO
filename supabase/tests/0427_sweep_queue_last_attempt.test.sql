-- 0427_sweep_queue_last_attempt.test.sql — the sweep's recovery queues carry a durable last-attempt stamp
-- and a partial index that serves "never attempted first, then longest-waiting" (THEME-BACK-06).
begin;
select plan(15);

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

-- BACK-07: a deferred full run falls due after the delay; only the lock holder can defer; service role only.
insert into organizations (id, name) values ('04270000-0000-0000-0000-000000000001','0427 Org');
insert into erp_sweep_lock (org_id, holder, locked_until)
  values ('04270000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111', now() + interval '5 minutes');
select ok(not public.defer_erp_full_sweep('04270000-0000-0000-0000-000000000001','22222222-2222-4222-8222-222222222222',0),
  'AC-SWQ-006 a non-holder cannot defer the full run');
select ok(public.defer_erp_full_sweep('04270000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',0),
  'AC-SWQ-006 the holder can defer the full run');
select ok((select now() - completed_at >= interval '55 minutes' from erp_sweep_full_run where org_id='04270000-0000-0000-0000-000000000001'),
  'AC-SWQ-006 delay 0 leaves the org due on the next tick');
select public.defer_erp_full_sweep('04270000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',300);
select ok((select now() - completed_at < interval '55 minutes' and now() - completed_at > interval '49 minutes'
         from erp_sweep_full_run where org_id='04270000-0000-0000-0000-000000000001'),
  'AC-SWQ-006 a retry delay holds the org back for that long');
select ok(not has_function_privilege('authenticated', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE'),
  'AC-SWQ-007 end users cannot call defer_erp_full_sweep');
select ok(has_function_privilege('service_role', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE'),
  'AC-SWQ-007 service_role can call defer_erp_full_sweep');

select * from finish();
rollback;
