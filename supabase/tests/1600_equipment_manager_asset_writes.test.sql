-- 1600_equipment_manager_asset_writes.test.sql — the equipment manager (Project Manager) writes assets' rental terms, working
-- hours and targets, and READS the rental invoice check; the invoice check's state-changing path (a stated reason) and the
-- costing stay with Admin and Finance. Mutation check (recorded in the report): set the PM exclusion in equipment_rental_check
-- back to allow a reason, or drop 'Project Manager' from equipment_can_edit_terms, and the matching assertion turns red; restore.
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name, default_currency, default_timezone) values
  ('16000000-0000-0000-0000-00000000000a', 'EMW Org A', 'IDR', 'UTC'),
  ('16000000-0000-0000-0000-00000000000b', 'EMW Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('16000000-0000-0000-0000-0000000000a1', 'emw-admin@example.com'),
  ('16000000-0000-0000-0000-0000000000a2', 'emw-fin@example.com'),
  ('16000000-0000-0000-0000-0000000000a3', 'emw-pm@example.com'),
  ('16000000-0000-0000-0000-0000000000a4', 'emw-eng@example.com'),
  ('16000000-0000-0000-0000-0000000000a5', 'emw-exec@example.com'),
  ('16000000-0000-0000-0000-0000000000b3', 'emw-b-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16000000-0000-0000-0000-0000000000a1', '16000000-0000-0000-0000-00000000000a', 'EMW Admin', 'emw-admin@example.com', 'Admin', 'active'),
  ('16000000-0000-0000-0000-0000000000a2', '16000000-0000-0000-0000-00000000000a', 'EMW Fin', 'emw-fin@example.com', 'Finance', 'active'),
  ('16000000-0000-0000-0000-0000000000a3', '16000000-0000-0000-0000-00000000000a', 'EMW PM', 'emw-pm@example.com', 'Project Manager', 'active'),
  ('16000000-0000-0000-0000-0000000000a4', '16000000-0000-0000-0000-00000000000a', 'EMW Eng', 'emw-eng@example.com', 'Engineer', 'active'),
  ('16000000-0000-0000-0000-0000000000a5', '16000000-0000-0000-0000-00000000000a', 'EMW Exec', 'emw-exec@example.com', 'Executive', 'active'),
  ('16000000-0000-0000-0000-0000000000b3', '16000000-0000-0000-0000-00000000000b', 'EMW B PM', 'emw-b-pm@example.com', 'Project Manager', 'active');
insert into companies (id, org_id, name, type) values
  ('16000000-0000-0000-0000-0000000000e1', '16000000-0000-0000-0000-00000000000a', 'EMW Rental Co', 'Vendor');
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('16000000-0000-0000-0000-0000000000f1', '16000000-0000-0000-0000-00000000000a', 'EMW-1', 'Excavator', 'hours', 'owned'),
  ('16000000-0000-0000-0000-0000000000f2', '16000000-0000-0000-0000-00000000000a', 'EMW-2', 'Crane', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from) values
  ('16000000-0000-0000-0000-00000000000a', '16000000-0000-0000-0000-0000000000f2', '16000000-0000-0000-0000-0000000000e1', 300.00, 'day', 'IDR', '2026-09-01');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.term_json(p_asset uuid, p_from text) returns jsonb language sql as $$
  select jsonb_build_object('asset_id', p_asset, 'vendor_id', '16000000-0000-0000-0000-0000000000e1', 'rate', '150.00', 'basis', 'day',
                            'currency', 'IDR', 'rented_from', p_from);
$$;
set local role authenticated;

-- ── rental terms: the Project Manager adds, changes the rate and ends a period ──
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select save_equipment_rental_term(pg_temp.term_json('16000000-0000-0000-0000-0000000000f1', '2026-09-01')) $$,
  'AC-EQM-001 a Project Manager adds a rental period to an asset');
select is((select ownership from equipment_assets where id = '16000000-0000-0000-0000-0000000000f1'), 'rented',
  'AC-EQM-001 the asset becomes rented');
select lives_ok($$ select change_equipment_rental_rate('16000000-0000-0000-0000-0000000000f1', '2026-09-15', 200) $$,
  'AC-EQM-001 a Project Manager changes the rate from a date');
select lives_ok($$ select end_equipment_rental_term((select id from equipment_rental_terms where asset_id = '16000000-0000-0000-0000-0000000000f1' and rented_to is null), '2026-09-30') $$,
  'AC-EQM-001 a Project Manager ends a rental period');

-- ── the others stay out ──
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select save_equipment_rental_term(pg_temp.term_json('16000000-0000-0000-0000-0000000000f2', '2026-10-01')) $$, '42501', 'not authorized',
  'AC-EQM-002 an Engineer cannot add a rental period');
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a5');
select throws_ok($$ select save_equipment_rental_term(pg_temp.term_json('16000000-0000-0000-0000-0000000000f2', '2026-10-01')) $$, '42501', 'not authorized',
  'AC-EQM-002 an Executive cannot add a rental period');
-- another organisation's Project Manager reaches nothing here
select pg_temp.act_as('16000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select save_equipment_rental_term(pg_temp.term_json('16000000-0000-0000-0000-0000000000f2', '2026-10-01')) $$, 'P0002', 'asset not found',
  'AC-EQM-002 a Project Manager of another organisation cannot add a period to this asset');

-- ── working hours and targets ──
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select set_equipment_working_hours(7.5) $$, 'AC-EQM-003 a Project Manager sets the working hours per day');
select is((select equipment_working_hours from organizations where id = '16000000-0000-0000-0000-00000000000a'), 7.5,
  'AC-EQM-003 the working hours are stored');
select lives_ok($$ select set_equipment_targets(90, 60, 4) $$, 'AC-EQM-003 a Project Manager sets the targets and the escalation limit');
select is((select equipment_escalation_down_days from organizations where id = '16000000-0000-0000-0000-00000000000a'), 4,
  'AC-EQM-003 the escalation limit is stored');
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_equipment_working_hours(6) $$, '42501', 'not authorized', 'AC-EQM-004 Finance cannot set the working hours');
select throws_ok($$ select set_equipment_targets(80, 50, 3) $$, '42501', 'not authorized', 'AC-EQM-004 Finance cannot set the targets');
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_equipment_working_hours(6) $$, '42501', 'not authorized', 'AC-EQM-004 an Engineer cannot set the working hours');

-- ── the rental invoice check: the manager reads it, never states a reason ──
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a3');
select is((select (equipment_rental_check('16000000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500)->>'expected_amount')),
  '3000.00', 'AC-EQM-005 a Project Manager reads the invoice check result (10 days at 300)');
select throws_ok($$ select equipment_rental_check('16000000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$,
  '42501', 'not authorized', 'AC-EQM-005 a Project Manager cannot include unproven days with a reason');
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a4');
select throws_ok($$ select equipment_rental_check('16000000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500) $$,
  '42501', 'not authorized', 'AC-EQM-005 an Engineer cannot open the check');
select pg_temp.act_as('16000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select equipment_rental_check('16000000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-10', 3500, 'vendor was right') $$,
  'AC-EQM-005 Finance still includes unproven days with a reason');
reset role;
select is((select count(*)::int from equipment_rental_checks where asset_id = '16000000-0000-0000-0000-0000000000f2'), 1,
  'AC-EQM-005 only the Finance reason was stored; the refused Project Manager call stored nothing');

select * from finish();
rollback;
