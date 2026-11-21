-- 1380_done_not_claimed_setting.test.sql — done-not-claimed alert setting (#2675). AC-DNC-006/007/011 (docs/specs/done-not-claimed-age.spec.md). Ids 13800000-… (synthetic).
-- Org a1: b1 finance, b2 admin, b3 project manager, b4 executive, b6 engineer. Org a2 (foreign): b9 finance.
begin;
create extension if not exists pgtap;
select plan(22);
insert into organizations (id, name, default_currency, default_timezone) values
  ('13800000-0000-0000-0000-0000000000a1', 'DNC Set A', 'IDR', 'UTC'), ('13800000-0000-0000-0000-0000000000a2', 'DNC Set B', 'IDR', 'UTC');
insert into auth.users (id, email) select ids.id, 'dnc-set-' || ids.n || '@example.invalid' from (values
  ('13800000-0000-0000-0000-0000000000b1'::uuid, 'fin'), ('13800000-0000-0000-0000-0000000000b2', 'adm'), ('13800000-0000-0000-0000-0000000000b3', 'pm'), ('13800000-0000-0000-0000-0000000000b4', 'exe'), ('13800000-0000-0000-0000-0000000000b6', 'eng'), ('13800000-0000-0000-0000-0000000000b9', 'ffin')) ids(id, n);
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13800000-0000-0000-0000-0000000000b1', '13800000-0000-0000-0000-0000000000a1', 'Set Finance', 'dnc-set-fin@example.invalid', 'Finance', 'active'),
  ('13800000-0000-0000-0000-0000000000b2', '13800000-0000-0000-0000-0000000000a1', 'Set Admin', 'dnc-set-adm@example.invalid', 'Admin', 'active'),
  ('13800000-0000-0000-0000-0000000000b3', '13800000-0000-0000-0000-0000000000a1', 'Set PM', 'dnc-set-pm@example.invalid', 'Project Manager', 'active'),
  ('13800000-0000-0000-0000-0000000000b4', '13800000-0000-0000-0000-0000000000a1', 'Set Exec', 'dnc-set-exe@example.invalid', 'Executive', 'active'),
  ('13800000-0000-0000-0000-0000000000b6', '13800000-0000-0000-0000-0000000000a1', 'Set Engineer', 'dnc-set-eng@example.invalid', 'Engineer', 'active'),
  ('13800000-0000-0000-0000-0000000000b9', '13800000-0000-0000-0000-0000000000a2', 'Set Foreign Finance', 'dnc-set-ffin@example.invalid', 'Finance', 'active');
insert into companies (id, org_id, name, type) values ('13800000-0000-0000-0000-0000000000cc', '13800000-0000-0000-0000-0000000000a1', 'DNC Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, client_id) values
  ('13800000-0000-0000-0000-0000000000c1', '13800000-0000-0000-0000-0000000000a1', 'DNC one', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, '13800000-0000-0000-0000-0000000000cc');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('13800000-0000-0000-0000-0000000000d1', '13800000-0000-0000-0000-0000000000a1', '13800000-0000-0000-0000-0000000000c1', 'DNC order', 'Issued', 7000, 'exclusive', 0, 'IDR');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"13800000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;

-- AC-DNC-006: Finance / Admin write; target and currency are untouched.
select pg_temp.as_user('b1');
select is((select (set_billing_plan_settings(5000000, 'idr', false)).monthly_target), 5000000::numeric, 'AC-DNC-007 the existing set_billing_plan_settings still works unchanged');
select results_eq($$ select (set_billing_plan_reminder(true, 14)).done_not_claimed_after_days $$, $$ values (14) $$, 'AC-DNC-006 Finance sets the reminder and the day limit');
select results_eq($$ select monthly_target, target_currency, done_not_claimed_reminder_on, done_not_claimed_after_days, org_id from org_billing_plan_settings $$,
  $$ values (5000000::numeric, 'IDR'::text, true, 14, '13800000-0000-0000-0000-0000000000a1'::uuid) $$, 'AC-DNC-006 stored with the caller organisation; target and currency unchanged');
select pg_temp.as_user('b2');
select is((select (set_billing_plan_reminder(false, null)).done_not_claimed_after_days), null::int, 'AC-DNC-006 an Admin switches it off and clears the limit (null = no limit)');
select is((select done_not_claimed_reminder_on from org_billing_plan_settings), false, 'AC-DNC-006 reminder off');
-- Refused roles.
select pg_temp.as_user('b3');
select throws_ok($$ select set_billing_plan_reminder(true, 5) $$, '42501', null, 'AC-DNC-006 a Project Manager cannot set it');
select pg_temp.as_user('b4');
select throws_ok($$ select set_billing_plan_reminder(true, 5) $$, '42501', null, 'AC-DNC-006 an Executive cannot set it');
select pg_temp.as_user('b6');
select throws_ok($$ select set_billing_plan_reminder(true, 5) $$, '42501', null, 'AC-DNC-006 an Engineer cannot set it');
select pg_temp.as_user('b2');
select is((select done_not_claimed_reminder_on from org_billing_plan_settings), false, 'AC-DNC-006 refused calls stored nothing');
reset role;
select is(has_function_privilege('anon', 'public.set_billing_plan_reminder(boolean,integer)', 'execute'), false, 'AC-DNC-006 anon cannot execute the reminder writer');
-- A first-time write creates the row for an org with none.
select pg_temp.as_user('b9');
select is((select (set_billing_plan_reminder(true, 3)).org_id), '13800000-0000-0000-0000-0000000000a2'::uuid, 'AC-DNC-006 a row is created for the caller organisation, stamped from the membership');
select pg_temp.as_user('b1');
select is((select count(*)::int from org_billing_plan_settings), 1, 'AC-DNC-006 the other organisation row is not visible');
-- AC-DNC-007: validation.
select throws_ok($$ select set_billing_plan_reminder(true, 0) $$, '23514', 'the limit is between 1 and 3650 days', 'AC-DNC-007 a limit of 0 is refused');
select throws_ok($$ select set_billing_plan_reminder(true, 3651) $$, '23514', 'the limit is between 1 and 3650 days', 'AC-DNC-007 a limit of 3651 is refused');
select throws_ok($$ select set_billing_plan_reminder(null, 5) $$, '22023', 'the reminder must be on or off', 'AC-DNC-007 a null switch is refused');
select is((select (set_billing_plan_reminder(true, 3650)).done_not_claimed_after_days), 3650, 'AC-DNC-007 3650 is accepted');
-- AC-DNC-011: the stamp table.
reset role;
insert into done_not_claimed_notices (org_id, work_order_id, boq_item_id) values ('13800000-0000-0000-0000-0000000000a1', '13800000-0000-0000-0000-0000000000d1', null);
select throws_ok($$ insert into done_not_claimed_notices (org_id, work_order_id, boq_item_id) values ('13800000-0000-0000-0000-0000000000a1', '13800000-0000-0000-0000-0000000000d1', null) $$, '23505', null, 'the stamp is unique per line (money-only order has a null contract line)');
select pg_temp.as_user('b6');
select throws_ok($$ insert into done_not_claimed_notices (org_id, work_order_id) values ('13800000-0000-0000-0000-0000000000a1', '13800000-0000-0000-0000-0000000000d1') $$, '42501', null, 'AC-DNC-011 a client cannot insert a stamp');
select is((select count(*)::int from done_not_claimed_notices), 0, 'AC-DNC-011 an Engineer reads no stamps');
select pg_temp.as_user('b2');
select throws_ok($$ delete from done_not_claimed_notices $$, '42501', null, 'AC-DNC-011 not even an Admin deletes stamps directly');
select is((select count(*)::int from done_not_claimed_notices), 1, 'AC-DNC-011 an Admin of the organisation reads its stamp');
select pg_temp.as_user('b9');
select is((select count(*)::int from done_not_claimed_notices), 0, 'AC-DNC-011 another organisation reads none');
select * from finish();
rollback;
