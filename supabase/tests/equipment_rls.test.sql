-- equipment_rls.test.sql — 0447 (#1519 S1). Owns AC-EQU-012, entry half (docs/specs/equipment-usage.spec.md):
-- who reads entries and assets, no direct client writes (FR-EQU-063), cross-org refusal, archive and Admin-only
-- hard delete (FR-EQU-064). Fixture F1 is docs/plans/2026-11-01-equipment-usage.md "Fixture F1".
begin;
create extension if not exists pgtap;
select plan(38);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15190000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('15190000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15190000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('15190000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('15190000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('15190000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('15190000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('15190000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('15190000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('15190000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a1', '15190000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('15190000-0000-0000-0000-0000000000a2', '15190000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('15190000-0000-0000-0000-0000000000a3', '15190000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a4', '15190000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('15190000-0000-0000-0000-0000000000a5', '15190000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('15190000-0000-0000-0000-0000000000a6', '15190000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15190000-0000-0000-0000-0000000000c1', '15190000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000c2', '15190000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a4'),
  ('15190000-0000-0000-0000-0000000000c3', '15190000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '15190000-0000-0000-0000-0000000000a3'),
  ('15190000-0000-0000-0000-0000000000cb', '15190000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d2', '15190000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('15190000-0000-0000-0000-0000000000d3', '15190000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- approved usage straight into the table (superuser; allocation tests only — S1 tests drive the RPCs)
create or replace function pg_temp.usage(p_asset text, p_project text, p_date date, p_qty numeric, p_unit text,
                                         p_kind text default 'work', p_status text default 'Approved',
                                         p_fuel numeric default null, p_trips int default null) returns void language sql as $$
  insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, fuel_litres, trips,
                                       status, author_id, approver_id, approved_at)
  values ('15190000-0000-0000-0000-00000000000a', p_asset::uuid, p_project::uuid, p_date, p_qty, p_unit, p_kind, p_fuel, p_trips,
          p_status, '15190000-0000-0000-0000-0000000000a6',
          case when p_status in ('Approved','Rejected') then '15190000-0000-0000-0000-0000000000a3'::uuid end,
          case when p_status = 'Approved' then now() end);
$$;

-- entries seeded as superuser: Eng1 Approved on P1 (p1), Eng2 Approved on P2 (p2), Eng1 Submitted on P1 (s1)
create temp table _e (k text primary key, v uuid) on commit drop;
grant all on _e to authenticated;
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-0000000000c1', '2026-09-01', 5, 'hours');
insert into _e select 'p1', id from equipment_usage_entries where project_id = '15190000-0000-0000-0000-0000000000c1' and work_date = '2026-09-01';
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, status, author_id, approver_id, approved_at)
values ('15190000-0000-0000-0000-00000000000a', '15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-0000000000c2',
        '2026-09-02', 4, 'hours', 'Approved', '15190000-0000-0000-0000-0000000000a7', '15190000-0000-0000-0000-0000000000a4', now());
insert into _e select 'p2', id from equipment_usage_entries where project_id = '15190000-0000-0000-0000-0000000000c2' and work_date = '2026-09-02';
select pg_temp.usage('15190000-0000-0000-0000-0000000000d1', '15190000-0000-0000-0000-0000000000c1', '2026-09-03', 3, 'hours', 'work', 'Submitted');
insert into _e select 's1', id from equipment_usage_entries where project_id = '15190000-0000-0000-0000-0000000000c1' and work_date = '2026-09-03';
-- rows a statement touched, run as the calling role (RLS applies)
create or replace function pg_temp.rows(p_sql text) returns int language plpgsql as $$
declare n int; begin execute p_sql; get diagnostics n = row_count; return n; end $$;

select ok(not has_function_privilege('authenticated', 'public.equipment_usage_transition_core(uuid,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.equipment_can_approve(uuid,public.user_role,uuid,uuid)', 'execute'),
  'AC-EQU-012 the transition core and the approver check are not client-callable');
select ok(not has_table_privilege('authenticated', 'public.equipment_usage_entries', 'INSERT')
          and not has_table_privilege('authenticated', 'public.equipment_usage_entries', 'UPDATE'),
  'AC-EQU-012 clients hold no INSERT or UPDATE on entries (RPC only, PQ-8)');

set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1
select is((select count(*)::int from equipment_usage_entries), 2, 'AC-EQU-012 an Engineer reads only their own entries');
select is((select count(*)::int from equipment_assets), 4, 'AC-EQU-012 every active member reads the org''s asset reference');
select throws_ok($$ insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, status, author_id)
  values ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000d1','15190000-0000-0000-0000-0000000000c1',
          '2026-09-01', 1, 'hours', 'Approved', '15190000-0000-0000-0000-0000000000a6') $$, '42501', null,
  'AC-EQU-012 no direct INSERT on entries');
select throws_ok($$ update equipment_usage_entries set status = 'Approved' $$, '42501', null, 'AC-EQU-012 no direct UPDATE of status');
select throws_ok($$ insert into equipment_assets (code, name) values ('ENG-1','x') $$, '42501', null,
  'AC-EQU-012 an Engineer cannot create an asset reference');
select is(pg_temp.rows($$ update equipment_assets set name = 'renamed' $$), 0, 'AC-EQU-012 an Engineer cannot edit an asset reference');
select is(pg_temp.rows($$ delete from equipment_usage_entries $$), 0, 'AC-EQU-012 an Engineer cannot delete entries');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');   -- Eng2
select is((select count(*)::int from equipment_usage_entries), 1, 'AC-EQU-012 another Engineer reads only their one entry');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
select is((select count(*)::int from equipment_usage_entries), 3, 'AC-EQU-012 a PM reads the org''s usage');
select lives_ok($$ insert into equipment_assets (code, name, default_unit) values ('PMA-1','PM asset','days') $$,
  'AC-EQU-012 a PM creates a thin asset reference (FR-EQU-022)');
select is((select org_id from equipment_assets where code = 'PMA-1'), '15190000-0000-0000-0000-00000000000a'::uuid,
  'AC-EQU-012 org_id is stamped, never sent');
select is(pg_temp.rows($$ delete from equipment_assets where code = 'PMA-1' $$), 0, 'AC-EQU-012 a PM cannot delete an asset reference');
select is(pg_temp.rows($$ delete from equipment_usage_entries $$), 0, 'AC-EQU-012 a PM cannot hard-delete entries');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from equipment_usage_entries), 3, 'AC-EQU-012 Finance reads the org''s usage');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from equipment_usage_entries), 3, 'AC-EQU-012 an Executive reads the org''s usage');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000b1');   -- another org's Admin
select is((select count(*)::int from equipment_usage_entries), 0, 'AC-EQU-012 another org reads no entry');
select is((select count(*)::int from equipment_assets where org_id = '15190000-0000-0000-0000-00000000000a'), 0,
  'AC-EQU-012 another org reads no asset');
select throws_ok($$ select transition_equipment_usage((select v from _e where k = 'p1'), 'Approved') $$,
  '42501', null, 'AC-EQU-012 another org cannot move an entry (the definer re-asserts the org)');
select throws_ok($$ select transition_equipment_usage((select v from _e where k = 's1'), 'Approved') $$,
  '42501', null, 'AC-EQU-012 another org''s Admin cannot approve a submitted entry');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d9","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":1,"unit":"hours"}') $$,
  'P0002', null, 'AC-EQU-012 a foreign project cannot be targeted');
