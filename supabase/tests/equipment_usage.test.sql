-- equipment_usage.test.sql — 0447 (#1519 S1). Owns AC-EQU-007 (docs/specs/equipment-usage.spec.md): the
-- draft → submitted → approved|rejected transition, approver ≠ author, the entry contract (FR-EQU-002/003/004,
-- OQ-7/8) and the audit trail. Fixture F1 is docs/plans/2026-11-01-equipment-usage.md "Fixture F1".
begin;
create extension if not exists pgtap;
select plan(40);

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

-- extension of F1 for this file: a disabled Finance member (the active-member gate)
insert into auth.users (id, email) values ('15190000-0000-0000-0000-0000000000a8', 'equ-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15190000-0000-0000-0000-0000000000a8', '15190000-0000-0000-0000-00000000000a', 'EQU Gone', 'equ-gone@example.com', 'Finance', 'disabled');

create temp table _e (k text primary key, v uuid) on commit drop;
create temp table _j (k text primary key, v jsonb) on commit drop;
grant all on _e, _j to authenticated;
set local role authenticated;

-- ── the transition, SoD and audit (plan S1.1) ──────────────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1 logs on P1
insert into _e select 'e1', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-10","quantity":6,"unit":"hours"}'::jsonb)->>'id')::uuid;
select is((select status from equipment_usage_entries where id = (select v from _e where k='e1')), 'Draft', 'AC-EQU-007 a new entry is Draft');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Submitted') $$, 'AC-EQU-007 the author submits');
select throws_like($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '%separation of duties%', 'AC-EQU-007 the author cannot approve their own entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a4');   -- PM2 does not manage P1
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '42501', null, 'AC-EQU-007 a PM of another project cannot approve');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');   -- Engineer
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  '42501', null, 'AC-EQU-007 an Engineer cannot approve');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 manages P1
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Approved') $$,
  'AC-EQU-007 the project''s PM approves');
select is((select approver_id from equipment_usage_entries where id = (select v from _e where k='e1')),
  '15190000-0000-0000-0000-0000000000a3'::uuid, 'AC-EQU-007 the approver is stamped');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select throws_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='e1'),
  'asset_id','15190000-0000-0000-0000-0000000000d1','project_id','15190000-0000-0000-0000-0000000000c1',
  'work_date','2026-09-10','quantity',7,'unit','hours')) $$, '22023', null, 'AC-EQU-007 an approved entry is immutable');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Draft') $$,
  '42501', null, 'AC-EQU-007 only an Admin reopens an approved entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Draft', 'wrong project') $$,
  'AC-EQU-007 an Admin (not the author) reopens');
select is((select count(*)::int from audit_events where entity_id = (select v from _e where k='e1')
            and action like 'equipment_usage.%'), 4, 'AC-EQU-007 create, submit, approve and reopen each wrote an audit row');
select ok((select detail ? 'from' and detail ? 'to' from audit_events where entity_id = (select v from _e where k='e1')
            and action = 'equipment_usage.approved'), 'AC-EQU-007 the audit row carries before/after status');

-- ── the entry contract (FR-EQU-002/003/004, OQ-7) ──────────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":-1,"unit":"hours"}') $$,
  '22023', null, 'AC-EQU-007 a negative quantity is refused');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":25,"unit":"hours"}') $$,
  '22023', null, 'AC-EQU-007 25 hours in one entry is refused');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d2","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":1.5,"unit":"days"}') $$,
  '22023', null, 'AC-EQU-007 1.5 days in one entry is refused');
select throws_ok($$ select save_equipment_usage(jsonb_build_object('asset_id','15190000-0000-0000-0000-0000000000d1',
  'project_id','15190000-0000-0000-0000-0000000000c1','work_date',(now() at time zone 'Asia/Jakarta')::date + 1,'quantity',1,'unit','hours')) $$,
  '22023', null, 'AC-EQU-007 a future work date (org timezone) is refused');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000cb","work_date":"2026-09-01","quantity":1,"unit":"hours"}') $$,
  'P0002', null, 'AC-EQU-007 a foreign project is refused');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d9","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-01","quantity":1,"unit":"hours"}') $$,
  'P0002', null, 'AC-EQU-007 a foreign asset is refused');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-10","quantity":1,"unit":"hours"}') $$,
  '23505', null, 'AC-EQU-007 a second entry on the same asset, project, date and kind is refused');
insert into _j select 'e2', save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "project_id":"15190000-0000-0000-0000-0000000000c2","work_date":"2026-09-10","quantity":20,"unit":"hours"}');
insert into _e select k, (v->>'id')::uuid from _j where k = 'e2';
select is((select (v->>'over_24h')::boolean from _j where k='e2'), true,
  'AC-EQU-007 the same asset on another project the same day over 24 h warns (OQ-7)');
select is((select status from equipment_usage_entries where id = (select v from _e where k='e2')), 'Draft',
  'AC-EQU-007 the over-24 h entry is still saved');
select ok((save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d2","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-11","quantity":1,"unit":"days"}')->>'id') is not null,
  'AC-EQU-007 usage saves with no rate or costing setting (FR-EQU-004)');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a8');
select throws_ok($$ select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1","project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-02","quantity":1,"unit":"hours"}') $$,
  '42501', null, 'AC-EQU-007 a disabled member cannot log usage');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');   -- Eng2 touches Eng1's draft
select throws_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='e1'),
  'asset_id','15190000-0000-0000-0000-0000000000d1','project_id','15190000-0000-0000-0000-0000000000c1',
  'work_date','2026-09-10','quantity',2,'unit','hours')) $$, '42501', null, 'AC-EQU-007 only the author edits an entry');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e1'), 'Submitted') $$,
  '42501', null, 'AC-EQU-007 only the author submits an entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e2'), 'Approved') $$,
  '22023', null, 'AC-EQU-007 a draft cannot jump to Approved');

