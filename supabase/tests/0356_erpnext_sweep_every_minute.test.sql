-- 0356_erpnext_sweep_every_minute.test.sql
-- AC-ENA-CAD-001 [pgTAP]: the ERPNext sweep tick fires every minute through the same guarded helper,
-- and the per-org sweep lock that keeps overlapping ticks apart still admits exactly one holder.
begin;
select plan(7);

select is((select schedule from cron.job where jobname = 'erpnext-sweep-tick'), '* * * * *',
  'AC-ENA-CAD-001 the erpnext-sweep tick is scheduled every minute');
select is((select command from cron.job where jobname = 'erpnext-sweep-tick'), 'select public.erpnext_sweep_tick()',
  'AC-ENA-CAD-001 the tick still runs the vault-guarded helper');
select ok((select active from cron.job where jobname = 'erpnext-sweep-tick'),
  'AC-ENA-CAD-001 the tick is active');
select is((select count(*)::int from cron.job where jobname = 'erpnext-sweep-tick'), 1,
  'AC-ENA-CAD-001 rescheduling upserted the one job instead of adding a second');

-- The overlap guard: a tick holding an org's lock keeps a concurrent tick out until it releases.
select ok(public.claim_erp_sweep_lock('00000000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', interval '15 minutes'),
  'AC-ENA-CAD-001 the first tick claims the org sweep lock');
select ok(not public.claim_erp_sweep_lock('00000000-0000-0000-0000-000000000001', '22222222-2222-4222-8222-222222222222', interval '15 minutes'),
  'AC-ENA-CAD-001 an overlapping tick cannot claim the held org sweep lock');
select ok(public.release_erp_sweep_lock('00000000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111')
  and public.claim_erp_sweep_lock('00000000-0000-0000-0000-000000000001', '22222222-2222-4222-8222-222222222222', interval '15 minutes'),
  'AC-ENA-CAD-001 the next tick claims the lock once the holder releases it');

select * from finish();
rollback;
