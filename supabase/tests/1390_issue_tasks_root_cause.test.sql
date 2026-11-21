-- 1390_issue_tasks_root_cause.test.sql — #2677 (docs/specs/issue-tasks-root-cause.spec.md).
-- Migrations under test: 1390_incident_tasks, 1391_incident_root_cause, 1392_add_task_to_incident.
-- AC-ITR-001 several tasks · 002 who may add · 003 no client write · 004 legacy link mirrored · 005 reads · 006 root cause · 007 independence.
-- Fixtures are written as the table owner; every client check runs as `authenticated` with a JWT.
begin;
create extension if not exists pgtap;
select plan(41);

insert into organizations (id, name, default_currency) values
  ('26770000-0000-0000-0000-00000000000a', 'ITR Org',   'IDR'),
  ('26770000-0000-0000-0000-00000000000b', 'ITR Other', 'IDR'),
  ('26770000-0000-0000-0000-00000000000c', 'ITR Off',   'IDR');
insert into auth.users (id, email) values
  ('26770000-0000-0000-0000-0000000000a1', 'itr-admin@example.com'),
  ('26770000-0000-0000-0000-0000000000a3', 'itr-pm@example.com'),
  ('26770000-0000-0000-0000-0000000000a4', 'itr-reporter@example.com'),
  ('26770000-0000-0000-0000-0000000000a5', 'itr-assignee@example.com'),
  ('26770000-0000-0000-0000-0000000000a6', 'itr-gone@example.com'),
  ('26770000-0000-0000-0000-0000000000b1', 'itr-xorg@example.com'),
  ('26770000-0000-0000-0000-0000000000c1', 'itr-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26770000-0000-0000-0000-0000000000a1', '26770000-0000-0000-0000-00000000000a', 'ITR Admin',    'itr-admin@example.com',    'Admin', 'active'),
  ('26770000-0000-0000-0000-0000000000a3', '26770000-0000-0000-0000-00000000000a', 'ITR PM',       'itr-pm@example.com',       'Project Manager', 'active'),
  ('26770000-0000-0000-0000-0000000000a4', '26770000-0000-0000-0000-00000000000a', 'ITR Reporter', 'itr-reporter@example.com', 'Engineer', 'active'),
  ('26770000-0000-0000-0000-0000000000a5', '26770000-0000-0000-0000-00000000000a', 'ITR Assignee', 'itr-assignee@example.com', 'Engineer', 'active'),
  ('26770000-0000-0000-0000-0000000000a6', '26770000-0000-0000-0000-00000000000a', 'ITR Gone',     'itr-gone@example.com',     'Engineer', 'disabled'),
  ('26770000-0000-0000-0000-0000000000b1', '26770000-0000-0000-0000-00000000000b', 'ITR XOrg',     'itr-xorg@example.com',     'Admin', 'active'),
  ('26770000-0000-0000-0000-0000000000c1', '26770000-0000-0000-0000-00000000000c', 'ITR Off',      'itr-off@example.com',      'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-00000000000a', 'ITR Site',  'Ongoing Project', '26770000-0000-0000-0000-0000000000a3'),
  ('26770000-0000-0000-0000-0000000000dc', '26770000-0000-0000-0000-00000000000c', 'ITR Off Site', 'Ongoing Project', null);
insert into org_features (org_id, feature_key, enabled) values ('26770000-0000-0000-0000-00000000000c', 'incidents', false);

