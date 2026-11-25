-- equipment_officer_rental_terms.test.sql — the Equipment Officer registers a rented asset with its rental terms and edits the terms of an
-- asset in their own organisation (migration 2667, extends DD-R1124-17). Others stay refused; deletion stays Admin-only.
-- MUTATION (2667): make the officer test in create_rented_equipment_asset (mut:officer_register_rented) or in equipment_can_edit_terms
-- (mut:officer_edit_terms) false -> 'an officer registers a rented asset' / 'an officer saves a rental term' go red.
begin;
create extension if not exists pgtap;
select plan(12);

insert into organizations (id, name, built_in_roles_enabled) values
  ('26670000-0000-0000-0000-00000000000a', 'EOR Org', true),
  ('26670000-0000-0000-0000-00000000000b', 'EOR Other Org', true);
insert into auth.users (id, email) values
  ('26670000-0000-0000-0000-0000000000a1', 'eor-officer@example.com'),
  ('26670000-0000-0000-0000-0000000000a2', 'eor-eng@example.com'),
  ('26670000-0000-0000-0000-0000000000a3', 'eor-store@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26670000-0000-0000-0000-0000000000a1', '26670000-0000-0000-0000-00000000000a', 'EOR Officer', 'eor-officer@example.com', 'Engineer', 'active', 'equipment_officer'),
  ('26670000-0000-0000-0000-0000000000a2', '26670000-0000-0000-0000-00000000000a', 'EOR Eng', 'eor-eng@example.com', 'Engineer', 'active', null),
  ('26670000-0000-0000-0000-0000000000a3', '26670000-0000-0000-0000-00000000000a', 'EOR Store', 'eor-store@example.com', 'Engineer', 'active', 'storekeeper');
insert into companies (id, org_id, name, type) values
  ('26670000-0000-0000-0000-0000000000d1', '26670000-0000-0000-0000-00000000000a', 'EOR Hire', 'Vendor'),
  ('26670000-0000-0000-0000-0000000000d2', '26670000-0000-0000-0000-00000000000b', 'EOR Other Hire', 'Vendor');
insert into equipment_assets (id, org_id, code, name) values
  ('26670000-0000-0000-0000-0000000000e1', '26670000-0000-0000-0000-00000000000a', 'EOR-OWN', 'Owned asset');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
set local role authenticated;

select pg_temp._as('26670000-0000-0000-0000-0000000000a1');
select lives_ok($$ select create_rented_equipment_asset('EOR-1', 'Rented crane', 'hours', '26670000-0000-0000-0000-0000000000d1', 900000, 'day', 'IDR', '2026-09-01') $$,
  'an officer registers a rented asset with vendor, rate, basis, currency and dates');
select lives_ok($$ select save_equipment_rental_term(jsonb_build_object('asset_id', '26670000-0000-0000-0000-0000000000e1', 'vendor_id', '26670000-0000-0000-0000-0000000000d1',
  'rate', 500000, 'basis', 'month', 'currency', 'IDR', 'rented_from', '2026-10-01')) $$, 'an officer saves a rental term');
select throws_ok($$ select create_rented_equipment_asset('EOR-2', 'Cross org', 'hours', '26670000-0000-0000-0000-0000000000d2', 1000, 'day', 'IDR', '2026-09-01') $$,
  'P0002', 'vendor not found', 'an officer cannot name another organisation''s vendor');
select lives_ok($$ delete from equipment_assets where id = '26670000-0000-0000-0000-0000000000e1' $$, 'an officer''s delete is filtered by row security, not errored');

select is((select count(*)::int from equipment_rental_terms), 2, 'an officer reads the rental terms of their own organisation');
select pg_temp._as('26670000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from equipment_rental_terms), 0, 'an engineer with no job role reads no rental term');
select throws_ok($$ select create_rented_equipment_asset('EOR-3', 'No role', 'hours', '26670000-0000-0000-0000-0000000000d1', 1000, 'day', 'IDR', '2026-09-01') $$,
  '42501', 'not authorized', 'an engineer with no job role cannot register a rented asset');
select throws_ok($$ select save_equipment_rental_term(jsonb_build_object('asset_id', '26670000-0000-0000-0000-0000000000e1', 'vendor_id', '26670000-0000-0000-0000-0000000000d1',
  'rate', 500000, 'basis', 'month', 'currency', 'IDR', 'rented_from', '2027-01-01')) $$, '42501', 'not authorized', 'an engineer with no job role cannot save a rental term');
select pg_temp._as('26670000-0000-0000-0000-0000000000a3');
select throws_ok($$ select create_rented_equipment_asset('EOR-4', 'Store', 'hours', '26670000-0000-0000-0000-0000000000d1', 1000, 'day', 'IDR', '2026-09-01') $$,
  '42501', 'not authorized', 'another job role cannot register a rented asset');
reset role;
select is((select count(*)::int from equipment_assets where id = '26670000-0000-0000-0000-0000000000e1'), 1, 'an officer cannot delete an asset');
select is((select count(*)::int from equipment_rental_terms where org_id = '26670000-0000-0000-0000-00000000000a'), 2, 'only the officer''s two terms were written');
select is((select count(*)::int from equipment_assets where code in ('EOR-3', 'EOR-4', 'EOR-2')), 0, 'no refused registration left an asset');

select * from finish();
rollback;
