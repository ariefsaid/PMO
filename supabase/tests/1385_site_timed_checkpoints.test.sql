-- 1385_site_timed_checkpoints.test.sql — #2594 timed checkpoints on the daily site report.
-- Migrations under test: 1385..1388. AC-STC-001..010 and 014, docs/specs/site-timed-checkpoints.spec.md.
begin;
create extension if not exists pgtap;
select plan(86);

-- ── fixtures (as the table owner) ─────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('25940000-0000-0000-0000-0000000000a1', 'STC Org A', 'USD', 'Asia/Jakarta'),
  ('25940000-0000-0000-0000-0000000000a2', 'STC Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('25940000-0000-0000-0000-0000000000b1', 'stc-admin@example.com'),
  ('25940000-0000-0000-0000-0000000000b2', 'stc-admin2@example.com'),
  ('25940000-0000-0000-0000-0000000000b3', 'stc-eng@example.com'),
  ('25940000-0000-0000-0000-0000000000b4', 'stc-pm@example.com'),
  ('25940000-0000-0000-0000-0000000000b5', 'stc-fin@example.com'),
  ('25940000-0000-0000-0000-0000000000b6', 'stc-ctl1@example.com'),
  ('25940000-0000-0000-0000-0000000000b7', 'stc-ctl2@example.com'),
  ('25940000-0000-0000-0000-0000000000b8', 'stc-exec@example.com'),
  ('25940000-0000-0000-0000-0000000000b9', 'stc-foreign@example.com'),
  ('25940000-0000-0000-0000-0000000000ba', 'stc-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25940000-0000-0000-0000-0000000000b1', '25940000-0000-0000-0000-0000000000a1', 'STC Admin',  'stc-admin@example.com',  'Admin', 'active'),
  ('25940000-0000-0000-0000-0000000000b2', '25940000-0000-0000-0000-0000000000a1', 'STC Admin2', 'stc-admin2@example.com', 'Admin', 'active'),
  ('25940000-0000-0000-0000-0000000000b3', '25940000-0000-0000-0000-0000000000a1', 'STC Eng',    'stc-eng@example.com',    'Engineer', 'active'),
  ('25940000-0000-0000-0000-0000000000b4', '25940000-0000-0000-0000-0000000000a1', 'STC PM',     'stc-pm@example.com',     'Project Manager', 'active'),
  ('25940000-0000-0000-0000-0000000000b5', '25940000-0000-0000-0000-0000000000a1', 'STC Fin',    'stc-fin@example.com',    'Finance', 'active'),
  ('25940000-0000-0000-0000-0000000000b6', '25940000-0000-0000-0000-0000000000a1', 'STC Ctl1',   'stc-ctl1@example.com',   'Finance', 'active'),
  ('25940000-0000-0000-0000-0000000000b7', '25940000-0000-0000-0000-0000000000a1', 'STC Ctl2',   'stc-ctl2@example.com',   'Finance', 'active'),
  ('25940000-0000-0000-0000-0000000000b8', '25940000-0000-0000-0000-0000000000a1', 'STC Exec',   'stc-exec@example.com',   'Executive', 'active'),
  ('25940000-0000-0000-0000-0000000000b9', '25940000-0000-0000-0000-0000000000a2', 'STC Foreign','stc-foreign@example.com', 'Admin', 'active'),
  ('25940000-0000-0000-0000-0000000000ba', '25940000-0000-0000-0000-0000000000a1', 'STC PM2',    'stc-pm2@example.com',    'Project Manager', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('25940000-0000-0000-0000-0000000000c1', '25940000-0000-0000-0000-0000000000a1', 'STC Contract', 'Ongoing Project', 'USD', '25940000-0000-0000-0000-0000000000b4'),
  ('25940000-0000-0000-0000-0000000000c2', '25940000-0000-0000-0000-0000000000a1', 'STC Unmanaged', 'Ongoing Project', 'USD', null),
  ('25940000-0000-0000-0000-0000000000c3', '25940000-0000-0000-0000-0000000000a2', 'STC Other',    'Ongoing Project', 'USD', null);
-- work orders: e1 and e2 issued (project c1); e3 draft; e4 closed; e5 issued, project without a manager; e6..e9 issued (rows set by hand); eb issued in org B
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25940000-0000-0000-0000-0000000000e1', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO one',   'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e2', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO two',   'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e3', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO draft', 'Draft',  1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e4', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO done',  'Closed', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e5', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c2', 'WO nopm',  'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO six',   'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e7', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO seven', 'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e8', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO eight', 'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000e9', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', 'WO nine',  'Issued', 1000, 'exclusive', 0),
  ('25940000-0000-0000-0000-0000000000eb', '25940000-0000-0000-0000-0000000000a2', '25940000-0000-0000-0000-0000000000c3', 'WO other', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('25940000-0000-0000-0000-000000000c01', '25940000-0000-0000-0000-0000000000a1', 'C1', 'Crew one',   '25940000-0000-0000-0000-0000000000b6'),
  ('25940000-0000-0000-0000-000000000c02', '25940000-0000-0000-0000-0000000000a1', 'C2', 'Crew two',   null),
  ('25940000-0000-0000-0000-000000000c03', '25940000-0000-0000-0000-0000000000a1', 'C3', 'Crew three', null),
  ('25940000-0000-0000-0000-000000000c04', '25940000-0000-0000-0000-0000000000a1', 'C4', 'Crew four',  null),
  ('25940000-0000-0000-0000-000000000c05', '25940000-0000-0000-0000-0000000000a1', 'C5', 'Crew five',  null),
  ('25940000-0000-0000-0000-000000000c06', '25940000-0000-0000-0000-0000000000a1', 'C6', 'Crew six',   null),
  ('25940000-0000-0000-0000-000000000c07', '25940000-0000-0000-0000-0000000000a1', 'C7', 'Crew seven', '25940000-0000-0000-0000-0000000000b7'),
  ('25940000-0000-0000-0000-000000000c08', '25940000-0000-0000-0000-0000000000a1', 'C8', 'Crew eight', null),
  ('25940000-0000-0000-0000-000000000c0b', '25940000-0000-0000-0000-0000000000a2', 'CB', 'Crew other', null);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from, valid_to) values
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e1', '25940000-0000-0000-0000-000000000c01', '2026-03-01', null),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e1', '25940000-0000-0000-0000-000000000c02', '2026-03-01', null),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e3', '25940000-0000-0000-0000-000000000c03', '2026-03-01', null),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e4', '25940000-0000-0000-0000-000000000c04', '2026-03-01', null),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e2', '25940000-0000-0000-0000-000000000c05', '2026-02-01', '2026-03-05'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e5', '25940000-0000-0000-0000-000000000c06', '2026-03-01', null),
  ('25940000-0000-0000-0000-0000000000a2', '25940000-0000-0000-0000-0000000000eb', '25940000-0000-0000-0000-000000000c0b', '2026-03-01', null);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
