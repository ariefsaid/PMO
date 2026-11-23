-- 1691_equipment_manager_rights.test.sql — rental terms and rates, ending a rental period, working hours, targets and the
-- invoice-check read belong to the Equipment Manager job role, Admin, and a Project Manager holding no job role; Finance keeps
-- the rental-term and invoice-check rights (not hours or targets). Another manager-level job role (safety, HR) is refused.
-- Mutation check (recorded in the report): make equipment_manager_rights return true and the safety/HR refusals go red; restore.
begin;
create extension if not exists pgtap;
select plan(30);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('16910000-0000-0000-0000-00000000000a', 'EMR Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('16910000-0000-0000-0000-0000000000a1', 'emr-admin@example.com'),
  ('16910000-0000-0000-0000-0000000000a2', 'emr-fin@example.com'),
  ('16910000-0000-0000-0000-0000000000a3', 'emr-pm@example.com'),
  ('16910000-0000-0000-0000-0000000000a4', 'emr-eqm@example.com'),
  ('16910000-0000-0000-0000-0000000000a5', 'emr-safety@example.com'),
  ('16910000-0000-0000-0000-0000000000a6', 'emr-hr@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16910000-0000-0000-0000-0000000000a1', '16910000-0000-0000-0000-00000000000a', 'EMR Admin', 'emr-admin@example.com', 'Admin', 'active'),
  ('16910000-0000-0000-0000-0000000000a2', '16910000-0000-0000-0000-00000000000a', 'EMR Fin', 'emr-fin@example.com', 'Finance', 'active'),
  ('16910000-0000-0000-0000-0000000000a3', '16910000-0000-0000-0000-00000000000a', 'EMR PM', 'emr-pm@example.com', 'Project Manager', 'active');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('16910000-0000-0000-0000-0000000000a4', '16910000-0000-0000-0000-00000000000a', 'EMR Equipment Manager', 'emr-eqm@example.com', 'Project Manager', 'active', 'equipment_manager'),
  ('16910000-0000-0000-0000-0000000000a5', '16910000-0000-0000-0000-00000000000a', 'EMR Safety Manager', 'emr-safety@example.com', 'Project Manager', 'active', 'safety_manager'),
  ('16910000-0000-0000-0000-0000000000a6', '16910000-0000-0000-0000-00000000000a', 'EMR HR Manager', 'emr-hr@example.com', 'Project Manager', 'active', 'hr_manager');
insert into companies (id, org_id, name, type) values
  ('16910000-0000-0000-0000-0000000000e1', '16910000-0000-0000-0000-00000000000a', 'EMR Rental Co', 'Vendor');
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('16910000-0000-0000-0000-0000000000f1', '16910000-0000-0000-0000-00000000000a', 'EMR-1', 'Excavator', 'hours', 'owned'),
  ('16910000-0000-0000-0000-0000000000f2', '16910000-0000-0000-0000-00000000000a', 'EMR-2', 'Crane', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from) values
  ('16910000-0000-0000-0000-00000000000a', '16910000-0000-0000-0000-0000000000f2', '16910000-0000-0000-0000-0000000000e1', 300.00, 'day', 'IDR', '2026-09-01');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.term_json(p_asset uuid, p_from text) returns jsonb language sql as $$
  select jsonb_build_object('asset_id', p_asset, 'vendor_id', '16910000-0000-0000-0000-0000000000e1', 'rate', '150.00', 'basis', 'day',
                            'currency', 'IDR', 'rented_from', p_from);
$$;
set local role authenticated;

-- ── a Safety Manager and an HR Manager job role are refused (same access level as the Project Manager) ──
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a5');
select throws_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-05', 999) $$, '42501', 'not authorized',
  'a Safety Manager cannot change a rental rate');
