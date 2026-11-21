-- 1280_non_working_dates.test.sql — #2672 (docs/specs/work-order-daily-target.spec.md).
-- Migration under test: 1280_non_working_dates.sql.
-- AC-WDT-001 off: reads empty, writes refused · AC-WDT-002 Admin-only add, idempotent (+ mutation c) · AC-WDT-003 the month
-- spread skips listed dates and stays exact to the cent (+ mutation a) · AC-WDT-004 editing the list never moves existing
-- rows · AC-WDT-011 another organisation sees nothing and is refused.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name) values
  ('26728000-0000-0000-0000-00000000000a', 'WDT Org'),
  ('26728000-0000-0000-0000-00000000000b', 'WDT Other Org');
insert into auth.users (id, email) values
  ('26728000-0000-0000-0000-0000000000a1', 'wdt-admin@example.com'),
  ('26728000-0000-0000-0000-0000000000a2', 'wdt-fin@example.com'),
  ('26728000-0000-0000-0000-0000000000a4', 'wdt-eng@example.com'),
  ('26728000-0000-0000-0000-0000000000b1', 'wdt-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26728000-0000-0000-0000-0000000000a1', '26728000-0000-0000-0000-00000000000a', 'WDT Admin', 'wdt-admin@example.com', 'Admin', 'active'),
  ('26728000-0000-0000-0000-0000000000a2', '26728000-0000-0000-0000-00000000000a', 'WDT Fin',   'wdt-fin@example.com',   'Finance', 'active'),
  ('26728000-0000-0000-0000-0000000000a4', '26728000-0000-0000-0000-00000000000a', 'WDT Eng',   'wdt-eng@example.com',   'Engineer', 'active'),
  ('26728000-0000-0000-0000-0000000000b1', '26728000-0000-0000-0000-00000000000b', 'WDT XOrg',  'wdt-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26728000-0000-0000-0000-0000000000d1', '26728000-0000-0000-0000-00000000000a', 'WDT Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26728000-0000-0000-0000-000000000401', '26728000-0000-0000-0000-00000000000a', '26728000-0000-0000-0000-0000000000d1', 'WO-A', 'WDT WO A', 'Issued', 10000, 'exclusive', 0, 'IDR');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── AC-WDT-001: the plan switch is off (default) ──────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.non_working_date_add('2026-12-25', 'Holiday') $$,
  '55000', 'WDT_OFF: the revenue plan is not switched on for this organisation', 'AC-WDT-001 an Admin cannot add a date while the plan is off');
select throws_ok($$ select public.non_working_date_remove('2026-12-25') $$,
  '55000', 'WDT_OFF: the revenue plan is not switched on for this organisation', 'AC-WDT-001 nor remove one');
select is((select count(*) from public.org_non_working_dates), 0::bigint, 'AC-WDT-001 the list reads empty');
select lives_ok($$ select public.set_revenue_plan_settings(true, '{1,2,3,4,5}') $$, 'Admin switches the plan on');

-- ── AC-WDT-002: Admin only, idempotent ────────────────────────────────────────────────────────────────
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.non_working_date_add('2026-12-25', 'Holiday') $$,
  '42501', 'WDT_ROLE: only an Admin edits the non-working dates', 'AC-WDT-002 Finance is refused');
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.non_working_date_add('2026-12-25', 'Holiday') $$,
  '42501', 'WDT_ROLE: only an Admin edits the non-working dates', 'AC-WDT-002 an Engineer is refused');
select throws_ok($$ select public.non_working_date_remove('2026-12-25') $$,
  '42501', 'WDT_ROLE: only an Admin edits the non-working dates', 'AC-WDT-002 an Engineer cannot remove');
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.non_working_date_add('2026-12-25', 'Holiday') $$, 'AC-WDT-002 Admin adds 25 Dec');
select is((select count(*) from public.org_non_working_dates where work_date = '2026-12-25'), 1::bigint, 'AC-WDT-002 it is listed');
select is((select label from public.org_non_working_dates where work_date = '2026-12-25'), 'Holiday', 'the label is kept');
select is((select org_id from public.org_non_working_dates where work_date = '2026-12-25'), '26728000-0000-0000-0000-00000000000a'::uuid, 'the org is stamped on the server');
select lives_ok($$ select public.non_working_date_add('2026-12-25', 'Again') $$, 'AC-WDT-002 adding it again is accepted');
select is((select count(*) from public.org_non_working_dates), 1::bigint, 'AC-WDT-002 adding it again changes nothing');
select is((select label from public.org_non_working_dates where work_date = '2026-12-25'), 'Holiday', 'the first label stays');
select is((select count(*) from audit_events where action = 'non_working_date.add'), 1::bigint, 'only the real change is audited');
select throws_ok($$ select public.non_working_date_add('1999-12-31', null) $$,
  '23514', 'WDT_DATE: enter a real date', 'a date outside 2000..2100 is refused');