create temp table cap (k text primary key, v text) on commit drop;
grant all on cap to authenticated;

-- ── AC-STC-001 the list ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select is(public.set_site_checkpoint_list('[
  {"name":"Gate arrival","due_time":"06:30","grace_minutes":10,"photo_required":true},
  {"name":"Work start","due_time":"07:00","grace_minutes":10,"marks_work_start":true,"photo_required":true},
  {"name":"After break","due_time":"13:00","grace_minutes":15,"photo_required":false},
  {"name":"Progress","due_time":"15:00","photo_required":true}]'::jsonb), 4,
  'AC-STC-001 Admin saves a four-checkpoint list');
select results_eq($$ select position::int, name, marks_work_start, due_time::text, grace_minutes::int, photo_required
                       from site_checkpoint_templates order by position $$,
  $$ values (1,'Gate arrival',false,'06:30:00',10,true), (2,'Work start',true,'07:00:00',10,true),
            (3,'After break',false,'13:00:00',15,false), (4,'Progress',false,'15:00:00',0,true) $$,
  'AC-STC-001 the list is stored in order with its time, grace, work-start flag and photo flag');
select throws_ok($$ select public.set_site_checkpoint_list('[{"name":"A","due_time":"06:00","marks_work_start":true},{"name":"B","due_time":"07:00","marks_work_start":true}]'::jsonb) $$,
  '23514', null, 'AC-STC-001 a second work-start checkpoint is refused');
