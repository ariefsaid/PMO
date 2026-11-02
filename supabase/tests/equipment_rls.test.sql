-- equipment_rls.test.sql — 0447 (#1519 S1). Owns AC-EQU-012, entry half (docs/specs/equipment-usage.spec.md):
-- who reads entries and assets, no direct client writes (FR-EQU-063), cross-org refusal, archive and Admin-only
-- hard delete (FR-EQU-064). Fixture F1 is docs/plans/2026-11-01-equipment-usage.md "Fixture F1".
begin;
create extension if not exists pgtap;
select plan(72);

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


-- ── S2 (0460): costing settings audience, AC-EQU-012 settings half ───────────────────────────────────
-- Approved usage the S2 reads can see: EXC-1 2 h (priced at 50/h below), and the foreign org's own asset 7 h.
select pg_temp.usage('15190000-0000-0000-0000-0000000000d4', '15190000-0000-0000-0000-0000000000c1', '2026-09-10', 2, 'hours');
insert into auth.users (id, email) values ('15190000-0000-0000-0000-0000000000b2', 'equ-xorg2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000b2', '15190000-0000-0000-0000-00000000000b', 'EQU XOrg2', 'equ-xorg2@example.com', 'Admin', 'active');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, status, author_id, approver_id, approved_at)
values ('15190000-0000-0000-0000-00000000000b', '15190000-0000-0000-0000-0000000000d9', '15190000-0000-0000-0000-0000000000cb',
        '2026-09-12', 7, 'hours', 'Approved', '15190000-0000-0000-0000-0000000000b1', '15190000-0000-0000-0000-0000000000b2', now());
-- a disabled Finance member (the active-member gate on end_equipment_costing: the role alone would let them through)
insert into auth.users (id, email) values ('15190000-0000-0000-0000-0000000000a9', 'equ-gonefin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a9', '15190000-0000-0000-0000-00000000000a', 'EQU GoneFin', 'equ-gonefin@example.com', 'Finance', 'disabled');
-- Money setting is separated from usage approval: a PM approves hours but never sets what an hour is worth.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('15190000-0000-0000-0000-00000000000a','Equipment','Depreciation - EQ',true);
create temp table _k (k text primary key, v jsonb) on commit drop;
grant all on _k to authenticated;
set local role authenticated;
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  '42501', 'not authorized', 'AC-EQU-012 a PM approves hours but cannot save a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');   -- Executive
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  '42501', 'not authorized', 'AC-EQU-012 an Executive cannot save a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  '42501', 'not authorized', 'AC-EQU-012 an Engineer cannot save a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a8');   -- disabled Engineer
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2026-01-01"}') $$,
  '42501', null, 'AC-EQU-012 a disabled member cannot save a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance
select lives_ok($$ insert into _k select 'f', save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  'AC-EQU-012 Finance saves a costing setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- Admin
select lives_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d3","basis":"hire_rate","work_rate":50,"rate_unit":"hours","effective_from":"2026-01-01"}') $$,
  'AC-EQU-012 an Admin saves a costing setting');
select throws_ok($$ insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, effective_from)
  values ('15190000-0000-0000-0000-00000000000a','15190000-0000-0000-0000-0000000000d1',gen_random_uuid(),1,'none','2026-01-01') $$,
  '42501', null, 'AC-EQU-012 no direct INSERT on settings, even for an Admin');
select throws_ok($$ update equipment_costing_settings set work_rate = 1 $$, '42501', null, 'AC-EQU-012 no direct UPDATE on settings');
select throws_ok($$ delete from equipment_costing_settings $$, '42501', null, 'AC-EQU-012 no direct DELETE on settings');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1
select throws_ok($$ select end_equipment_costing((select (v->>'setting_key')::uuid from _k where k='f'),'2026-12-31',1) $$,
  '42501', 'not authorized', 'AC-EQU-012 a PM cannot end a costing setting');
select throws_ok($$ select * from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2026-01-01"}') $$,
  '42501', 'not authorized', 'AC-EQU-012 a PM cannot preview a costing setting');