-- ── reject, redraft, and SoD for approver-role authors ─────────────────────────────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select transition_equipment_usage((select v from _e where k='e2'), 'Submitted');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e2'), 'Rejected') $$,
  '42501', null, 'AC-EQU-007 an Engineer cannot reject');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a5');   -- Exec
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e2'), 'Rejected', 'wrong asset') $$,
  'AC-EQU-007 an Executive rejects with a reason');
select is((select status || '/' || decision_notes from equipment_usage_entries where id = (select v from _e where k='e2')),
  'Rejected/wrong asset', 'AC-EQU-007 the reject reason is kept');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_equipment_usage((select v from _e where k='e2'), 'Draft') $$,
  '42501', null, 'AC-EQU-007 only the author returns a rejected entry to draft');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');
select lives_ok($$ select save_equipment_usage(jsonb_build_object('id',(select v from _e where k='e2'),
  'asset_id','15190000-0000-0000-0000-0000000000d1','project_id','15190000-0000-0000-0000-0000000000c2',
  'work_date','2026-09-10','quantity',8,'unit','hours')) $$, 'AC-EQU-007 the author edits a rejected entry');
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e2'), 'Draft') $$,
  'AC-EQU-007 the author returns a rejected entry to draft');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 logs on their own project
insert into _e select 'e3', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-12","quantity":3,"unit":"hours"}'::jsonb)->>'id')::uuid;
select transition_equipment_usage((select v from _e where k='e3'), 'Submitted');
select throws_like($$ select transition_equipment_usage((select v from _e where k='e3'), 'Approved') $$,
  '%separation of duties%', 'AC-EQU-007 a PM cannot approve their own entry on a project they manage');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a2');   -- Finance
select lives_ok($$ select transition_equipment_usage((select v from _e where k='e3'), 'Approved') $$,
  'AC-EQU-007 Finance approves another person''s entry');

select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');   -- Admin logs on P3
insert into _e select 'e4', (save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d1",
  "project_id":"15190000-0000-0000-0000-0000000000c3","work_date":"2026-09-12","quantity":2,"unit":"hours"}'::jsonb)->>'id')::uuid;
select transition_equipment_usage((select v from _e where k='e4'), 'Submitted');
select throws_like($$ select transition_equipment_usage((select v from _e where k='e4'), 'Approved') $$,
  '%separation of duties%', 'AC-EQU-007 an Admin cannot approve their own entry');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1 manages P3
select transition_equipment_usage((select v from _e where k='e4'), 'Approved');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a1');
select throws_like($$ select transition_equipment_usage((select v from _e where k='e4'), 'Draft') $$,
  '%separation of duties%', 'AC-EQU-007 an Admin cannot reopen their own approved entry');

-- ── bulk approve of an asset-week (OQ-8, PQ-7): GEN-1, week of Mon 2026-09-14 ─────────────────────
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');   -- PM1's own entry on P1
select transition_equipment_usage((save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-14","quantity":4,"unit":"hours"}')->>'id')::uuid, 'Submitted');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a6');   -- Eng1 on P1, Eng1 on P2, plus two that must stay put
select transition_equipment_usage((save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-15","quantity":5,"unit":"hours"}')->>'id')::uuid, 'Submitted');
select transition_equipment_usage((save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c2","work_date":"2026-09-16","quantity":6,"unit":"hours"}')->>'id')::uuid, 'Submitted');
select save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-17","quantity":1,"unit":"hours"}');
select transition_equipment_usage((save_equipment_usage('{"asset_id":"15190000-0000-0000-0000-0000000000d3",
  "project_id":"15190000-0000-0000-0000-0000000000c1","work_date":"2026-09-21","quantity":2,"unit":"hours"}')->>'id')::uuid, 'Submitted');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a7');
select is(approve_equipment_usage_week('15190000-0000-0000-0000-0000000000d3', '2026-09-14'),
  '{"approved":0,"skipped_own":0,"skipped_not_permitted":3}'::jsonb, 'AC-EQU-007 an Engineer bulk-approves nothing');
select pg_temp.act_as('15190000-0000-0000-0000-0000000000a3');
select is(approve_equipment_usage_week('15190000-0000-0000-0000-0000000000d3', '2026-09-14'),
  '{"approved":1,"skipped_own":1,"skipped_not_permitted":1}'::jsonb,
  'AC-EQU-007 bulk approve skips the approver''s own entry and projects they cannot approve');
select is((select string_agg(work_date::text || ':' || status, ',' order by work_date) from equipment_usage_entries
            where asset_id = '15190000-0000-0000-0000-0000000000d3'),
  '2026-09-14:Submitted,2026-09-15:Approved,2026-09-16:Submitted,2026-09-17:Draft,2026-09-21:Submitted',
  'AC-EQU-007 bulk approve touches only Submitted entries inside the week');
select throws_ok($$ select approve_equipment_usage_week('15190000-0000-0000-0000-0000000000d9', '2026-09-14') $$,
  'P0002', null, 'AC-EQU-007 bulk approve of a foreign asset is refused');

select * from finish();
rollback;
