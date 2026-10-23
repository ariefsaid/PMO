-- 0357_outbox_failed_backoff.test.sql
-- AC-ENA-CAD-004 [pgTAP]: with the sweep ticking every minute, a rejected (`failed`) command is offered
-- for automatic retry only after an exponential delay since its last failure — 2, 4, 8, 16 minutes
-- after its 1st..4th attempt — so the five-attempt budget (0131) still spans about half an hour.
-- Every other 0131 bound is unchanged.
begin;
select plan(16);

insert into organizations (id, name) values
  ('03570000-0000-0000-0000-000000000001','0357 Backoff Org'),
  ('03570000-0000-0000-0000-000000000002','0357 Other Org');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, attempt_count, created_at, updated_at, reconcile_after)
values
  -- after attempt 1: due 2 minutes after the failure
  ('03570000-0000-0000-0000-0000000000a1','03570000-0000-0000-0000-000000000001','revenue','r-a1','k-a1','erpnext','create','failed',1, now(), now() - interval '90 seconds', null),
  ('03570000-0000-0000-0000-0000000000a2','03570000-0000-0000-0000-000000000001','revenue','r-a2','k-a2','erpnext','create','failed',1, now(), now() - interval '121 seconds', null),
  -- after attempt 2: due after 4 minutes
  ('03570000-0000-0000-0000-0000000000b1','03570000-0000-0000-0000-000000000001','revenue','r-b1','k-b1','erpnext','create','failed',2, now(), now() - interval '3 minutes', null),
  ('03570000-0000-0000-0000-0000000000b2','03570000-0000-0000-0000-000000000001','revenue','r-b2','k-b2','erpnext','create','failed',2, now(), now() - interval '241 seconds', null),
  -- after attempt 4: due after 16 minutes
  ('03570000-0000-0000-0000-0000000000c1','03570000-0000-0000-0000-000000000001','revenue','r-c1','k-c1','erpnext','create','failed',4, now(), now() - interval '15 minutes', null),
  ('03570000-0000-0000-0000-0000000000c2','03570000-0000-0000-0000-000000000001','revenue','r-c2','k-c2','erpnext','create','failed',4, now(), now() - interval '961 seconds', null),
  -- never attempted (e.g. an operator-released hold that was never claimed): no delay
  ('03570000-0000-0000-0000-0000000000d1','03570000-0000-0000-0000-000000000001','revenue','r-d1','k-d1','erpnext','create','failed',0, now(), now(), null),
  -- 0131 bounds still hold however long the row has waited
  ('03570000-0000-0000-0000-0000000000e1','03570000-0000-0000-0000-000000000001','revenue','r-e1','k-e1','erpnext','transition','failed',1, now(), now() - interval '1 hour', null),
  ('03570000-0000-0000-0000-0000000000e2','03570000-0000-0000-0000-000000000001','revenue','r-e2','k-e2','erpnext','create','failed',5, now(), now() - interval '1 hour', null),
  ('03570000-0000-0000-0000-0000000000e3','03570000-0000-0000-0000-000000000001','revenue','r-e3','k-e3','erpnext','create','failed',1, now() - interval '25 hours', now() - interval '1 hour', null),
  -- states the backoff must not touch
  ('03570000-0000-0000-0000-0000000000f1','03570000-0000-0000-0000-000000000001','revenue','r-f1','k-f1','erpnext','create','pending',0, now(), now(), null),
  ('03570000-0000-0000-0000-0000000000f2','03570000-0000-0000-0000-000000000001','revenue','r-f2','k-f2','erpnext','create','committed',3, now(), now(), null),
  ('03570000-0000-0000-0000-0000000000f3','03570000-0000-0000-0000-000000000001','revenue','r-f3','k-f3','erpnext','create','committing',3, now(), now() - interval '61 seconds', null),
  ('03570000-0000-0000-0000-0000000000f4','03570000-0000-0000-0000-000000000001','revenue','r-f4','k-f4','erpnext','create','quarantined',3, now(), now(), now() - interval '1 second'),
  -- tenancy
  ('03570000-0000-0000-0000-0000000000ab','03570000-0000-0000-0000-000000000002','revenue','r-g1','k-g1','erpnext','create','failed',1, now(), now() - interval '1 hour', null);

create temporary view cands as
  select id from public.outbox_reconcile_candidates('03570000-0000-0000-0000-000000000001');

select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000a1'), 0,
  'AC-ENA-CAD-004 a command rejected on attempt 1 is not retried within 2 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000a2'), 1,
  'AC-ENA-CAD-004 a command rejected on attempt 1 is retried after 2 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000b1'), 0,
  'AC-ENA-CAD-004 a command rejected on attempt 2 is not retried within 4 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000b2'), 1,
  'AC-ENA-CAD-004 a command rejected on attempt 2 is retried after 4 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000c1'), 0,
  'AC-ENA-CAD-004 a command rejected on attempt 4 is not retried within 16 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000c2'), 1,
  'AC-ENA-CAD-004 a command rejected on attempt 4 is retried after 16 minutes');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000d1'), 1,
  'AC-ENA-CAD-004 a failed command never attempted is offered at once');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000e1'), 0,
  'AC-ENA-CAD-004 a rejected transition is still never auto-retried (0131)');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000e2'), 0,
  'AC-ENA-CAD-004 a command past the attempt budget is still left to an operator (0131)');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000e3'), 0,
  'AC-ENA-CAD-004 a command past the max row age is still left to an operator (0131)');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000f1'), 1,
  'AC-ENA-CAD-004 a fresh pending command is offered at once');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000f2'), 1,
  'AC-ENA-CAD-004 a committed command is finalized at once');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000f3'), 1,
  'AC-ENA-CAD-004 a committing command past its lease is offered at once');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000f4'), 1,
  'AC-ENA-CAD-004 a quarantined command past its window is offered at once');
select is((select count(*)::int from cands where id = '03570000-0000-0000-0000-0000000000ab'), 0,
  'AC-ENA-CAD-004 another org''s failed command is never in this org''s candidates');
select ok(not has_function_privilege('authenticated', 'public.outbox_reconcile_candidates(uuid)', 'EXECUTE'),
  'AC-ENA-CAD-004 the replaced function stays service-only');

select * from finish();
rollback;