select is((select count(*)::int from list_equipment_costing()), 2, 'AC-EQU-012 a PM reads the costing settings');
select is((select count(*)::int from equipment_costing_settings), 2, 'AC-EQU-012 a PM reads the settings table');
select is((select amount from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-09-01','2026-09-30')), 100.00::numeric,
  'AC-EQU-012 a PM reads amounts (2 h × 50)');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')
            where status = 'usage_only' and amount is null), 1, 'AC-EQU-012 a PM reads usage-only rows with no amount');
select is((select sum(work_units) from list_equipment_usage_totals(null,'15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')),
  5.00::numeric, 'AC-EQU-012 the home org reads its approved usage totals (the cross-org rows below are not vacuous)');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from list_equipment_costing()), 2, 'AC-EQU-012 an Executive reads the costing settings');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1
select throws_ok($$ select * from list_equipment_costing() $$, '42501', 'not authorized', 'AC-EQU-012 an Engineer cannot list costing settings');
select throws_ok($$ select * from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30') $$,
  '42501', 'not authorized', 'AC-EQU-012 an Engineer cannot read allocation amounts');
select throws_ok($$ select * from preview_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2026-01-01"}') $$,
  '42501', 'not authorized', 'AC-EQU-012 an Engineer cannot preview a costing setting');
select is((select count(*)::int from equipment_costing_settings), 0, 'AC-EQU-012 an Engineer reads no settings row');
select lives_ok($$ select * from list_equipment_usage_totals('15190000-0000-0000-0000-0000000000c1', null, '2026-09-01', '2026-09-30') $$,
  'AC-EQU-012 an Engineer reads usage totals');
select ok(pg_get_function_result('list_equipment_usage_totals(uuid,uuid,date,date)'::regprocedure) not like '%amount%',
  'AC-EQU-012 the usage totals an Engineer reads carry no amount column');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a8');   -- disabled
select throws_ok($$ select * from list_equipment_usage_totals('15190000-0000-0000-0000-0000000000c1', null, '2026-09-01', '2026-09-30') $$,
  '42501', null, 'AC-EQU-012 a disabled member reads no usage totals');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000b1');   -- another org's Admin
select is((select count(*)::int from list_equipment_costing(true)), 0, 'AC-EQU-012 another org lists no settings');
select is((select count(*)::int from equipment_costing_settings), 0, 'AC-EQU-012 another org reads no settings row');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')), 0,
  'AC-EQU-012 another org reads no usage-only allocation of this org''s asset');
select is((select count(*)::int from list_equipment_allocations('15190000-0000-0000-0000-0000000000d4','2026-09-01','2026-09-30')), 0,
  'AC-EQU-012 another org reads no hire charge of this org''s asset');
select is((select count(*)::int from list_equipment_usage_totals(null,'15190000-0000-0000-0000-0000000000d1','2026-09-01','2026-09-30')), 0,
  'AC-EQU-012 another org reads no usage totals of this org''s asset');
select is((select sum(work_units) from list_equipment_usage_totals(null,'15190000-0000-0000-0000-0000000000d9','2026-09-01','2026-09-30')), 7.00::numeric,
  'AC-EQU-012 another org reads its own usage totals');
select throws_ok($$ select save_equipment_costing('{"asset_id":"15190000-0000-0000-0000-0000000000d4","basis":"none","effective_from":"2026-01-01"}') $$,
  'P0002', null, 'AC-EQU-012 another org cannot cost this org''s asset');
select throws_ok($$ select end_equipment_costing((select (v->>'setting_key')::uuid from _k where k='f'),'2026-12-31',1) $$,
  'P0002', null, 'AC-EQU-012 another org cannot end this org''s setting');
select throws_ok($$ select save_equipment_costing(jsonb_build_object('setting_key',(select v->>'setting_key' from _k where k='f'),'expected_version',1,
  'asset_id','15190000-0000-0000-0000-0000000000d9','basis','none','effective_from','2026-01-01')) $$,
  'P0002', null, 'AC-EQU-012 another org cannot version this org''s setting');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a9');   -- disabled Finance
select throws_ok($$ select end_equipment_costing((select (v->>'setting_key')::uuid from _k where k='f'),'2026-12-31',1) $$,
  '42501', null, 'AC-EQU-012 a disabled Finance member cannot end a costing setting');
reset role;

select * from finish();
rollback;
