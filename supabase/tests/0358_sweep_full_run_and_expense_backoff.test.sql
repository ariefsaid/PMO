-- 0358_sweep_full_run_and_expense_backoff.test.sql
-- AC-ENA-CAD-006 [pgTAP]: the hourly full sweep is stamped per org, only by the tick holding the org's
--   sweep lock, so a tick that never got the lock (or died) leaves the org due for the next tick.
-- AC-ENA-CAD-007 [pgTAP]: a failed expense posting is queued again only after 2^n minutes (capped at an
--   hour) since its last attempt; pending postings are queued at once.
begin;
select plan(15);

insert into organizations (id, name) values
  ('03580000-0000-0000-0000-000000000001','0358 Org A'),
  ('03580000-0000-0000-0000-000000000002','0358 Org B');

-- ── AC-ENA-CAD-006 ──────────────────────────────────────────────────────────────────────────────
select ok(not public.mark_erp_full_sweep_done('03580000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111'),
  'AC-ENA-CAD-006 a tick that does not hold the org lock cannot stamp a full run');
select is((select count(*)::int from public.erp_sweep_full_run where org_id = '03580000-0000-0000-0000-000000000001'), 0,
  'AC-ENA-CAD-006 so the org stays due for its full run');
select ok(public.claim_erp_sweep_lock('03580000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', interval '15 minutes')
  and public.mark_erp_full_sweep_done('03580000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111'),
  'AC-ENA-CAD-006 the lock holder stamps its completed full run');
select ok((select completed_at from public.erp_sweep_full_run where org_id = '03580000-0000-0000-0000-000000000001') = now(),
  'AC-ENA-CAD-006 the stamp is the completion time');
select ok(not public.mark_erp_full_sweep_done('03580000-0000-0000-0000-000000000001', '22222222-2222-4222-8222-222222222222'),
  'AC-ENA-CAD-006 another holder cannot stamp the org');
update public.erp_sweep_lock set locked_until = now() - interval '1 second' where org_id = '03580000-0000-0000-0000-000000000001';
update public.erp_sweep_full_run set completed_at = now() - interval '2 hours' where org_id = '03580000-0000-0000-0000-000000000001';
select ok(not public.mark_erp_full_sweep_done('03580000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111')
  and (select completed_at from public.erp_sweep_full_run where org_id = '03580000-0000-0000-0000-000000000001') = now() - interval '2 hours',
  'AC-ENA-CAD-006 a holder whose lease ran out (a killed worker) cannot stamp');
select ok(not has_function_privilege('authenticated', 'public.mark_erp_full_sweep_done(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_erp_full_sweep_done(uuid, uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.erp_sweep_full_run', 'SELECT'),
  'AC-ENA-CAD-006 the full-run marker is service-only');

-- ── AC-ENA-CAD-007 ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values ('03580000-0000-0000-0000-0000000000a1','claimant-0358@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('03580000-0000-0000-0000-0000000000a1','03580000-0000-0000-0000-000000000001','Claimant 0358','claimant-0358@example.com','Engineer');
insert into expense_claims (id, org_id, claimant_id, title, status)
values ('03580000-0000-0000-0000-0000000000c1','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000a1','0358 claim','Draft');

insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, push_state, attempt_count, last_attempt_at)
values
  ('03580000-0000-0000-0000-0000000000e1','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000c1','approval','03580000-0000-0000-0000-0000000000c1:approval', now(), 'failed', 1, now() - interval '90 seconds'),
  ('03580000-0000-0000-0000-0000000000e2','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000c1','claim-payment','03580000-0000-0000-0000-0000000000c1:claim-payment', now(), 'failed', 1, now() - interval '121 seconds'),
  ('03580000-0000-0000-0000-0000000000e3','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000c1','settlement','03580000-0000-0000-0000-0000000000c1:settlement', now(), 'failed', 20, now() - interval '59 minutes'),
  ('03580000-0000-0000-0000-0000000000e4','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000c1','advance-payment','03580000-0000-0000-0000-0000000000c1:advance-payment', now(), 'failed', 20, now() - interval '61 minutes'),
  ('03580000-0000-0000-0000-0000000000e5','03580000-0000-0000-0000-000000000001','03580000-0000-0000-0000-0000000000c1','approval-cancel','03580000-0000-0000-0000-0000000000c1:approval-cancel', now(), 'pending', 0, now());

create temporary view q as
  select id from public.expense_posting_queue('03580000-0000-0000-0000-000000000001', 200);

select is((select count(*)::int from q where id = '03580000-0000-0000-0000-0000000000e1'), 0,
  'AC-ENA-CAD-007 a posting that failed once is not retried within 2 minutes');
select is((select count(*)::int from q where id = '03580000-0000-0000-0000-0000000000e2'), 1,
  'AC-ENA-CAD-007 a posting that failed once is retried after 2 minutes');
select is((select count(*)::int from q where id = '03580000-0000-0000-0000-0000000000e3'), 0,
  'AC-ENA-CAD-007 a posting that keeps failing waits up to the one-hour cap');
select is((select count(*)::int from q where id = '03580000-0000-0000-0000-0000000000e4'), 1,
  'AC-ENA-CAD-007 the delay never exceeds one hour');
select is((select count(*)::int from q where id = '03580000-0000-0000-0000-0000000000e5'), 1,
  'AC-ENA-CAD-007 a pending posting is queued at once, whatever its last attempt');
select is((select count(*)::int from public.expense_posting_queue('03580000-0000-0000-0000-000000000002', 200)), 0,
  'AC-ENA-CAD-007 another org never sees this org''s postings');
select is((select count(*)::int from public.expense_posting_queue('03580000-0000-0000-0000-000000000001', 1)), 1,
  'AC-ENA-CAD-007 the queue honours its per-tick limit');
select ok(not has_function_privilege('authenticated', 'public.expense_posting_queue(uuid, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.expense_posting_queue(uuid, int)', 'EXECUTE'),
  'AC-ENA-CAD-007 the queue is service-only');

select * from finish();
rollback;