select throws_ok($$ select public.set_site_checkpoint_list('[{"name":"A","due_time":"06:00","grace_minutes":121}]'::jsonb) $$,
  '23514', null, 'AC-STC-001 a grace over 120 minutes is refused');
select throws_ok($$ select public.set_site_checkpoint_list('[{"name":"  ","due_time":"06:00"}]'::jsonb) $$,
  '23514', null, 'AC-STC-001 a blank name is refused');
select throws_ok($$ select public.set_site_checkpoint_list('[{"name":"A","due_time":"25:99"}]'::jsonb) $$,
  '23514', null, 'AC-STC-001 an invalid time is refused');
select is((select count(*)::int from site_checkpoint_templates), 4, 'AC-STC-001 a refused list leaves the saved list in place');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select throws_ok($$ select public.set_site_checkpoint_list('[]'::jsonb) $$, '42501', null, 'AC-STC-001 Finance cannot set the list');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b4');
select throws_ok($$ select public.set_site_checkpoint_list('[]'::jsonb) $$, '42501', null, 'AC-STC-001 a Project Manager cannot set the list');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.set_site_checkpoint_list('[]'::jsonb) $$, '42501', null, 'AC-STC-001 an Engineer cannot set the list');
select is((select count(*)::int from site_checkpoint_templates), 0, 'AC-STC-001 only Admin reads the list rows');
select throws_ok($$ insert into site_checkpoint_templates (position, name, due_time) values (9, 'Direct', '08:00') $$,
  '42501', null, 'AC-STC-051 no client write grant on the list');

-- ── AC-STC-002 materialise, once, only where due ──────────────────────────────────────────────────
reset role;
select is(public.materialise_site_checkpoints('2026-03-10 00:30:00+07'), 12,
  'AC-STC-002 three rostered crews of Issued work orders get four checkpoints each');
select is(public.materialise_site_checkpoints('2026-03-10 00:35:00+07'), 0, 'AC-STC-002 a re-run adds none');
select is((select count(*)::int from site_checkpoints where work_order_id in ('25940000-0000-0000-0000-0000000000e3', '25940000-0000-0000-0000-0000000000e4')), 0,
  'AC-STC-002 a Draft or Closed work order gets none');
select is((select count(*)::int from site_checkpoints where crew_id = '25940000-0000-0000-0000-000000000c05'), 0,
  'AC-STC-002 a crew outside its roster dates gets none');
select is((select due_at from site_checkpoints where crew_id = '25940000-0000-0000-0000-000000000c01' and position = 2 and work_date = '2026-03-10'),
  '2026-03-10 07:00:00+07'::timestamptz, 'AC-STC-002 the due instant is the organisation''s local time');
select is((select count(*)::int from site_checkpoints where org_id = '25940000-0000-0000-0000-0000000000a2'), 0,
  'AC-STC-002 an organisation with an empty list gets nothing');

-- ── AC-STC-003 a later edit changes the next day only ─────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.set_site_checkpoint_list('[
  {"name":"Gate arrival","due_time":"06:30","grace_minutes":10,"photo_required":true},
  {"name":"Work start (new)","due_time":"07:00","grace_minutes":10,"marks_work_start":true,"photo_required":true},
  {"name":"After break","due_time":"13:00","grace_minutes":15,"photo_required":false},
  {"name":"Progress","due_time":"15:00","photo_required":true}]'::jsonb) $$, 'AC-STC-003 Admin edits the list');