-- a01 main, a02 closed, a03 no project, a04 legacy task made before the change, a05 cap, a06 other org, a07 off org, a08 legacy via RPC
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, assignee_id, action, status) values
  ('26770000-0000-0000-0000-000000000a01', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-0000000000a4', '26770000-0000-0000-0000-0000000000a5', 'Fix the rail', 'Open'),
  ('26770000-0000-0000-0000-000000000a02', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-0000000000a4', '26770000-0000-0000-0000-0000000000a5', 'Closed one', 'Open'),
  ('26770000-0000-0000-0000-000000000a03', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', null, '26770000-0000-0000-0000-0000000000a4', null, 'No project', 'Open'),
  ('26770000-0000-0000-0000-000000000a05', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-0000000000a4', null, 'Cap', 'Open'),
  ('26770000-0000-0000-0000-000000000a08', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-0000000000a4', null, 'Legacy via RPC', 'Open'),
  ('26770000-0000-0000-0000-000000000a07', '26770000-0000-0000-0000-00000000000c', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000dc', null, null, 'Off org', 'Open');
-- a legacy issue: its single task linked through the 1026 column, as before this change
insert into tasks (id, org_id, project_id, name) values
  ('26770000-0000-0000-0000-000000000f04', '26770000-0000-0000-0000-00000000000a', '26770000-0000-0000-0000-0000000000d1', 'Legacy task');
alter table incident_reports disable trigger incident_reports_zz_issue_guard;
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, action, status, task_id) values
  ('26770000-0000-0000-0000-000000000a04', '26770000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-0000000000a4', 'Legacy', 'Open', '26770000-0000-0000-0000-000000000f04');
alter table incident_reports enable trigger incident_reports_zz_issue_guard;
update incident_reports set status = 'Closed' where id = '26770000-0000-0000-0000-000000000a02';

-- ── AC-ITR-001 several tasks ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Replace the rail', '26770000-0000-0000-0000-0000000000a5', '2050-01-01') $$,
  'AC-ITR-001: a manager adds a first task');
select lives_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Order the part', null, null) $$,
  'AC-ITR-001: a manager adds a second task to the same issue');
reset role;
select is((select count(*) from incident_tasks where incident_id = '26770000-0000-0000-0000-000000000a01'), 2::bigint, 'AC-ITR-001: two links exist');
select is((select count(*) from tasks t join incident_tasks l on l.task_id = t.id
            where l.incident_id = '26770000-0000-0000-0000-000000000a01' and t.project_id = '26770000-0000-0000-0000-0000000000d1'
              and t.org_id = '26770000-0000-0000-0000-00000000000a'), 2::bigint, 'AC-ITR-001: both tasks are in the issue''s project and org');
select is((select t.assignee_id from tasks t where t.name = 'Replace the rail'), '26770000-0000-0000-0000-0000000000a5'::uuid, 'AC-ITR-001: the task carries the assignee');
select is((select t.end_date from tasks t where t.name = 'Replace the rail'), '2050-01-01'::date, 'AC-ITR-001: the task carries the due day');
select is((select l.created_by from incident_tasks l join tasks t on t.id = l.task_id where t.name = 'Order the part'), '26770000-0000-0000-0000-0000000000a3'::uuid, 'AC-ITR-001: the link records who added it');

-- ── AC-ITR-002 who may add, and what is refused ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Engineer task') $$,
  '42501', 'only a manager may add a task to an issue', 'AC-ITR-002: an Engineer cannot add a task');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Foreign task') $$,
  '42501', 'issue not found', 'AC-ITR-002: a user of another organisation finds no such issue');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a07', 'Off task') $$,
  '42501', 'incidents are switched off', 'AC-ITR-002: refused while the incidents entitlement is off');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a02', 'Late task') $$,
  '23514', 'a closed issue takes no new task', 'AC-ITR-002: a closed issue takes no new task');
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a03', 'No project task') $$,
  '23514', 'name the issue''s project before making a task', 'AC-ITR-002: an issue with no project is refused');
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', '   ') $$,
  '23514', 'a task needs a name', 'AC-ITR-002: an empty name is refused');
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Bad assignee', '26770000-0000-0000-0000-0000000000b1') $$,
  '23514', 'assignee must be an active member of this org', 'AC-ITR-002: a foreign assignee is refused');
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01', 'Gone assignee', '26770000-0000-0000-0000-0000000000a6') $$,
  '23514', 'assignee must be an active member of this org', 'AC-ITR-002: an inactive assignee is refused');
reset role;
insert into tasks (org_id, project_id, name)
  select '26770000-0000-0000-0000-00000000000a', '26770000-0000-0000-0000-0000000000d1', 'cap ' || g from generate_series(1, 100) g;
insert into incident_tasks (incident_id, task_id, org_id)
  select '26770000-0000-0000-0000-000000000a05', t.id, t.org_id from tasks t where t.name like 'cap %';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a05', 'One too many') $$,
  '23514', 'this issue has the most tasks it can take', 'AC-ITR-002: the 101st task is refused');
reset role;
select is((select count(*) from tasks where name in ('Engineer task','Foreign task','Off task','Late task','No project task','Bad assignee','Gone assignee','One too many')), 0::bigint,
  'AC-ITR-002: no refused call left a task behind');

-- ── AC-ITR-003 no client write on the link ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ insert into incident_tasks (incident_id, task_id) values ('26770000-0000-0000-0000-000000000a01', '26770000-0000-0000-0000-000000000f04') $$,
  '42501', null, 'AC-ITR-003: an Admin cannot insert a link directly');
select throws_ok($$ update incident_tasks set incident_id = '26770000-0000-0000-0000-000000000a05' $$,
  '42501', null, 'AC-ITR-003: an Admin cannot move a link');
select throws_ok($$ delete from incident_tasks $$, '42501', null, 'AC-ITR-003: an Admin cannot delete a link');
reset role;
select is((select count(*) from incident_tasks where incident_id = '26770000-0000-0000-0000-000000000a01'), 2::bigint, 'AC-ITR-003: the links survive');

-- ── AC-ITR-004 the legacy link ───────────────────────────────────────────────────────────────────────
-- (a04 was inserted after the migration's backfill ran, so mirror it the way the migration did, then prove the trigger path)
select is((select count(*) from incident_reports where id = '26770000-0000-0000-0000-000000000a04' and task_id = '26770000-0000-0000-0000-000000000f04'), 1::bigint,
  'AC-ITR-004: a legacy task_id is untouched');
insert into incident_tasks (incident_id, task_id, org_id)
  select i.id, i.task_id, i.org_id from incident_reports i where i.id = '26770000-0000-0000-0000-000000000a04';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.create_task_from_incident('26770000-0000-0000-0000-000000000a08') $$, 'AC-ITR-004: the legacy RPC still makes a task');