select throws_ok($$ select public.non_working_date_add('2026-12-26', repeat('x', 81)) $$,
  '23514', 'WDT_LABEL: a label is at most 80 characters', 'a long label is refused');
select throws_ok($$ insert into public.org_non_working_dates (work_date) values ('2026-12-30') $$,
  '42501', 'permission denied for table org_non_working_dates', 'a client cannot write the table directly');

-- ── AC-WDT-003: the month spread skips the listed date, exact to the cent ─────────────────────────────
-- 25 Dec 2026 is a Friday: December has 23 weekdays, 22 without it.
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a2');
select is(public.wo_revenue_plan_set_month('26728000-0000-0000-0000-000000000401', '2026-12-01', 2100), 22, 'AC-WDT-003 22 working days once 25 Dec is listed');
select is((select count(*) from public.work_order_revenue_plan where plan_date = '2026-12-25'), 0::bigint, 'AC-WDT-003 no row is dated 25 Dec');
select is((select sum(amount) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 2100.00::numeric, 'AC-WDT-003 the rows sum to exactly 2100.00');

-- ── AC-WDT-004: editing the list never moves existing rows ────────────────────────────────────────────
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.non_working_date_add('2026-12-24', 'Eve') $$, 'AC-WDT-004 Admin lists another date');
select is((select count(*) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 22::bigint, 'AC-WDT-004 no existing row was removed');
select is((select sum(amount) from public.work_order_revenue_plan where plan_date between '2026-12-01' and '2026-12-31'), 2100.00::numeric, 'AC-WDT-004 no existing amount changed');
select is((select count(*) from public.work_order_revenue_plan where plan_date = '2026-12-24'), 1::bigint, 'AC-WDT-004 a target already on a newly listed date stays');
select lives_ok($$ select public.non_working_date_remove('2026-12-24') $$, 'Admin removes it again');
select is((select count(*) from public.org_non_working_dates), 1::bigint, 'only that date is removed');
select is((select count(*) from audit_events where action = 'non_working_date.remove'), 1::bigint, 'the removal is audited');
select is(public.org_is_working_day('26728000-0000-0000-0000-00000000000a', date '2026-12-25'), false, 'a listed weekday is not a working day');
select is(public.org_is_working_day('26728000-0000-0000-0000-00000000000a', date '2026-12-24'), true, 'an unlisted weekday still is');
select is(public.org_is_working_day('26728000-0000-0000-0000-00000000000a', date '2026-12-26'), false, 'a Saturday is still not (2671 weekday rule intact)');

-- ── AC-WDT-011: another organisation ──────────────────────────────────────────────────────────────────
select pg_temp.act_as('26728000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.org_non_working_dates), 0::bigint, 'AC-WDT-011 another organisation sees no listed dates');
select throws_ok($$ select public.non_working_date_add('2026-12-31', 'x') $$,
  '55000', 'WDT_OFF: the revenue plan is not switched on for this organisation', 'AC-WDT-011 its own plan is off, so it is refused');
reset role;
select is(public.org_is_working_day('26728000-0000-0000-0000-00000000000b', date '2026-12-25'), true, 'AC-WDT-011 the list of one organisation does not touch another');

-- ── Mutation (a): the working-day rule ignores the list => a row lands on 25 Dec ──────────────────────
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.org_is_working_day(uuid,date)'::regprocedure) into original;
  mutant := replace(original, 'and not exists (select 1 from public.org_non_working_dates n where n.org_id = p_org and n.work_date = p_date)', '');
  if mutant = original then raise exception 'mutation (a) did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a2');
select public.wo_revenue_plan_set_month('26728000-0000-0000-0000-000000000401', '2026-12-01', 2100);
select is((select count(*) from public.work_order_revenue_plan where plan_date = '2026-12-25'), 1::bigint,
  'AC-WDT-003 mutation (a): with the list ignored a row lands on 25 Dec (the proof above is what the list rule guards)');
reset role;

-- ── Mutation (c): drop the Admin gate => Finance can edit the list ────────────────────────────────────
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.non_working_date_add(date,text)'::regprocedure) into original;
  mutant := replace(original, 'public.auth_role() is distinct from ''Admin''', 'false');
  if mutant = original then raise exception 'mutation (c) did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('26728000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.non_working_date_add('2026-12-29', 'x') $$,
  'AC-WDT-002 mutation (c): Finance edits the list when the Admin gate is removed (the refusal above is what the gate guards)');
reset role;

select * from finish();
rollback;
