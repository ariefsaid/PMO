-- 1390_issue_tasks_root_cause.test.sql — #2677 (docs/specs/issue-tasks-root-cause.spec.md).
-- Migrations under test: 1390_incident_tasks, 1391_incident_root_cause, 1392_add_task_to_incident.
-- AC-ITR-001 several tasks · 002 who may add · 003 no client write · 004 legacy link mirrored · 005 reads · 006 root cause · 007 independence.
-- Fixtures are written as the table owner; every client check runs as `authenticated` with a JWT.
begin;
create extension if not exists pgtap;
select plan(10);

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


set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01','Reporter followup','26770000-0000-0000-0000-0000000000a5')$$, 'JOB-PC17 reporter adds a task [mut:reporter_task]');
update incident_reports set root_cause='Coordination' where id='26770000-0000-0000-0000-000000000a01';
select is((select root_cause from incident_reports where id='26770000-0000-0000-0000-000000000a01'),'Coordination','JOB-PC17 reporter saves root cause');
select throws_ok($$update incident_reports set status='Investigating' where id='26770000-0000-0000-0000-000000000a01'$$,'42501',null,'JOB-PC17 reporter cannot move issue status [mut:reporter_root_scope]');
select throws_ok($$select public.add_task_to_incident('26770000-0000-0000-0000-000000000a02','Late')$$,'23514',null,'JOB-PC17 closed issue refuses reporter task');
update incident_reports set root_cause='Late cause' where id='26770000-0000-0000-0000-000000000a02';
select is((select root_cause from incident_reports where id='26770000-0000-0000-0000-000000000a02'),null,'JOB-PC17 closed issue refuses reporter root cause');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01','Unrelated')$$,'42501',null,'JOB-PC17 same-level non-author refuses task');
select is((select count(*) from tasks where name='Reporter followup' and assignee_id=auth.uid()),1::bigint,'JOB-PC17 assigned task appears in normal task read');
reset role;
update incident_reports set assignee_id=null, reported_by=null where id='26770000-0000-0000-0000-000000000a03';
set local role authenticated;
select throws_ok($$select public.add_task_to_incident('26770000-0000-0000-0000-000000000a03','Imported')$$,'42501',null,'JOB-PC17 an imported issue gives no reporter authority');
update incident_reports set root_cause='Unrelated' where id='26770000-0000-0000-0000-000000000a03';
select is((select root_cause from incident_reports where id='26770000-0000-0000-0000-000000000a03'),null,'JOB-PC17 same-level non-author cannot save root cause');
reset role;
update profiles set built_in_role='field_user' where id='26770000-0000-0000-0000-0000000000a4';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.add_task_to_incident('26770000-0000-0000-0000-000000000a01','Field')$$,'42501',null,'JOB-PC17 field-account rules retained');
reset role;
select * from finish();
rollback;