select throws_ok($$ select archive_equipment_usage((select v from _e where k = 's1')) $$,
  'P0002', null, 'AC-EQU-012 another org cannot archive an entry');
select throws_ok($$ select approve_equipment_usage_week('15190000-0000-0000-0000-0000000000d1', '2026-08-31') $$,
  'P0002', null, 'AC-EQU-012 another org cannot bulk-approve an asset week');

-- ── archive (FR-EQU-064) ───────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
insert into _e select 'a1', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d2",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-05","quantity":1,"unit":"days"}'::jsonb)->>'id')::uuid;
insert into _e select 'a2', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d2",
  "project_id":"15190000-0000-0000-0000-0000000000c2","work_date":"2026-09-05","quantity":1,"unit":"days"}'::jsonb)->>'id')::uuid;
select lives_ok($$ select archive_equipment_usage((select v from _e where k = 'a1')) $$, 'AC-EQU-012 the author archives their draft');
select is((select archived_at is not null from equipment_usage_entries where id = (select v from _e where k = 'a1')), true,
  'AC-EQU-012 an archived entry is kept, with archived_at set');
select throws_ok($$ select transition_equipment_usage((select v from _e where k = 'a1'), 'Submitted') $$,
  '22023', null, 'AC-EQU-012 an archived entry cannot move');