select throws_ok($$ select set_equipment_targets(90, 60, 4) $$, '42501', 'not authorized', 'a Safety Manager cannot set the targets');
select throws_ok($$ select set_equipment_working_hours(7) $$, '42501', 'not authorized', 'a Safety Manager cannot set the working hours');
select throws_ok($$ select save_equipment_rental_term(pg_temp.term_json('16910000-0000-0000-0000-0000000000f1', '2026-09-01')) $$, '42501', 'not authorized',
  'a Safety Manager cannot add a rental period');
select throws_ok($$ select end_equipment_rental_term((select id from equipment_rental_terms where asset_id = '16910000-0000-0000-0000-0000000000f2' and rented_to is null), '2026-09-30') $$,
  '42501', 'not authorized', 'a Safety Manager cannot end a rental period');
select throws_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500) $$, '42501', 'not authorized',
  'a Safety Manager cannot open the invoice check');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a6');
select throws_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-05', 999) $$, '42501', 'not authorized',
  'an HR Manager cannot change a rental rate');
select throws_ok($$ select set_equipment_targets(90, 60, 4) $$, '42501', 'not authorized', 'an HR Manager cannot set the targets');
select throws_ok($$ select set_equipment_working_hours(7) $$, '42501', 'not authorized', 'an HR Manager cannot set the working hours');
select throws_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500) $$, '42501', 'not authorized',
  'an HR Manager cannot open the invoice check');
reset role;
select is((select rate from equipment_rental_terms where asset_id = '16910000-0000-0000-0000-0000000000f2' and rented_to is null), 300.00,
  'the refused calls changed no rate');
set local role authenticated;

-- ── a Project Manager holding no job role keeps the rights ──
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a3');
select lives_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-05', 310) $$, 'a Project Manager with no job role changes a rental rate');
select lives_ok($$ select set_equipment_targets(90, 60, 4) $$, 'a Project Manager with no job role sets the targets');
select lives_ok($$ select set_equipment_working_hours(7.5) $$, 'a Project Manager with no job role sets the working hours');
select lives_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500) $$,
  'a Project Manager with no job role opens the invoice check');
select throws_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$, '42501', 'not authorized',
  'a Project Manager with no job role cannot state a reason to include unproven days');

-- ── the Equipment Manager job role ──
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a4');
select lives_ok($$ select save_equipment_rental_term(pg_temp.term_json('16910000-0000-0000-0000-0000000000f1', '2026-09-01')) $$, 'an Equipment Manager adds a rental period');
select lives_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-06', 320) $$, 'an Equipment Manager changes a rental rate');
select lives_ok($$ select set_equipment_targets(80, 50, 3) $$, 'an Equipment Manager sets the targets');
select lives_ok($$ select set_equipment_working_hours(8) $$, 'an Equipment Manager sets the working hours');
select lives_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500) $$, 'an Equipment Manager opens the invoice check');
select throws_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$, '42501', 'not authorized',
  'an Equipment Manager cannot state a reason to include unproven days');
select lives_ok($$ select end_equipment_rental_term((select id from equipment_rental_terms where asset_id = '16910000-0000-0000-0000-0000000000f1' and rented_to is null), '2026-09-30') $$,
  'an Equipment Manager ends a rental period');

-- ── Admin and Finance as before ──
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a1');
select lives_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-07', 330) $$, 'Admin changes a rental rate');
select lives_ok($$ select set_equipment_targets(85, 55, 5) $$, 'Admin sets the targets');
select lives_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$,
  'Admin states a reason to include unproven days');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a2');
select lives_ok($$ select change_equipment_rental_rate('16910000-0000-0000-0000-0000000000f2', '2026-09-08', 340) $$, 'Finance changes a rental rate');
select throws_ok($$ select set_equipment_targets(80, 50, 3) $$, '42501', 'not authorized', 'Finance still cannot set the targets');
select throws_ok($$ select set_equipment_working_hours(6) $$, '42501', 'not authorized', 'Finance still cannot set the working hours');
select lives_ok($$ select equipment_rental_check('16910000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$,
  'Finance states a reason to include unproven days');

select * from finish();
rollback;
