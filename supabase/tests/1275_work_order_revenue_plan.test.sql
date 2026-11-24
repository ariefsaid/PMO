-- 1275_work_order_revenue_plan.test.sql — #2671 (docs/specs/work-order-revenue-plan.spec.md).
-- Migrations under test: 1275_work_order_revenue_plan.sql, 1276_work_order_revenue_plan_writes.sql.
-- AC-WRP-001 off by default: writes refused, no rows visible · AC-WRP-002 a Finance user enters a date ·
-- AC-WRP-003 a month spreads exact to the cent over working days only · AC-WRP-004 keep-edited re-spread ·
-- AC-WRP-005 write roles (+ mutation check) · AC-WRP-006 Cancelled and Closed work orders are frozen ·
-- AC-WRP-012 another organisation sees and changes nothing. Every denial asserts the errcode AND the message.
begin;
create extension if not exists pgtap;
select plan(54);

insert into organizations (id, name) values
  ('26710000-0000-0000-0000-00000000000a', 'WRP Org'),
  ('26710000-0000-0000-0000-00000000000b', 'WRP Other Org');
-- these features are on by default now (with starter rows); this file proves the off state, so setup clears them as an explicit step
delete from org_revenue_plan_settings where org_id in ('26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values
  ('26710000-0000-0000-0000-0000000000a1', 'wrp-admin@example.com'),
  ('26710000-0000-0000-0000-0000000000a2', 'wrp-fin@example.com'),
  ('26710000-0000-0000-0000-0000000000a3', 'wrp-pm@example.com'),
  ('26710000-0000-0000-0000-0000000000a4', 'wrp-eng@example.com'),
  ('26710000-0000-0000-0000-0000000000a5', 'wrp-pm2@example.com'),
  ('26710000-0000-0000-0000-0000000000a6', 'wrp-exec@example.com'),
  ('26710000-0000-0000-0000-0000000000b1', 'wrp-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26710000-0000-0000-0000-0000000000a1', '26710000-0000-0000-0000-00000000000a', 'WRP Admin', 'wrp-admin@example.com', 'Admin', 'active'),
  ('26710000-0000-0000-0000-0000000000a2', '26710000-0000-0000-0000-00000000000a', 'WRP Fin',   'wrp-fin@example.com',   'Finance', 'active'),
  ('26710000-0000-0000-0000-0000000000a3', '26710000-0000-0000-0000-00000000000a', 'WRP PM',    'wrp-pm@example.com',    'Project Manager', 'active'),
  ('26710000-0000-0000-0000-0000000000a4', '26710000-0000-0000-0000-00000000000a', 'WRP Eng',   'wrp-eng@example.com',   'Engineer', 'active'),
  ('26710000-0000-0000-0000-0000000000a5', '26710000-0000-0000-0000-00000000000a', 'WRP PM Two', 'wrp-pm2@example.com',  'Project Manager', 'active'),
  ('26710000-0000-0000-0000-0000000000a6', '26710000-0000-0000-0000-00000000000a', 'WRP Exec',  'wrp-exec@example.com',  'Executive', 'active'),
  ('26710000-0000-0000-0000-0000000000b1', '26710000-0000-0000-0000-00000000000b', 'WRP XOrg',  'wrp-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-00000000000a', 'WRP Site',     'Ongoing Project', '26710000-0000-0000-0000-0000000000a3', 'IDR'),
  ('26710000-0000-0000-0000-0000000000d9', '26710000-0000-0000-0000-00000000000b', 'WRP Other',    'Ongoing Project', null, 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26710000-0000-0000-0000-000000000401', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d1', 'WO-A', 'WRP WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('26710000-0000-0000-0000-000000000405', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d1', 'WO-D', 'WRP WO dated', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('26710000-0000-0000-0000-000000000409', '26710000-0000-0000-0000-00000000000b', '26710000-0000-0000-0000-0000000000d9', 'WO-X', 'WRP WO other', 'Issued', 10000, 'exclusive', 0, 'IDR');
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, cancelled_at, currency) values
  ('26710000-0000-0000-0000-000000000403', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d1', 'WO-Z', 'WRP WO cancelled', 'Cancelled', 0, 'exclusive', 0, now(), 'IDR'),
  ('26710000-0000-0000-0000-000000000404', '26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-0000000000d1', 'WO-C', 'WRP WO closed', 'Closed', 10000, 'exclusive', 0, null, 'IDR');
update work_orders set start_date = '2026-12-10', end_date = '2026-12-12' where id = '26710000-0000-0000-0000-000000000405';
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── AC-WRP-001: off by default ────────────────────────────────────────────────────────────────────────
select is((select count(*) from public.org_revenue_plan_settings where org_id in ('26710000-0000-0000-0000-00000000000a', '26710000-0000-0000-0000-00000000000b')), 0::bigint, 'AC-WRP-001 an organisation with no settings row is off');
select is(public.revenue_plan_enabled('26710000-0000-0000-0000-00000000000a'), false, 'AC-WRP-001 the plan is off with no settings row');
select is(public.org_is_working_day('26710000-0000-0000-0000-00000000000a', date '2026-12-05'), false, 'default working days: Saturday is not one');
select is(public.org_is_working_day('26710000-0000-0000-0000-00000000000a', date '2026-12-04'), true, 'default working days: Friday is one');
set local role authenticated;
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-03', 500) $$,
  '55000', 'WRP_OFF: the revenue plan is not switched on for this organisation', 'AC-WRP-001 a write while the plan is off is refused');

-- Settings: Admin only (FR-WRP-001).
select throws_ok($$ select public.set_revenue_plan_settings(true, '{1,2,3,4,5}') $$,
  '42501', 'WRP_ROLE: only an Admin sets the revenue plan settings', 'AC-WRP-001 Finance cannot switch the plan on');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_revenue_plan_settings(true, '{0,1}') $$,
  '23514', 'WRP_SETTINGS: choose one to seven different weekdays (1 = Monday to 7 = Sunday)', 'a weekday outside 1..7 is refused');