reset role;
select is((select count(*)::int from site_checkpoints where work_date = '2026-03-10' and name = 'Work start'), 3,
  'AC-STC-003 the day''s existing rows are unchanged');
select is(public.materialise_site_checkpoints('2026-03-11 00:30:00+07'), 12, 'AC-STC-003 the next day is created');
select is((select count(*)::int from site_checkpoints where work_date = '2026-03-11' and name = 'Work start (new)'), 3,
  'AC-STC-003 the next day uses the new list');

-- ── AC-STC-004/005 recording ──────────────────────────────────────────────────────────────────────
-- rows by hand for the real today of organisation A (the record function uses the real clock)
insert into cap select 'today', (now() at time zone 'Asia/Jakarta')::date::text;
insert into site_checkpoints (id, org_id, work_order_id, crew_id, work_date, position, name, marks_work_start, due_at, grace_minutes, photo_required) values
  ('25940000-0000-0000-0000-00000000f001', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 1, 'Start', true,  now() + interval '1 hour', 10, true),
  ('25940000-0000-0000-0000-00000000f002', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 2, 'Noon',  false, now() + interval '2 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f003', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 3, 'Photo', false, now() + interval '3 hour', 10, true),
  ('25940000-0000-0000-0000-00000000f004', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 4, 'Eng',   false, now() + interval '3 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f005', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 5, 'PM',    false, now() + interval '3 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f006', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 6, 'Exec',  false, now() + interval '3 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f007', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today') + 1, 1, 'Future', false, now() + interval '30 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f008', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e3', '25940000-0000-0000-0000-000000000c03', (select v::date from cap where k='today'), 1, 'Draft WO', false, now() + interval '1 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f009', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 7, 'Fin',   false, now() + interval '3 hour', 10, false),
  ('25940000-0000-0000-0000-00000000f00a', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e6', '25940000-0000-0000-0000-000000000c01', (select v::date from cap where k='today'), 8, 'Other', false, now() + interval '3 hour', 10, false);
-- the stored photo objects (as the owner); one for f001, one belonging to f002's path
insert into storage.objects (bucket_id, name) values
  ('site-checkpoint-photos', '25940000-0000-0000-0000-0000000000a1/25940000-0000-0000-0000-0000000000e6/25940000-0000-0000-0000-000000000c01/' || (select v from cap where k='today') || '/25940000-0000-0000-0000-00000000f001.jpg'),
  ('site-checkpoint-photos', '25940000-0000-0000-0000-0000000000a1/25940000-0000-0000-0000-0000000000e6/25940000-0000-0000-0000-000000000c01/' || (select v from cap where k='today') || '/25940000-0000-0000-0000-00000000f002.jpg');

set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b6');
select lives_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f001',
  '25940000-0000-0000-0000-0000000000a1/25940000-0000-0000-0000-0000000000e6/25940000-0000-0000-0000-000000000c01/' || (select v from cap where k='today') || '/25940000-0000-0000-0000-00000000f001.jpg', 'on site') $$,
  'AC-STC-004 the crew''s field controller records with a photo');
select results_eq($$ select recorded_by, recorded_at = now(), note from site_checkpoints where id = '25940000-0000-0000-0000-00000000f001' $$,
  $$ values ('25940000-0000-0000-0000-0000000000b6'::uuid, true, 'on site'::text) $$,
  'AC-STC-004 the server stamps the person and the time');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f002', null, null, p_recorded_at => '2000-01-01 00:00:00+00') $$,
  '42883', null, 'AC-STC-004 a client-supplied time has no parameter to travel in');
