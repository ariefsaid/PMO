-- 1375_billing_plan_settings.test.sql — monthly billing plan settings (#2682). AC-MBP-006..009 (docs/specs/monthly-billing-plan.spec.md). Ids 13750000-… (synthetic).
-- Org a1: b1 finance, b2 admin, b3 project manager, b4 executive, b6 engineer. Org a2 (foreign): b9 finance.
begin;
create extension if not exists pgtap;
select plan(25);
insert into organizations (id, name, default_currency, default_timezone) values
  ('13750000-0000-0000-0000-0000000000a1', 'MBP Set A', 'IDR', 'UTC'), ('13750000-0000-0000-0000-0000000000a2', 'MBP Set B', 'IDR', 'UTC');
insert into auth.users (id, email) select ids.id, 'mbp-set-' || ids.n || '@example.invalid' from (values
  ('13750000-0000-0000-0000-0000000000b1'::uuid, 'fin'), ('13750000-0000-0000-0000-0000000000b2', 'adm'), ('13750000-0000-0000-0000-0000000000b3', 'pm'), ('13750000-0000-0000-0000-0000000000b4', 'exe'), ('13750000-0000-0000-0000-0000000000b6', 'eng'), ('13750000-0000-0000-0000-0000000000b9', 'ffin')) ids(id, n);
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13750000-0000-0000-0000-0000000000b1', '13750000-0000-0000-0000-0000000000a1', 'Set Finance', 'mbp-set-fin@example.invalid', 'Finance', 'active'),
  ('13750000-0000-0000-0000-0000000000b2', '13750000-0000-0000-0000-0000000000a1', 'Set Admin', 'mbp-set-adm@example.invalid', 'Admin', 'active'),
  ('13750000-0000-0000-0000-0000000000b3', '13750000-0000-0000-0000-0000000000a1', 'Set PM', 'mbp-set-pm@example.invalid', 'Project Manager', 'active'),
  ('13750000-0000-0000-0000-0000000000b4', '13750000-0000-0000-0000-0000000000a1', 'Set Exec', 'mbp-set-exe@example.invalid', 'Executive', 'active'),
  ('13750000-0000-0000-0000-0000000000b6', '13750000-0000-0000-0000-0000000000a1', 'Set Engineer', 'mbp-set-eng@example.invalid', 'Engineer', 'active'),
  ('13750000-0000-0000-0000-0000000000b9', '13750000-0000-0000-0000-0000000000a2', 'Set Foreign Finance', 'mbp-set-ffin@example.invalid', 'Finance', 'active');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"13750000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;

-- AC-MBP-009: no row = no target, reminder off.
select pg_temp.as_user('b1');
select is((select count(*)::int from org_billing_plan_settings), 0, 'AC-MBP-009 no settings row until someone sets one (no target, reminder off)');
-- AC-MBP-006: Finance writes.
select is((select (set_billing_plan_settings(5000000, 'idr', false)).monthly_target), 5000000::numeric, 'AC-MBP-006 Finance sets the default target');
select results_eq($$ select monthly_target, target_currency, done_not_claimed_reminder_on, org_id from org_billing_plan_settings $$,
  $$ values (5000000::numeric, 'IDR'::text, false, '13750000-0000-0000-0000-0000000000a1'::uuid) $$, 'AC-MBP-006 stored with the caller organisation, currency upper-cased, reminder off by default');
select lives_ok($$ select set_billing_plan_month_target(date '2026-12-17', 8000000) $$, 'AC-MBP-006 Finance sets a month target (any day of the month)');
select results_eq($$ select month, target from billing_plan_month_targets $$, $$ values (date '2026-12-01', 8000000::numeric) $$, 'AC-MBP-006 the month is normalised to its first day');
select lives_ok($$ select set_billing_plan_month_target(date '2026-12-01', 9000000) $$, 'AC-MBP-006 a second write replaces the month target');
select is((select count(*)::int from billing_plan_month_targets), 1, 'AC-MBP-006 one row per month');
select lives_ok($$ select set_billing_plan_month_target(date '2026-12-01', null) $$, 'AC-MBP-006 a null target clears the month override');
select is((select count(*)::int from billing_plan_month_targets), 0, 'AC-MBP-006 cleared');
select pg_temp.as_user('b2');
select is((select (set_billing_plan_settings(5000000, 'IDR', true)).done_not_claimed_reminder_on), true, 'AC-MBP-006 an Admin switches the reminder on');
-- Refused roles.
select pg_temp.as_user('b3');
select throws_ok($$ select set_billing_plan_settings(1, 'IDR', false) $$, '42501', null, 'AC-MBP-006 a Project Manager cannot set the plan');
select pg_temp.as_user('b4');
select throws_ok($$ select set_billing_plan_settings(1, 'IDR', false) $$, '42501', null, 'AC-MBP-006 an Executive cannot set the plan');
select pg_temp.as_user('b6');
select throws_ok($$ select set_billing_plan_month_target(date '2026-12-01', 1) $$, '42501', null, 'AC-MBP-006 an Engineer cannot set a month target');
-- AC-MBP-007: no direct writes; reads limited to the four roles and the organisation.
select throws_ok($$ insert into org_billing_plan_settings (org_id, monthly_target, target_currency, updated_by) values ('13750000-0000-0000-0000-0000000000a1', 1, 'IDR', '13750000-0000-0000-0000-0000000000b6') $$, '42501', null, 'AC-MBP-007 a client cannot insert settings directly');
select pg_temp.as_user('b2');
select throws_ok($$ update org_billing_plan_settings set monthly_target = 1 $$, '42501', null, 'AC-MBP-007 not even an Admin updates the table directly');
select throws_ok($$ delete from billing_plan_month_targets $$, '42501', null, 'AC-MBP-007 nor deletes month targets directly');
select pg_temp.as_user('b6');
select is((select count(*)::int from org_billing_plan_settings), 0, 'AC-MBP-007 an Engineer reads no settings');
select pg_temp.as_user('b4');
select is((select count(*)::int from org_billing_plan_settings), 1, 'AC-MBP-007 an Executive reads the settings');
select pg_temp.as_user('b9');
select is((select count(*)::int from org_billing_plan_settings), 0, 'AC-MBP-007 another organisation reads none of them');
reset role;
select is(has_function_privilege('anon', 'public.set_billing_plan_settings(numeric,text,boolean)', 'execute'), false, 'AC-MBP-006 anon cannot execute the settings writer');
select is(has_function_privilege('anon', 'public.set_billing_plan_month_target(date,numeric)', 'execute'), false, 'AC-MBP-006 anon cannot execute the month writer');
-- AC-MBP-008: validation.
select pg_temp.as_user('b1');
select throws_ok($$ select set_billing_plan_settings(100, null, false) $$, '23514', 'a monthly target needs a currency', 'AC-MBP-008 a target without a currency is refused');
select throws_ok($$ select set_billing_plan_settings(-1, 'IDR', false) $$, '23514', 'a monthly target is zero or more', 'AC-MBP-008 a negative target is refused');
select throws_ok($$ select set_billing_plan_settings(100, 'IDR', null) $$, '22023', 'the reminder must be on or off', 'AC-MBP-008 a null reminder is refused');
select is((select (set_billing_plan_settings(null, null, false)).monthly_target), null::numeric, 'AC-MBP-009 a null target is allowed (no target) and the reminder stays off');
select * from finish();
rollback;