select throws_ok($$ select public.set_revenue_plan_settings(true, '{1,1}') $$,
  '23514', 'WRP_SETTINGS: choose one to seven different weekdays (1 = Monday to 7 = Sunday)', 'a repeated weekday is refused');
select lives_ok($$ select public.set_revenue_plan_settings(true, '{1,2,3,4,5}') $$, 'Admin switches the plan on');
select is((select enabled from public.org_revenue_plan_settings), true, 'the setting row is visible to its own org');
select is((select count(*) from audit_events where action = 'revenue_plan_settings.set'), 1::bigint, 'the settings change is audited');

-- ── AC-WRP-002: a Finance user enters one date ────────────────────────────────────────────────────────
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-03', 500) $$, 'AC-WRP-002 Finance enters 500.00 for a date');
select is((select amount from public.work_order_revenue_plan where plan_date = '2026-12-03'), 500.00::numeric, 'AC-WRP-002 the date holds 500.00');
select is((select org_id from public.work_order_revenue_plan where plan_date = '2026-12-03'), '26710000-0000-0000-0000-00000000000a'::uuid, 'the org is stamped on the server');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-03', 650.50) $$, 'a date can be set again');
select is((select amount from public.work_order_revenue_plan where plan_date = '2026-12-03'), 650.50::numeric, 'the later amount replaces it');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');
select is((select count(*) from audit_events where action = 'work_order_revenue_plan.set_day'), 2::bigint, 'each write leaves an audit event');
select is((select detail->>'before' from audit_events where action = 'work_order_revenue_plan.set_day' and (detail->>'after')::numeric = 650.50), '500', 'the audit event keeps the previous amount');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-04', -1) $$,
  '23514', 'WRP_AMOUNT: an amount is from 0 with at most two decimals', 'a negative amount is refused');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-04', 1.234) $$,
  '23514', 'WRP_AMOUNT: an amount is from 0 with at most two decimals', 'a third decimal is refused');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '1999-01-01', 1) $$,
  '23514', 'WRP_DATE: enter a real date', 'a date outside the allowed years is refused');
select throws_ok($$ insert into public.work_order_revenue_plan (project_id, work_order_id, plan_date, amount)
  values ('26710000-0000-0000-0000-0000000000d1', '26710000-0000-0000-0000-000000000401', '2026-12-20', 1) $$,
  '42501', 'permission denied for table work_order_revenue_plan', 'a client cannot write the table directly');

-- ── AC-WRP-005: write roles ───────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-08', 10) $$,
  '42501', 'WRP_ROLE: you cannot change the revenue plan on this project', 'AC-WRP-005 an Engineer is refused');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-08', 10) $$,
  '42501', 'WRP_ROLE: you cannot change the revenue plan on this project', 'AC-WRP-005 another project''s Project Manager is refused');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-08', 10) $$, 'AC-WRP-005 the project''s own Project Manager may');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-09', 10) $$, 'AC-WRP-005 an Executive may');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-10', 10) $$, 'AC-WRP-005 an Admin may');
select is((select count(*) from public.work_order_revenue_plan), 4::bigint, 'only the permitted writes left rows');
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a4');
select is((select count(*) from public.work_order_revenue_plan), 0::bigint, 'an Engineer sees no plan rows');

-- ── AC-WRP-006: frozen work orders ────────────────────────────────────────────────────────────────────
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000403', '2026-12-03', 1) $$,
  '23514', 'WRP_FROZEN: the plan of a cancelled work order is frozen', 'AC-WRP-006 a Cancelled work order is refused');