select throws_ok($$ update site_checkpoints set recorded_at = '2000-01-01 00:00:00+00' where id = '25940000-0000-0000-0000-00000000f002' $$,
  '42501', null, 'AC-STC-004 no client can write the recorded time directly');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f003', null, null) $$,
  '23514', 'this checkpoint needs a photo', 'AC-STC-004 a required photo is needed');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f003',
  '25940000-0000-0000-0000-0000000000a1/25940000-0000-0000-0000-0000000000e6/25940000-0000-0000-0000-000000000c01/' || (select v from cap where k='today') || '/25940000-0000-0000-0000-00000000f002.jpg', null) $$,
  '23514', null, 'AC-STC-004 a photo stored at another checkpoint''s path does not count');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b7');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f002', null, null) $$,
  '42501', null, 'AC-STC-004 another crew''s controller is refused');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f009', null, null) $$,
  '42501', null, 'AC-STC-004 Finance is refused');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b8');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f006', null, null) $$,
  '42501', null, 'AC-STC-004 Executive reads but does not record');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b9');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f00a', null, null) $$,
  'P0002', null, 'AC-STC-004 another organisation''s user finds nothing to record');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b3');
select lives_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f004', null, null) $$, 'AC-STC-004 an Engineer records');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b4');
select lives_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f005', null, null) $$, 'AC-STC-004 the work order''s project manager records');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000ba');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f00a', null, null) $$,
  '42501', null, 'AC-STC-004 another project''s manager is refused');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f002', null, 'by admin') $$, 'AC-STC-004 an Admin records');

-- AC-STC-005
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f002', null, 'again') $$,
  '55000', null, 'AC-STC-005 a recorded checkpoint is not recorded again');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f007', null, null) $$,
  '55000', null, 'AC-STC-005 a future day is refused');
select throws_ok($$ select public.record_site_checkpoint('25940000-0000-0000-0000-00000000f008', null, null) $$,
  '55000', null, 'AC-STC-005 a work order that is not Issued is refused');
select throws_ok($$ update site_checkpoints set note = 'x' where id = '25940000-0000-0000-0000-00000000f002' $$,
  '42501', null, 'AC-STC-005 a client cannot edit a recorded checkpoint');
reset role;
select throws_ok($$ update site_checkpoints set recorded_at = recorded_at + interval '1 hour' where id = '25940000-0000-0000-0000-00000000f001' $$,
  '55000', null, 'AC-STC-005 the recorded time is immutable even for the owner');
select throws_ok($$ update site_checkpoints set photo_path = null where id = '25940000-0000-0000-0000-00000000f001' $$,
  '55000', null, 'AC-STC-005 the recorded photo is immutable');
select throws_ok($$ update site_checkpoints set recorded_by = '25940000-0000-0000-0000-0000000000b1' where id = '25940000-0000-0000-0000-00000000f001' $$,
  '55000', null, 'AC-STC-005 the recording person is immutable');

-- storage policy: the controller reads her photo; Finance who may not read the work order's checkpoints does not
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b6');
select is((select count(*)::int from storage.objects where bucket_id = 'site-checkpoint-photos'), 2, 'AC-STC-023 the crew''s controller reads the crew''s photos');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from storage.objects where bucket_id = 'site-checkpoint-photos'), 0, 'AC-STC-023 a role without access reads no photo');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b9');
select is((select count(*)::int from storage.objects where bucket_id = 'site-checkpoint-photos'), 0, 'AC-STC-023 another organisation reads no photo');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from site_checkpoints), 0, 'AC-STC-050 another crew''s controller reads no row of this crew');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from site_checkpoints), 0, 'AC-STC-050 Finance reads no checkpoint');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b6');
select ok((select count(*)::int from site_checkpoints) > 0 and (select count(*)::int from site_checkpoints where crew_id <> '25940000-0000-0000-0000-000000000c01') = 0,
  'AC-STC-050 the controller reads only her own crew''s rows');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b8');
select ok((select count(*)::int from site_checkpoints) > 20, 'AC-STC-050 Executive reads the checkpoints');
reset role;

-- ── AC-STC-006/007 the late reminder ──────────────────────────────────────────────────────────────
-- the materialised rows of 2026-03-10: arrival 06:30+10, work start 07:00+10 (three crews: c01 with a controller,
-- c02 without one under a project with a manager, c06 without one under a project with no manager)
select is(public.remind_late_site_checkpoints('2026-03-10 06:35:00+07'), 0, 'AC-STC-006 nothing is late at 06:35');
select is(public.remind_late_site_checkpoints('2026-03-10 07:09:00+07'), 3, 'AC-STC-006 the three arrival checkpoints are late at 07:09');
select is((select count(*)::int from notifications where body like 'Work start%'), 0,
  'AC-STC-006 the 07:00 checkpoint with 10 minutes grace is not reminded at 07:09');
