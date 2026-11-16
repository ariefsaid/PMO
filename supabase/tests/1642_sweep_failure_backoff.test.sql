-- 1642_sweep_failure_backoff.test.sql — AC-ENA-CAD-010: the failure count behind the sweep's retry backoff.
-- A deferral with a delay is a failure and counts; a zero-delay deferral (truncation) does not; a completed
-- run resets the count in the same statement as its stamp; the lock fence and grants are unchanged.
begin;
select plan(11);

insert into organizations (id, name) values ('16420000-0000-0000-0000-000000000001','1642 Org'), ('16420000-0000-0000-0000-000000000002','1642 Org B');
insert into erp_sweep_lock (org_id, holder, locked_until)
  values ('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111', now() + interval '5 minutes'),
         ('16420000-0000-0000-0000-000000000002','11111111-1111-4111-8111-111111111111', now() + interval '5 minutes');

select has_column('public', 'erp_sweep_full_run', 'consecutive_failures', 'AC-ENA-CAD-010 the marker carries a failure count');

select ok(not public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000001','22222222-2222-4222-8222-222222222222',300)
  and not exists (select 1 from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001'),
  'AC-ENA-CAD-010 a non-holder cannot defer and leaves no count');

select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',300);
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001'), 1,
  'AC-ENA-CAD-010 the first failed-run deferral counts one');

select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',600);
select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',1200);
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001'), 3,
  'AC-ENA-CAD-010 consecutive failed-run deferrals accumulate');

select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111',0);
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001'), 3,
  'AC-ENA-CAD-010 a zero-delay deferral (truncation) neither counts nor resets');

select ok(not public.mark_erp_full_sweep_done('16420000-0000-0000-0000-000000000001','22222222-2222-4222-8222-222222222222')
  and (select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001') = 3,
  'AC-ENA-CAD-010 a non-holder cannot reset the count');

select ok(public.mark_erp_full_sweep_done('16420000-0000-0000-0000-000000000001','11111111-1111-4111-8111-111111111111'),
  'AC-ENA-CAD-010 the lock holder stamps the run complete');
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000001'), 0,
  'AC-ENA-CAD-010 the completion stamp resets the failure count in the same statement');

-- A first-ever zero-delay deferral (truncation) inserts a marker with count 0.
select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000002','11111111-1111-4111-8111-111111111111',0);
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000002'), 0,
  'AC-ENA-CAD-010 a first-ever zero-delay deferral inserts count 0');

-- The count is clamped at 1000 so it can never overflow the int column.
update erp_sweep_full_run set consecutive_failures = 999 where org_id='16420000-0000-0000-0000-000000000002';
select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000002','11111111-1111-4111-8111-111111111111',300);
select public.defer_erp_full_sweep('16420000-0000-0000-0000-000000000002','11111111-1111-4111-8111-111111111111',300);
select is((select consecutive_failures from erp_sweep_full_run where org_id='16420000-0000-0000-0000-000000000002'), 1000,
  'AC-ENA-CAD-010 the failure count is clamped at 1000');

select ok(not has_function_privilege('authenticated', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_erp_full_sweep_done(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_erp_full_sweep_done(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.defer_erp_full_sweep(uuid, uuid, int)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mark_erp_full_sweep_done(uuid, uuid)', 'EXECUTE'),
  'AC-ENA-CAD-010 grants unchanged: service role only, both functions');

select * from finish();
rollback;