select throws_ok($$ select public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000404', '2026-12-01', 1) $$,
  '23514', 'WRP_FROZEN: the plan of a closed work order is frozen', 'AC-WRP-006 a Closed work order is refused');

-- ── AC-WRP-003: a month spreads over working days, exact to the cent ──────────────────────────────────
select is(public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000401', '2026-12-15', 1000.01), 23, 'AC-WRP-003 December 2026 has 23 working days');
select is((select count(*) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 23::bigint, 'AC-WRP-003 one row per working day');
select is((select sum(amount) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 1000.01::numeric, 'AC-WRP-003 the rows sum to exactly 1000.01');
select is((select count(*) from public.work_order_revenue_plan where extract(isodow from plan_date) > 5), 0::bigint, 'AC-WRP-003 no weekend row');
select is((select amount from public.work_order_revenue_plan where plan_date = '2026-12-01'), 43.48::numeric, 'AC-WRP-003 the earliest dates take the extra cent');
select is((select amount from public.work_order_revenue_plan where plan_date = '2026-12-31'), 43.47::numeric, 'AC-WRP-003 the last date takes the base');

-- ── AC-WRP-004: keep edited days ──────────────────────────────────────────────────────────────────────
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-07', 100) $$, 'a spread day is edited on its own');
select is((select source from public.work_order_revenue_plan where plan_date = '2026-12-07'), 'date', 'the edited day is now a dated row');
select is(public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000401', '2026-12-01', 500, true), 22, 'AC-WRP-004 re-spread with keep-edited uses the other working days');
select is((select amount from public.work_order_revenue_plan where plan_date = '2026-12-07'), 100.00::numeric, 'AC-WRP-004 the edited day is unchanged');
select is((select sum(amount) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 500.00::numeric, 'AC-WRP-004 the month still sums to the new amount');
select throws_ok($$ select public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000401', '2026-12-01', 50, true) $$,
  '23514', 'WRP_KEPT_EXCEEDS: the days you kept already add up to more than the month amount', 'kept days above the month amount are refused');
select is(public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000401', '2026-12-01', 230, false), 23, 'a re-spread without keep-edited replaces every row');
select is((select sum(amount) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 230.00::numeric, 'every day was replaced');
select is(public.wo_revenue_plan_set_month('26710000-0000-0000-0000-000000000405', '2026-12-01', 100, false), 2, 'a month is clipped to the work order''s own dates and working days (Thursday, Friday)');
select is(public.wo_revenue_plan_clear('26710000-0000-0000-0000-000000000401', '2026-12-01', '2026-12-31'), 23, 'a month is cleared');
select is((select count(*) from public.work_order_revenue_plan where work_order_id = '26710000-0000-0000-0000-000000000401'), 0::bigint, 'the cleared month holds no rows');

-- ── AC-WRP-012: another organisation ──────────────────────────────────────────────────────────────────
select pg_temp.act_as('26710000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-03', 1) $$,
  'P0002', 'work order not found', 'AC-WRP-012 another organisation cannot write');
select is((select count(*) from public.work_order_revenue_plan), 0::bigint, 'AC-WRP-012 another organisation sees no rows');
select is((select count(*) from public.org_revenue_plan_settings), 0::bigint, 'AC-WRP-012 another organisation sees no settings');

-- Working weekdays are a setting, not code.
reset role;
update org_revenue_plan_settings set working_weekdays = '{6,7}' where org_id = '26710000-0000-0000-0000-00000000000a';
select is(public.org_is_working_day('26710000-0000-0000-0000-00000000000a', date '2026-12-05'), true, 'a Saturday works when the weekdays say so');
select is(public.org_is_working_day('26710000-0000-0000-0000-00000000000a', date '2026-12-04'), false, 'and a Friday does not');

-- ── Mutation check (rolled back with this test): drop the role gate, the Engineer gets through ────────
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.wrp_writable_work_order(uuid)'::regprocedure) into original;
  -- 2515 deliberately adds PCM and Planner to the writer gate; mutate the complete
  -- current predicate, preserving the Engineer refusal above and its removal proof below.
  mutant := regexp_replace(original,
    $gate$if not \(public\.dsr_may_write_revenue\(w\.project_id\)[^;]*?then -- mut:sr_target_writer$gate$,
    'if false then -- mut:sr_target_writer');
  if mutant = original then raise exception 'role mutation did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('26710000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.wo_revenue_plan_set_day('26710000-0000-0000-0000-000000000401', '2026-12-20', 1) $$,
  'AC-WRP-005 mutation: an Engineer writes the plan when the role gate is removed');
reset role;

select * from finish();
rollback;