select is(public.remind_late_site_checkpoints('2026-03-10 07:11:00+07'), 3, 'AC-STC-006 it is reminded at 07:11');
select is((select count(*)::int from notifications where body = 'Work start · Crew one' and owner_id = '25940000-0000-0000-0000-0000000000b6'), 1,
  'AC-STC-006 the crew''s active field controller is notified once');
select isnt((select late_notified_at from site_checkpoints where crew_id = '25940000-0000-0000-0000-000000000c01' and position = 2 and work_date = '2026-03-10'), null,
  'AC-STC-006 the reminder is stamped');
select is(public.remind_late_site_checkpoints('2026-03-10 07:11:00+07'), 0, 'AC-STC-006 a re-run notifies no second time');
select is((select count(*)::int from notifications where body = 'Work start · Crew two' and owner_id = '25940000-0000-0000-0000-0000000000b4'), 1,
  'AC-STC-007 a crew with no controller reminds the project manager');
select is((select count(*)::int from notifications where body = 'Work start · Crew six' and owner_id in
   ('25940000-0000-0000-0000-0000000000b1', '25940000-0000-0000-0000-0000000000b2')), 2,
  'AC-STC-007 with no project manager each active Admin is reminded');
select is((select count(*)::int from notifications where body like 'Work start%' and owner_id = '25940000-0000-0000-0000-0000000000b9'), 0,
  'AC-STC-007 another organisation''s users receive none');
-- an organisation whose list is empty: a leftover unrecorded late row reminds no one
insert into site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, due_at, photo_required) values
  ('25940000-0000-0000-0000-0000000000a2', '25940000-0000-0000-0000-0000000000eb', '25940000-0000-0000-0000-000000000c0b', '2026-03-10', 1, 'Old', '2026-03-10 05:00:00+00', false);
select is(public.remind_late_site_checkpoints('2026-03-10 09:00:00+00'), 6, 'AC-STC-006 the later checkpoints of the organisation with a list are reminded');
select is((select late_notified_at from site_checkpoints where org_id = '25940000-0000-0000-0000-0000000000a2'), null,
  'AC-STC-006 an organisation with an empty list is reminded of nothing');

-- ── AC-STC-008 the flag ───────────────────────────────────────────────────────────────────────────
insert into site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, marks_work_start, due_at, grace_minutes, photo_required, recorded_at, recorded_by) values
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e7', '25940000-0000-0000-0000-000000000c07', '2026-03-12', 1, 'Start', true, '2026-03-12 00:00:00+00', 10, false, '2026-03-12 01:00:00+00', '25940000-0000-0000-0000-0000000000b7'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e8', '25940000-0000-0000-0000-000000000c08', '2026-03-12', 1, 'Start', true, '2026-03-12 00:00:00+00', 10, false, '2026-03-12 00:05:00+00', '25940000-0000-0000-0000-0000000000b3');
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select is(public.work_order_checkpoint_flag('25940000-0000-0000-0000-0000000000e1', '2026-03-10'), true, 'AC-STC-008 a work order with a late unrecorded checkpoint is flagged');
select is(public.work_order_checkpoint_flag('25940000-0000-0000-0000-0000000000e7', '2026-03-12'), true, 'AC-STC-008 recording the checkpoint late leaves the work order flagged');
select is(public.work_order_checkpoint_flag('25940000-0000-0000-0000-0000000000e8', '2026-03-12'), false, 'AC-STC-008 a checkpoint recorded within grace does not flag');
select is(public.work_order_checkpoint_flag('25940000-0000-0000-0000-0000000000e1', '2099-01-01'), false, 'AC-STC-008 a day with no late checkpoint is not flagged');
select is((select count(*)::int from site_checkpoints_for_day('25940000-0000-0000-0000-0000000000e1', '2026-03-10')), 8,
  'AC-STC-032 the day''s checkpoints are listed for the work order');
