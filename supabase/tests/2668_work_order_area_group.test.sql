-- 2668_work_order_area_group.test.sql — #2668 (docs/specs/work-order-area-group.spec.md).
-- Migrations under test: 1382_work_order_areas_groups.sql, 1383_work_orders_area_group.sql, 1384_work_order_area_group_guard.sql.
-- AC-WAG-001 Admin-only list, org-scoped reads, unique live code · AC-WAG-002 an area/group of another org is refused ·
-- AC-WAG-003 an archived entry cannot be newly named, an existing one is kept · AC-WAG-004 a named entry cannot be hard-deleted. Area/group are written only by set_work_order_area_group (1384).
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name, default_currency) values
  ('26680000-0000-0000-0000-00000000000a', 'WAG Org',       'IDR'),
  ('26680000-0000-0000-0000-00000000000b', 'WAG Other Org', 'IDR');
insert into auth.users (id, email) values
  ('26680000-0000-0000-0000-0000000000a1', 'wag-admin@example.com'),
  ('26680000-0000-0000-0000-0000000000a3', 'wag-pm@example.com'),
  ('26680000-0000-0000-0000-0000000000a4', 'wag-eng@example.com'),
  ('26680000-0000-0000-0000-0000000000b1', 'wag-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26680000-0000-0000-0000-0000000000a1', '26680000-0000-0000-0000-00000000000a', 'WAG Admin', 'wag-admin@example.com', 'Admin', 'active'),
  ('26680000-0000-0000-0000-0000000000a3', '26680000-0000-0000-0000-00000000000a', 'WAG PM',    'wag-pm@example.com',    'Project Manager', 'active'),
  ('26680000-0000-0000-0000-0000000000a4', '26680000-0000-0000-0000-00000000000a', 'WAG Eng',   'wag-eng@example.com',   'Engineer', 'active'),
  ('26680000-0000-0000-0000-0000000000b1', '26680000-0000-0000-0000-00000000000b', 'WAG XOrg',  'wag-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26680000-0000-0000-0000-0000000000d1', '26680000-0000-0000-0000-00000000000a', 'WAG Site', 'Ongoing Project', '26680000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26680000-0000-0000-0000-000000000401', '26680000-0000-0000-0000-00000000000a', '26680000-0000-0000-0000-0000000000d1', 'WAG WO one', 'Draft', 0, 'exclusive', 0),
  ('26680000-0000-0000-0000-000000000402', '26680000-0000-0000-0000-00000000000a', '26680000-0000-0000-0000-0000000000d1', 'WAG WO two', 'Draft', 0, 'exclusive', 0);
insert into work_order_areas (id, org_id, code, name, archived_at) values
  ('26680000-0000-0000-0000-000000000501', '26680000-0000-0000-0000-00000000000a', 'N1',  'North',   null),
  ('26680000-0000-0000-0000-000000000502', '26680000-0000-0000-0000-00000000000a', 'OLD', 'Retired', now()),
  ('26680000-0000-0000-0000-000000000509', '26680000-0000-0000-0000-00000000000b', 'X1',  'Other',   null);
insert into work_order_groups (id, org_id, code, name, archived_at) values
  ('26680000-0000-0000-0000-000000000601', '26680000-0000-0000-0000-00000000000a', 'G1',  'Operations', null),
  ('26680000-0000-0000-0000-000000000602', '26680000-0000-0000-0000-00000000000a', 'GOLD', 'Retired',   now()),
  ('26680000-0000-0000-0000-000000000609', '26680000-0000-0000-0000-00000000000b', 'GX',  'Other',      null);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- AC-WAG-001
select pg_temp.act_as('26680000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into public.work_order_areas (code, name) values ('S1', 'South') $$,
  '42501', 'new row violates row-level security policy for table "work_order_areas"', 'AC-WAG-001 a Project Manager cannot add an area');
select throws_ok($$ insert into public.work_order_groups (code, name) values ('G2', 'Maintenance') $$,
  '42501', 'new row violates row-level security policy for table "work_order_groups"', 'AC-WAG-001 a Project Manager cannot add a group');