select throws_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='a1'),
  'asset_id','15190000-0000-0000-0000-0000000000d2','project_id','15190000-0000-0000-0000-0000000000c1',
  'work_date','2026-09-05','quantity',1,'unit','days')) $$, '22023', null, 'AC-EQU-012 an archived entry cannot be edited');
select lives_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d2","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-05","quantity":1,"unit":"days"}') $$,
  'AC-EQU-012 a new entry on the archived row''s asset, project, date and kind saves');
select throws_ok($$ select archive_equipment_usage((select v from _e where k = 's1')) $$,
  '42501', null, 'AC-EQU-012 the author cannot archive a submitted entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');
select throws_ok($$ select archive_equipment_usage((select v from _e where k = 'a2')) $$,
  '42501', null, 'AC-EQU-012 another Engineer cannot archive someone''s draft');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- Admin
select throws_ok($$ select archive_equipment_usage((select v from _e where k = 'p1')) $$,
  '22023', 'reopen approved usage before archiving it', 'AC-EQU-012 approved usage is not archived, even by an Admin');
select lives_ok($$ select archive_equipment_usage((select v from _e where k = 's1')) $$, 'AC-EQU-012 an Admin archives a submitted entry');
select is((select count(*)::int from audit_events where entity_id = (select v from _e where k = 'a1') and action = 'equipment_usage.archive'), 1,
  'AC-EQU-012 archiving writes an audit row');
select is(pg_temp.rows($$ delete from equipment_usage_entries where id = (select v from _e where k = 'p2') $$), 1,
  'AC-EQU-012 an Admin hard-deletes an entry');
select is((select count(*)::int from audit_events where entity_id = (select v from _e where k = 'p2') and action = 'equipment_usage.delete'), 1,
  'AC-EQU-012 the hard delete writes an audit row');

reset role;   -- a disabled author with a draft (the archive active-member gate)
insert into auth.users (id, email) values ('15190000-0000-0000-0000-0000000000a8', 'equ-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a8', '15190000-0000-0000-0000-00000000000a', 'EQU Gone', 'equ-gone@example.com', 'Engineer', 'disabled');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, status, author_id)
values ('15190000-0000-0000-0000-00000000000a', '15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-0000000000c1',
        '2026-09-06', 2, 'hours', 'Draft', '15190000-0000-0000-0000-0000000000a8');
insert into _e select 'g1', id from equipment_usage_entries where author_id = '15190000-0000-0000-0000-0000000000a8';
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a8');
select throws_ok($$ select archive_equipment_usage((select v from _e where k = 'g1')) $$,
  '42501', null, 'AC-EQU-012 a disabled author cannot archive their draft');

reset role;
select throws_ok($$ update equipment_usage_entries set approver_id = author_id where id = (select v from _e where k = 'p1') $$,
  '23514', null, 'AC-EQU-012 the table refuses approver = author even for a direct superuser write');

select * from finish();
rollback;