reset role;

-- ── AC-STC-009 / 010 the crews view ───────────────────────────────────────────────────────────────
insert into site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, marks_work_start, due_at, grace_minutes, photo_required, recorded_at, recorded_by) values
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e9', '25940000-0000-0000-0000-000000000c08', '2026-02-01', 1, 'Start', true, '2026-02-01 00:00:00+00', 10, false, '2026-02-01 00:05:00+00', '25940000-0000-0000-0000-0000000000b3'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e9', '25940000-0000-0000-0000-000000000c08', '2026-02-02', 1, 'Start', true, '2026-02-02 00:00:00+00', 10, false, '2026-02-02 00:20:00+00', '25940000-0000-0000-0000-0000000000b3');
insert into site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, marks_work_start, due_at, grace_minutes, photo_required) values
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e9', '25940000-0000-0000-0000-000000000c08', '2026-02-03', 1, 'Start', true, '2026-02-03 00:00:00+00', 10, false);
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
insert into cap select 'punct', public.crew_start_punctuality('2026-02-01', '2026-02-03', null, '25940000-0000-0000-0000-0000000000e9')::text;
select is((select (v::jsonb -> 'crews' -> 0 ->> 'days')::int from cap where k = 'punct'), 3, 'AC-STC-009 three days');
select is((select (v::jsonb -> 'crews' -> 0 ->> 'on_time')::int from cap where k = 'punct'), 1, 'AC-STC-009 one day started on time');
select is((select (v::jsonb -> 'crews' -> 0 ->> 'share_on_time')::numeric from cap where k = 'punct'), 0.3333, 'AC-STC-009 the share is a count of days, one third');
select is((select string_agg(d ->> 'status', ',' order by d ->> 'work_date') from cap, jsonb_array_elements(v::jsonb -> 'crews' -> 0 -> 'day_rows') d where k = 'punct'),
  'on_time,late,not_started', 'AC-STC-009 statuses on_time, late, not_started');
select is((select (d ->> 'minutes_late')::int from cap, jsonb_array_elements(v::jsonb -> 'crews' -> 0 -> 'day_rows') d where k = 'punct' and d ->> 'work_date' = '2026-02-02'),
  20, 'AC-STC-009 minutes late');
select throws_ok($$ select public.crew_start_punctuality('2026-01-01', '2026-04-03') $$, '22023', null, 'AC-STC-010 a range over 92 days is refused');
reset role;
insert into crews (org_id, code, name) select '25940000-0000-0000-0000-0000000000a1', 'BULK-' || g, 'Bulk ' || lpad(g::text, 3, '0') from generate_series(1, 201) g;
insert into site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, marks_work_start, due_at, grace_minutes, photo_required)
  select '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000e9', c.id, '2026-04-01', 1, 'Start', true, '2026-04-01 00:00:00+00', 10, false
    from crews c where c.code like 'BULK-%';
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select is((select jsonb_array_length(public.crew_start_punctuality('2026-04-01', '2026-04-01', null, '25940000-0000-0000-0000-0000000000e9') -> 'crews')), 200,
  'AC-STC-010 the crews list is bounded to 200');
select is((select public.crew_start_punctuality('2026-04-01', '2026-04-01', null, '25940000-0000-0000-0000-0000000000e9') ->> 'truncated'), 'true',
  'AC-STC-010 the bound says so');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select is((select jsonb_array_length(public.crew_start_punctuality('2026-02-01', '2026-04-01') -> 'crews')), 0, 'AC-STC-050 Finance sees no crew');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b9');