select throws_ok($$ select public.create_task_from_incident('26770000-0000-0000-0000-000000000a08') $$,
  '23505', 'this issue already has a task', 'AC-ITR-004: the legacy RPC still refuses a second');
select lives_ok($$ select public.add_task_to_incident('26770000-0000-0000-0000-000000000a08', 'Second task via new RPC') $$, 'AC-ITR-004: the new RPC adds a further task to a legacy-linked issue');
reset role;
select is((select count(*) from incident_tasks l join incident_reports i on i.id = l.incident_id and i.task_id = l.task_id
            where i.id = '26770000-0000-0000-0000-000000000a08'), 1::bigint, 'AC-ITR-004: the legacy RPC''s task is mirrored into the list');
select is((select count(*) from incident_tasks where incident_id = '26770000-0000-0000-0000-000000000a08'), 2::bigint, 'AC-ITR-004: the list holds both tasks of that issue');

-- ── AC-ITR-005 reads ─────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*) from incident_tasks where incident_id = '26770000-0000-0000-0000-000000000a01'), 2::bigint, 'AC-ITR-005: a member of the org reads the issue''s tasks');
select is((select array_agg(t.name order by l.created_at) from incident_tasks l join tasks t on t.id = l.task_id where l.incident_id = '26770000-0000-0000-0000-000000000a01'),
  array['Replace the rail','Order the part'], 'AC-ITR-005: listed in creation order') ;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from incident_tasks), 0::bigint, 'AC-ITR-005: another organisation reads none');
reset role;
update incident_tasks set org_id = '26770000-0000-0000-0000-00000000000c' where false;
insert into tasks (id, org_id, project_id, name) values ('26770000-0000-0000-0000-000000000f07', '26770000-0000-0000-0000-00000000000c', '26770000-0000-0000-0000-0000000000dc', 'Off task row');
insert into incident_tasks (incident_id, task_id, org_id) values ('26770000-0000-0000-0000-000000000a07', '26770000-0000-0000-0000-000000000f07', '26770000-0000-0000-0000-00000000000c');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*) from incident_tasks), 0::bigint, 'AC-ITR-005: entitlement off reads none');
reset role;

-- ── AC-ITR-006 root cause ────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set root_cause = 'Wrong fixing spec' where id = '26770000-0000-0000-0000-000000000a01';
select is((select root_cause from incident_reports where id = '26770000-0000-0000-0000-000000000a01'), 'Wrong fixing spec', 'AC-ITR-006: a manager saves the root cause');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a5","role":"authenticated"}';
update incident_reports set root_cause = 'Supplier changed the bolt' where id = '26770000-0000-0000-0000-000000000a01';
select is((select root_cause from incident_reports where id = '26770000-0000-0000-0000-000000000a01'), 'Supplier changed the bolt', 'AC-ITR-006: the assignee saves the root cause');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update incident_reports set root_cause = 'Reporter guess' where id = '26770000-0000-0000-0000-000000000a01';
select is((select root_cause from incident_reports where id = '26770000-0000-0000-0000-000000000a01'), 'Supplier changed the bolt', 'AC-ITR-006: the reporter-only Engineer cannot change it');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ update incident_reports set action = 'Reassigned by assignee', root_cause = 'x' where id = '26770000-0000-0000-0000-000000000a01' $$,
  '42501', 'only a manager may change the assignee, due time, work order or action', 'AC-ITR-006: the assignee still cannot change other fields');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ update incident_reports set root_cause = repeat('x', 1001) where id = '26770000-0000-0000-0000-000000000a01' $$,
  '23514', null, 'AC-ITR-006: over 1000 characters is refused');
update incident_reports set root_cause = 'Found after closing' where id = '26770000-0000-0000-0000-000000000a02';
select is((select root_cause from incident_reports where id = '26770000-0000-0000-0000-000000000a02'), 'Found after closing', 'AC-ITR-006: a closed issue still takes a root cause');
reset role;
select is((select root_cause from incident_reports where id = '26770000-0000-0000-0000-000000000a04'), null, 'AC-ITR-006: legacy issues have a null root cause');

-- ── AC-ITR-007 independence ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set status = 'Closed' where id = '26770000-0000-0000-0000-000000000a01';
reset role;
select is((select count(*) from tasks t join incident_tasks l on l.task_id = t.id where l.incident_id = '26770000-0000-0000-0000-000000000a01' and t.status = 'Done'), 0::bigint,
  'AC-ITR-007: closing the issue closes no task');
update tasks set status = 'Done' where name = 'Replace the rail';
select is((select status::text from incident_reports where id = '26770000-0000-0000-0000-000000000a01'), 'Closed', 'AC-ITR-007: a task being Done does not touch the issue');
select is((select count(*) from tasks t join incident_tasks l on l.task_id = t.id where l.incident_id = '26770000-0000-0000-0000-000000000a01' and t.status <> 'Done'), 1::bigint,
  'AC-ITR-007: the other task is unchanged');

select * from finish();
rollback;
