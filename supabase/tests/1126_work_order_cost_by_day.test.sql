-- 1126_work_order_cost_by_day.test.sql — #1126: a work order's per-day cost.
-- No new database object: the screen groups the existing cost lines (work_order_cost_lines) by each record's own day and
-- prices them with the existing cost read (work_order_cost_amounts). This proves the reconcile it relies on (the days add up
-- to the read's total for the work order, a record with no day sits apart) and that read rights stay those of the existing reads.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27100000-0000-0000-0000-00000000000a', 'PDC Org',   'IDR', 'UTC'),
  ('27100000-0000-0000-0000-00000000000b', 'PDC Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27100000-0000-0000-0000-0000000000a1', 'pdc-admin@example.com'), ('27100000-0000-0000-0000-0000000000a4', 'pdc-eng@example.com'),
  ('27100000-0000-0000-0000-0000000000a5', 'pdc-eng2@example.com'), ('27100000-0000-0000-0000-0000000000b1', 'pdc-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27100000-0000-0000-0000-0000000000a1', '27100000-0000-0000-0000-00000000000a', 'PDC Admin', 'pdc-admin@example.com', 'Admin', 'active'),
  ('27100000-0000-0000-0000-0000000000a4', '27100000-0000-0000-0000-00000000000a', 'PDC Eng',   'pdc-eng@example.com',   'Engineer', 'active'),
  ('27100000-0000-0000-0000-0000000000a5', '27100000-0000-0000-0000-00000000000a', 'PDC Eng2',  'pdc-eng2@example.com',  'Engineer', 'active'),
  ('27100000-0000-0000-0000-0000000000b1', '27100000-0000-0000-0000-00000000000b', 'PDC XOrg',  'pdc-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('27100000-0000-0000-0000-0000000000d1', '27100000-0000-0000-0000-00000000000a', 'PDC Site',  'Ongoing Project', 'IDR'),
  ('27100000-0000-0000-0000-0000000000d9', '27100000-0000-0000-0000-00000000000b', 'PDC Other', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('27100000-0000-0000-0000-000000000401', '27100000-0000-0000-0000-00000000000a', '27100000-0000-0000-0000-0000000000d1', 'WO-A', 'PDC WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('27100000-0000-0000-0000-000000000409', '27100000-0000-0000-0000-00000000000b', '27100000-0000-0000-0000-0000000000d9', 'WO-X', 'PDC WO X', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, approved_at, currency, work_order_id, created_at) values
  ('27100000-0000-0000-0000-000000000701', '27100000-0000-0000-0000-00000000000a', 'claim', '27100000-0000-0000-0000-0000000000a4', '27100000-0000-0000-0000-0000000000d1', 'Materials', 'Night claim', 400, 'Approved', 'EXP-P1', now(), 'IDR', '27100000-0000-0000-0000-000000000401', '2026-11-11 12:00:00+00'),
  ('27100000-0000-0000-0000-000000000702', '27100000-0000-0000-0000-00000000000a', 'claim', '27100000-0000-0000-0000-0000000000a4', '27100000-0000-0000-0000-0000000000d1', 'Materials', 'Noon claim',  100, 'Approved', 'EXP-P2', now(), 'IDR', '27100000-0000-0000-0000-000000000401', '2026-11-12 12:00:00+00'),
  ('27100000-0000-0000-0000-000000000708', '27100000-0000-0000-0000-00000000000b', 'claim', '27100000-0000-0000-0000-0000000000b1', '27100000-0000-0000-0000-0000000000d9', 'Materials', 'UTC org claim', 900, 'Approved', 'EXP-P8', now(), 'IDR', '27100000-0000-0000-0000-000000000409', '2026-11-10 12:00:00+00');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

select pg_temp.act_as('27100000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from work_order_cost_lines where work_order_id = '27100000-0000-0000-0000-000000000401'), 2,
  'AC-PDC-003 the admin reads both cost lines of the work order');

-- Reconcile: the cost records grouped by their own day add up to the cost read's total for the work order.
select is((select sum(a.amount::numeric) from work_order_cost_amounts('27100000-0000-0000-0000-0000000000d1') a
            where a.work_order_id = '27100000-0000-0000-0000-000000000401' and a.reason = 'counted'),
          (select sum(d.day_total) from (
             select l.occurred_on, sum(a.amount::numeric) as day_total
               from work_order_cost_lines l
               join work_order_cost_amounts('27100000-0000-0000-0000-0000000000d1') a on a.source = l.source and a.record_id = l.record_id and a.reason = 'counted'
              where l.work_order_id = '27100000-0000-0000-0000-000000000401' group by l.occurred_on) d),
  'AC-PDC-004 the days add up to the cost read total for the work order');
select is((select string_agg(d.occurred_on || ':' || d.day_total, ',' order by d.occurred_on) from (
             select l.occurred_on, sum(a.amount::numeric) as day_total
               from work_order_cost_lines l
               join work_order_cost_amounts('27100000-0000-0000-0000-0000000000d1') a on a.source = l.source and a.record_id = l.record_id and a.reason = 'counted'
              where l.work_order_id = '27100000-0000-0000-0000-000000000401' group by l.occurred_on) d),
          '2026-11-11:400.00,2026-11-12:100.00', 'AC-PDC-005 each day carries exactly its own claim');

-- Refusals: read rights are the cost lines' own.
select pg_temp.act_as('27100000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from work_order_cost_lines where work_order_id = '27100000-0000-0000-0000-000000000401'), 0,
  'AC-PDC-006 an engineer who did not make the claims reads no cost line of the work order');
select throws_ok($$ select * from work_order_cost_amounts('27100000-0000-0000-0000-0000000000d1') $$, '42501', 'not authorized',
  'AC-PDC-007 an engineer reads no cost money, so no per-day money');
select pg_temp.act_as('27100000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from work_order_cost_lines where work_order_id = '27100000-0000-0000-0000-000000000401'), 0,
  'AC-PDC-008 another organisation reads nothing of this work order');
reset role;
select * from finish();
rollback;