select is((select jsonb_array_length(public.crew_start_punctuality('2026-02-01', '2026-04-01') -> 'crews')), 0, 'AC-STC-050 another organisation sees no crew');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b7');
select is((select jsonb_array_length(public.crew_start_punctuality('2026-03-12', '2026-03-12') -> 'crews')), 1, 'AC-STC-050 a controller sees her own crew only');
reset role;

-- ── AC-STC-014 lost time by cause ─────────────────────────────────────────────────────────────────
insert into dsr_idle_reasons (id, org_id, label) values
  ('25940000-0000-0000-0000-0000000000d1', '25940000-0000-0000-0000-0000000000a1', 'Cause A'),
  ('25940000-0000-0000-0000-0000000000d2', '25940000-0000-0000-0000-0000000000a1', 'Cause B');
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, superseded_at) values
  ('25940000-0000-0000-0000-0000000000f1', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', '25940000-0000-0000-0000-0000000000e1', '2026-03-20', 'submitted', '25940000-0000-0000-0000-0000000000b3', null, null, null),
  ('25940000-0000-0000-0000-0000000000f2', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', '25940000-0000-0000-0000-0000000000e1', '2026-03-21', 'validated', '25940000-0000-0000-0000-0000000000b3', '25940000-0000-0000-0000-0000000000b1', now(), null),
  ('25940000-0000-0000-0000-0000000000f3', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', '25940000-0000-0000-0000-0000000000e2', '2026-03-22', 'draft', '25940000-0000-0000-0000-0000000000b3', null, null, null),
  ('25940000-0000-0000-0000-0000000000f4', '25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000c1', '25940000-0000-0000-0000-0000000000e2', '2026-03-23', 'validated', '25940000-0000-0000-0000-0000000000b3', '25940000-0000-0000-0000-0000000000b1', now(), now());
insert into dsr_idle_periods (org_id, report_id, position, minutes, reason_id) values
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000f1', 1, 60, '25940000-0000-0000-0000-0000000000d1'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000f2', 1, 30, '25940000-0000-0000-0000-0000000000d1'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000f2', 2, 45, '25940000-0000-0000-0000-0000000000d2'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000f3', 1, 45, '25940000-0000-0000-0000-0000000000d2'),
  ('25940000-0000-0000-0000-0000000000a1', '25940000-0000-0000-0000-0000000000f4', 1, 500, '25940000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b1');
select results_eq($$ select r ->> 'label', (r ->> 'minutes')::int from jsonb_array_elements(public.site_lost_time_by_cause('2026-03-01', '2026-03-31') -> 'rows') r $$,
  $$ values ('Cause A'::text, 90), ('Cause B'::text, 45) $$, 'AC-STC-014 minutes by cause, largest first, without the draft or the superseded report');
select is((public.site_lost_time_by_cause('2026-03-01', '2026-03-31') ->> 'total_minutes')::int, 135, 'AC-STC-014 the total');
select is((public.site_lost_time_by_cause('2026-03-01', '2026-03-31') ->> 'report_count')::int, 2, 'AC-STC-014 the reports counted');
select throws_ok($$ select public.site_lost_time_by_cause('2026-01-01', '2026-04-03') $$, '22023', null, 'AC-STC-014 a range over 92 days is refused');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b5');
select throws_ok($$ select public.site_lost_time_by_cause('2026-03-01', '2026-03-31') $$, '42501', null, 'AC-STC-014 Finance is refused');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b9');
select is((public.site_lost_time_by_cause('2026-03-01', '2026-03-31') ->> 'total_minutes')::int, 0, 'AC-STC-014 another organisation''s Admin sees none of this organisation''s time');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000b4');
select is((public.site_lost_time_by_cause('2026-03-01', '2026-03-31') ->> 'total_minutes')::int, 135, 'AC-STC-014 the project''s manager sees the project');
select pg_temp.act_as('25940000-0000-0000-0000-0000000000ba');
select is((public.site_lost_time_by_cause('2026-03-01', '2026-03-31') ->> 'total_minutes')::int, 0, 'AC-STC-014 another project''s manager sees none of it');
reset role;

select * from finish();
rollback;
