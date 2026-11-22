-- 1891_imprest_estimate.test.sql — cash-advance-estimate: the estimate by month, purpose and work order, and the advance needed.
-- Migration under test: 1891_get_imprest_estimate.sql (+ 1890 splits). Spec docs/specs/cash-advance-estimate.spec.md.
-- AC-CAE-006 a caller who cannot see the float gets no rows · 007 planned, drawn, still to spend and advance needed equal the
-- worked figures; a past month adds no still to spend; Approved beats a Draft of the same month · 008 a work-order row counts only
-- claims on that work order, the unassigned row holds the rest · 009 advance needed is never negative and a top-up in flight is
-- subtracted · 010 a period over 12 months, reversed or open is refused.
-- Worked figures (M0 = this month in the org's timezone): plans M-1 Approved Materials 10000; M0 Approved Materials 100000
-- (60000 to work order A) + Vehicle 50000 (and a newer Draft that must be ignored); M1 Draft Materials 40000; M2 none.
-- Claims: M-1 Paid 3000 Materials; M0 Approved 20000 on work order A, Paid 10000 on none, Submitted 5000 (never counts).
-- Funding Paid 100000, so cash in hand 100000 - 3000 - 10000 = 87000; still to spend 0 + 40000 + 30000 + 50000 + 40000 = 160000.
-- MUTATION CHECK (break, the named assertion must go red, restore; `supabase test db <this file>`):
--   in get_imprest_estimate make `still_to_spend` ignore the month-ended test (always greatest(planned - drawn, 0)) -> AC-CAE-007 past month reds
--   change `wo.wdrawn` to 0 in the work-order row                                                               -> AC-CAE-008 reds
--   change `greatest(e.still - f.cb - f.fl, 0)` to `e.still - f.cb`                                              -> AC-CAE-009 negative reds
--   drop `- f.fl`                                                                                                 -> AC-CAE-009 in-flight reds
--   remove the 12-month test                                                                                     -> AC-CAE-010 reds
--   make the plan pick prefer Draft                                                                              -> AC-CAE-007 Approved-beats-Draft reds
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, default_currency, default_timezone) values
  ('18910000-0000-0000-0000-00000000000a', 'CAE2 Org', 'IDR', 'Asia/Jakarta'),
  ('18910000-0000-0000-0000-00000000000b', 'CAE2 Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('18910000-0000-0000-0000-0000000000a1', 'cae2-admin@example.com'), ('18910000-0000-0000-0000-0000000000a2', 'cae2-fin@example.com'),
  ('18910000-0000-0000-0000-0000000000a4', 'cae2-pm@example.com'),    ('18910000-0000-0000-0000-0000000000a6', 'cae2-eng@example.com'),
  ('18910000-0000-0000-0000-0000000000b1', 'cae2-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18910000-0000-0000-0000-0000000000a1', '18910000-0000-0000-0000-00000000000a', 'CAE2 Admin', 'cae2-admin@example.com', 'Admin', 'active'),
  ('18910000-0000-0000-0000-0000000000a2', '18910000-0000-0000-0000-00000000000a', 'CAE2 Fin', 'cae2-fin@example.com', 'Finance', 'active'),
  ('18910000-0000-0000-0000-0000000000a4', '18910000-0000-0000-0000-00000000000a', 'CAE2 PM', 'cae2-pm@example.com', 'Project Manager', 'active'),
  ('18910000-0000-0000-0000-0000000000a6', '18910000-0000-0000-0000-00000000000a', 'CAE2 Eng', 'cae2-eng@example.com', 'Engineer', 'active'),
  ('18910000-0000-0000-0000-0000000000b1', '18910000-0000-0000-0000-00000000000b', 'CAE2 XOrg', 'cae2-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('18910000-0000-0000-0000-0000000000c1', '18910000-0000-0000-0000-00000000000a', 'CAE2 Site', 'Ongoing Project', '18910000-0000-0000-0000-0000000000a4', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('18910000-0000-0000-0000-000000000401', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000c1', 'WO-A', 'CAE2 WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('18910000-0000-0000-0000-000000000402', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000c1', 'WO-B', 'CAE2 WO B', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('18910000-0000-0000-0000-0000000000d1', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000c1',
   '18910000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '18910000-0000-0000-0000-0000000000a1');

-- months relative to this month in the org timezone
create or replace function pg_temp.m(p_off int) returns date language sql stable as $$
  select (date_trunc('month', now() at time zone 'Asia/Jakarta') + make_interval(months => p_off))::date $$;
create or replace function pg_temp.off(p_d date) returns int language sql stable as $$
  select ((extract(year from p_d) * 12 + extract(month from p_d)) - (extract(year from pg_temp.m(0)) * 12 + extract(month from pg_temp.m(0))))::int $$;
grant execute on function pg_temp.m(int), pg_temp.off(date) to authenticated;

set local session_replication_role = replica;
insert into imprest_plans (id, org_id, float_id, month, author_id, status, created_at) values
  ('18910000-0000-0000-0000-000000000100', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), '18910000-0000-0000-0000-0000000000a4', 'Approved', now() - interval '3 days'),
  ('18910000-0000-0000-0000-000000000101', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1', pg_temp.m(0),  '18910000-0000-0000-0000-0000000000a4', 'Approved', now() - interval '2 days'),
  ('18910000-0000-0000-0000-000000000102', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1', pg_temp.m(0),  '18910000-0000-0000-0000-0000000000a4', 'Draft', now()),
  ('18910000-0000-0000-0000-000000000103', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1', pg_temp.m(1),  '18910000-0000-0000-0000-0000000000a4', 'Draft', now());
insert into imprest_plan_lines (id, org_id, plan_id, budget_category, planned_amount) values
  ('18910000-0000-0000-0000-000000000200', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000100', 'Materials', 10000),
  ('18910000-0000-0000-0000-000000000201', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000101', 'Materials', 100000),
  ('18910000-0000-0000-0000-000000000202', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000101', 'Vehicle', 50000),
  ('18910000-0000-0000-0000-000000000203', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000102', 'Materials', 999),
  ('18910000-0000-0000-0000-000000000204', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000103', 'Materials', 40000);
insert into imprest_plan_line_splits (org_id, line_id, work_order_id, amount) values
  ('18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-000000000201', '18910000-0000-0000-0000-000000000401', 60000);
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('18910000-0000-0000-0000-0000000000e1', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1',
   'funding', 'REP-CAE-1', 'Paid', 100000, '18910000-0000-0000-0000-0000000000a2', '18910000-0000-0000-0000-0000000000a1',
   '18910000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month, work_order_id, currency) values
  ('18910000-0000-0000-0000-000000000301', '18910000-0000-0000-0000-00000000000a', 'claim', '18910000-0000-0000-0000-0000000000a6',
   '18910000-0000-0000-0000-0000000000c1', 'Materials', 'past paid', 3000, 'Paid', 'EXP-CAE-1', now(),
   '18910000-0000-0000-0000-0000000000a4', now(), '18910000-0000-0000-0000-0000000000a2', now(), current_date,
   '18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), null, 'IDR'),
  ('18910000-0000-0000-0000-000000000302', '18910000-0000-0000-0000-00000000000a', 'claim', '18910000-0000-0000-0000-0000000000a6',
   '18910000-0000-0000-0000-0000000000c1', 'Materials', 'on work order A', 20000, 'Approved', 'EXP-CAE-2', now(),
   '18910000-0000-0000-0000-0000000000a4', now(), null, null, null,
   '18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), '18910000-0000-0000-0000-000000000401', 'IDR'),
  ('18910000-0000-0000-0000-000000000303', '18910000-0000-0000-0000-00000000000a', 'claim', '18910000-0000-0000-0000-0000000000a6',
   '18910000-0000-0000-0000-0000000000c1', 'Materials', 'no work order paid', 10000, 'Paid', 'EXP-CAE-3', now(),
   '18910000-0000-0000-0000-0000000000a4', now(), '18910000-0000-0000-0000-0000000000a2', now(), current_date,
   '18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), null, 'IDR'),
  ('18910000-0000-0000-0000-000000000304', '18910000-0000-0000-0000-00000000000a', 'claim', '18910000-0000-0000-0000-0000000000a6',
   '18910000-0000-0000-0000-0000000000c1', 'Materials', 'submitted only', 5000, 'Submitted', 'EXP-CAE-4', now(),
   null, null, null, null, null,
   '18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), null, 'IDR');
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;
-- one estimate row as 'status|planned|drawn|still' (offset, category, work order are the key)
create or replace function pg_temp.row_of(p_off int, p_cat text, p_wo uuid) returns text language sql stable as $$
  select e.plan_status || '|' || e.planned || '|' || e.drawn || '|' || e.still_to_spend
    from public.get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2)) e
   where pg_temp.off(e.month) = p_off and e.budget_category::text is not distinct from p_cat and e.work_order_id is not distinct from p_wo $$;
grant execute on function pg_temp.row_of(int, text, uuid) to authenticated;

set local role authenticated;
select pg_temp.act_as('18910000-0000-0000-0000-0000000000a4');

-- AC-CAE-007
select is((select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 6,
  'AC-CAE-007 four months give six rows: one past, three this month, one next, one with no plan');
select is(pg_temp.row_of(-1, 'Materials', null), 'Approved|10000.00|3000.00|0.00',
  'AC-CAE-007 a month that has ended adds nothing to still to spend');
select is(pg_temp.row_of(0, 'Vehicle', null), 'Approved|50000.00|0.00|50000.00',
  'AC-CAE-007 this month: a purpose with nothing drawn is still to spend in full; the newer Draft of the month is ignored');
select is(pg_temp.row_of(1, 'Materials', null), 'Draft|40000.00|0.00|40000.00',
  'AC-CAE-007 a month with only a Draft counts it, marked Draft');
select is((select e.plan_status || '|' || coalesce(e.budget_category::text, '-') || '|' || e.planned
             from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(2), pg_temp.m(2)) e),
  'none|-|0.00', 'AC-CAE-007 a month with no plan says so');
-- AC-CAE-008
select is(pg_temp.row_of(0, 'Materials', '18910000-0000-0000-0000-000000000401'), 'Approved|60000.00|20000.00|40000.00',
  'AC-CAE-008 the work-order row counts only the claims named on that work order');
select is(pg_temp.row_of(0, 'Materials', null), 'Approved|40000.00|10000.00|30000.00',
  'AC-CAE-008 the unassigned row holds the rest of the line and the rest of the drawn (a Submitted claim never counts)');
select is((select drawn from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), pg_temp.m(0))), 30000.00,
  'AC-CAE-008 the rows add up to the purpose''s drawn figure (imprest_drawn) for the month');
-- AC-CAE-007 totals, AC-CAE-009
select is((select row(planned, drawn, still_to_spend, cash_book, in_flight, advance_needed)::text
             from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))),
  row(200000.00, 33000.00, 160000.00, 87000.00, 0.00, 73000.00)::text,
  'AC-CAE-007 totals: planned, drawn, still to spend 160000, cash 87000, advance needed 73000');
reset role;
set local session_replication_role = replica;
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, approved_at) values
  ('18910000-0000-0000-0000-0000000000e2', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-CAE-2', 'Approved', 20000, '18910000-0000-0000-0000-0000000000a2', '18910000-0000-0000-0000-0000000000a1', now());
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('18910000-0000-0000-0000-0000000000a4');
select is((select in_flight || '/' || advance_needed from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))),
  '20000.00/53000.00', 'AC-CAE-009 a top-up in flight is subtracted from the advance needed');
reset role;
set local session_replication_role = replica;
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('18910000-0000-0000-0000-0000000000e3', '18910000-0000-0000-0000-00000000000a', '18910000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-CAE-3', 'Paid', 1000000, '18910000-0000-0000-0000-0000000000a2', '18910000-0000-0000-0000-0000000000a1',
   '18910000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('18910000-0000-0000-0000-0000000000a4');
select is((select cash_book || '/' || advance_needed from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))),
  '1087000.00/0.00', 'AC-CAE-009 cash above still to spend gives an advance needed of 0, never negative');

-- AC-CAE-010
select like(pg_temp.try($$ select * from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), pg_temp.m(12)) $$),
  'P0001|ICE_PERIOD:%', 'AC-CAE-010 thirteen months are refused');
select like(pg_temp.try($$ select * from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(1), pg_temp.m(0)) $$),
  'P0001|ICE_PERIOD:%', 'AC-CAE-010 a period ending before it starts is refused');
select like(pg_temp.try($$ select * from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', null, pg_temp.m(0)) $$),
  'P0001|ICE_PERIOD:%', 'AC-CAE-010 an open period is refused');
select is(pg_temp.try($$ select * from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), pg_temp.m(11)) $$), 'ok',
  'AC-CAE-010 twelve months are allowed');
select is((select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(0) + 10, pg_temp.m(0) + 12)),
  (select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(0), pg_temp.m(0))),
  'AC-CAE-010 dates inside a month mean that whole month');

-- AC-CAE-006
select pg_temp.act_as('18910000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 0,
  'AC-CAE-006 an Engineer, who sees no float, gets no estimate rows');
select is((select count(*)::int from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 0,
  'AC-CAE-006 nor a total');
select pg_temp.act_as('18910000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 0,
  'AC-CAE-006 another organisation gets no estimate rows');
select is((select count(*)::int from get_imprest_estimate_total('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 0,
  'AC-CAE-006 nor a total');
select pg_temp.act_as('18910000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from get_imprest_estimate('18910000-0000-0000-0000-0000000000d1', pg_temp.m(-1), pg_temp.m(2))), 6,
  'AC-CAE-006 an Admin reads the same six rows');
select is(has_function_privilege('anon', 'public.get_imprest_estimate(uuid, date, date)', 'EXECUTE'), false,
  'AC-CAE-006 the signed-out role cannot run the estimate');

select * from finish();
rollback;
