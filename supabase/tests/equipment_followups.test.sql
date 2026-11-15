-- equipment_followups.test.sql — 0878 (#1649). Each case fails on the schema without 0878: decision-note and fuel
-- validation codes, the asset audit trail, a draft on an archived asset, the delete-audit search_path.
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name, default_currency, default_timezone) values ('16490000-0000-0000-0000-00000000000a', 'FU Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('16490000-0000-0000-0000-0000000000a1', 'fu-admin@example.com'),
  ('16490000-0000-0000-0000-0000000000a3', 'fu-pm@example.com'),
  ('16490000-0000-0000-0000-0000000000a6', 'fu-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16490000-0000-0000-0000-0000000000a1', '16490000-0000-0000-0000-00000000000a', 'FU Admin', 'fu-admin@example.com', 'Admin', 'active'),
  ('16490000-0000-0000-0000-0000000000a3', '16490000-0000-0000-0000-00000000000a', 'FU PM',    'fu-pm@example.com',    'Project Manager', 'active'),
  ('16490000-0000-0000-0000-0000000000a6', '16490000-0000-0000-0000-00000000000a', 'FU Eng',   'fu-eng@example.com',   'Engineer', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16490000-0000-0000-0000-0000000000c1', '16490000-0000-0000-0000-00000000000a', 'FU P1', 'Ongoing Project', '16490000-0000-0000-0000-0000000000a3');
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('16490000-0000-0000-0000-0000000000d1', '16490000-0000-0000-0000-00000000000a', 'FU-1', 'Loader', 'hours'),
  ('16490000-0000-0000-0000-0000000000d2', '16490000-0000-0000-0000-00000000000a', 'FU-2', 'Truck', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table _e (k text primary key, v uuid) on commit drop;
grant all on _e to authenticated;
set local role authenticated;

-- ── item 1: decision note over 500 characters ──
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a6');
insert into _e select 'e1', (save_equipment_usage('{"asset_id":"16490000-0000-0000-0000-0000000000d1",
  "project_id":"16490000-0000-0000-0000-0000000000c1","work_date":"2026-09-10","quantity":2,"unit":"hours"}'::jsonb)->>'id')::uuid;
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Submitted') $$, 'AC-EQU-007 #1649 the draft submits');
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a3');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Rejected', repeat('x', 501)) $$,
  '22023', 'the decision note is at most 500 characters', 'AC-EQU-007 #1649 a 501-character decision note is a validation error');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Rejected', repeat('x', 500)) $$,
  'AC-EQU-007 #1649 a 500-character decision note is accepted');

-- ── item 2: fuel overflow ──
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a6');
select throws_ok($$ select save_equipment_usage('{"asset_id":"16490000-0000-0000-0000-0000000000d1","project_id":"16490000-0000-0000-0000-0000000000c1",
  "work_date":"2026-09-11","quantity":1,"unit":"hours","fuel_litres":100000000}') $$,
  '22023', 'fuel litres must be less than 100,000,000', 'AC-EQU-007 #1649 a fuel overflow is a validation error');
select lives_ok($$ select save_equipment_usage('{"asset_id":"16490000-0000-0000-0000-0000000000d1","project_id":"16490000-0000-0000-0000-0000000000c1",
  "work_date":"2026-09-11","quantity":1,"unit":"hours","fuel_litres":99999999.99}') $$, 'AC-EQU-007 #1649 the largest fuel value saves');

-- ── item 4: asset audit trail (audit_events is read as the superuser; the writes run as the real roles) ──
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a3');
insert into equipment_assets (code, name) values ('FU-9', 'Roller');
update equipment_assets set name = 'Roller 2' where code = 'FU-9';
update equipment_assets set archived_at = now() where code = 'FU-9';
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a1');
delete from equipment_assets where code = 'FU-9';
reset role;
select is((select count(*)::int from audit_events where action = 'equipment_asset.create' and detail->>'code' = 'FU-9'), 1,
  'AC-EQU-012 #1649 creating an asset writes an audit row');
select is((select count(*)::int from audit_events where action = 'equipment_asset.rename' and detail->'after'->>'name' = 'Roller 2'), 1,
  'AC-EQU-012 #1649 renaming an asset writes an audit row');
select is((select count(*)::int from audit_events where action = 'equipment_asset.archive' and detail->>'code' = 'FU-9'), 1,
  'AC-EQU-012 #1649 archiving an asset writes an audit row');
select is((select count(*)::int from audit_events where action = 'equipment_asset.rename' and detail->'after'->>'code' = 'FU-9'), 1,
  'AC-EQU-012 #1649 archiving alone is not also logged as a rename');
select is((select count(*)::int from audit_events where action = 'equipment_asset.delete' and detail->>'code' = 'FU-9'), 1,
  'AC-EQU-012 #1649 deleting an asset writes an audit row');
select is((select actor_id from audit_events where action = 'equipment_asset.delete' and detail->>'code' = 'FU-9'),
  '16490000-0000-0000-0000-0000000000a1'::uuid, 'AC-EQU-012 #1649 the audit row records the acting user');
set local role authenticated;

-- ── item 5: a draft on an archived asset ──
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a6');
insert into _e select 'd2', (save_equipment_usage('{"asset_id":"16490000-0000-0000-0000-0000000000d2",
  "project_id":"16490000-0000-0000-0000-0000000000c1","work_date":"2026-09-12","quantity":2,"unit":"hours"}'::jsonb)->>'id')::uuid;
reset role;
update equipment_assets set archived_at = now() where id = '16490000-0000-0000-0000-0000000000d2';
set local role authenticated;
select pg_temp.act_as('16490000-0000-0000-0000-0000000000a6');
select lives_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='d2'),
  'asset_id','16490000-0000-0000-0000-0000000000d2','project_id','16490000-0000-0000-0000-0000000000c1',
  'work_date','2026-09-12','quantity',3,'unit','hours')) $$, 'AC-EQU-007 #1649 the author edits a draft on an archived asset');
select is((select quantity from equipment_usage_entries where id = (select v from _e where k='d2')), 3.00::numeric,
  'AC-EQU-007 #1649 the edit is stored');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='d2'), 'Submitted') $$,
  'AC-EQU-007 #1649 the author submits a draft on an archived asset');
select throws_ok($$ select save_equipment_usage('{"asset_id":"16490000-0000-0000-0000-0000000000d2","project_id":"16490000-0000-0000-0000-0000000000c1",
  "work_date":"2026-09-13","quantity":1,"unit":"hours"}') $$, 'P0002', 'asset not found',
  'AC-EQU-007 #1649 new usage on an archived asset is still refused');

-- ── item 6: search_path ──
reset role;
select ok((select proconfig::text from pg_proc where proname = 'audit_equipment_usage_delete') like '%pg_temp%',
  'AC-EQU-012 #1649 the delete-audit trigger function pins pg_temp');

select * from finish();
rollback;