select is((select count(*)::int from public.work_order_areas), 2, 'AC-WAG-001 a member reads the org''s areas, none of another org''s');
select pg_temp.act_as('26680000-0000-0000-0000-0000000000a1');
select lives_ok($$ insert into public.work_order_areas (code, name) values ('S1', 'South') $$, 'AC-WAG-001 an Admin adds an area');
select is((select org_id from public.work_order_areas where code = 'S1'), '26680000-0000-0000-0000-00000000000a'::uuid, 'AC-WAG-001 the org is stamped from the session');
select throws_ok($$ insert into public.work_order_areas (code, name) values (' s1 ', 'South again') $$,
  '23505', 'duplicate key value violates unique constraint "work_order_areas_code_live"', 'AC-WAG-001 a duplicate live code is refused');
select lives_ok($$ insert into public.work_order_areas (code, name) values ('OLD', 'Reused code') $$, 'AC-WAG-001 an archived code can be reused');
select lives_ok($$ insert into public.work_order_groups (code, name) values ('G2', 'Maintenance') $$, 'AC-WAG-001 an Admin adds a group');
select pg_temp.act_as('26680000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.work_order_areas), 1, 'AC-WAG-001 another org sees only its own area');

-- AC-WAG-002 / 003 through the one writer, as the project's Project Manager
select pg_temp.act_as('26680000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000401', '26680000-0000-0000-0000-000000000501', '26680000-0000-0000-0000-000000000601') $$, 'AC-WAG-002 a work order takes its own org''s area and group');
select is((select area_id from public.work_orders where id = '26680000-0000-0000-0000-000000000401'), '26680000-0000-0000-0000-000000000501'::uuid, 'AC-WAG-002 the area is stored');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', '26680000-0000-0000-0000-000000000509', null, true, false) $$,
  '23503', null, 'AC-WAG-002 another org''s area is refused');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', null, '26680000-0000-0000-0000-000000000609', false, true) $$,
  '23503', null, 'AC-WAG-002 another org''s group is refused');
select lives_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', null, null) $$, 'AC-WAG-002 no area and no group is valid');
select lives_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000401', null, null, false, true) $$, 'AC-WAG-002 clearing only the group leaves the area');
select is((select area_id from public.work_orders where id = '26680000-0000-0000-0000-000000000401'), '26680000-0000-0000-0000-000000000501'::uuid, 'AC-WAG-002 the area is untouched when only the group is set');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', '26680000-0000-0000-0000-000000000502', null, true, false) $$,
  '23514', 'WO_AREA_ARCHIVED: the work order area is archived', 'AC-WAG-003 an archived area cannot be newly named');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', null, '26680000-0000-0000-0000-000000000602', false, true) $$,
  '23514', 'WO_GROUP_ARCHIVED: the work order group is archived', 'AC-WAG-003 an archived group cannot be newly named');

-- the columns are not directly writable (0193's grant lists stay as they were)
select throws_ok($$ update public.work_orders set area_id = '26680000-0000-0000-0000-000000000501' where id = '26680000-0000-0000-0000-000000000402' $$,
  '42501', null, 'AC-WAG-002 a direct update of area_id is refused by the grant');

-- role refusal, org check
select pg_temp.act_as('26680000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', '26680000-0000-0000-0000-000000000501', null) $$,
  '42501', 'only an Admin, Executive, Project Manager or Finance member can set a work order''s area or group', 'AC-WAG-002 an Engineer cannot set a work order''s area');
select pg_temp.act_as('26680000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000402', null, null) $$,
  'P0002', 'work order not found', 'AC-WAG-002 another org''s Admin cannot reach this org''s work order');

-- AC-WAG-003 keep + AC-WAG-004 (as Admin)
select pg_temp.act_as('26680000-0000-0000-0000-0000000000a1');
select lives_ok($$ update public.work_order_areas set archived_at = now() where id = '26680000-0000-0000-0000-000000000501' $$, 'AC-WAG-004 an Admin archives an area that is in use');
select lives_ok($$ select public.set_work_order_area_group('26680000-0000-0000-0000-000000000401', '26680000-0000-0000-0000-000000000501', null, true, false) $$, 'AC-WAG-003 a work order keeps (re-saves) an area that was archived after it was named');
select throws_ok($$ delete from public.work_order_areas where id = '26680000-0000-0000-0000-000000000501' $$,
  '23503', null, 'AC-WAG-004 an area a work order names cannot be deleted');

select * from finish();
rollback;
