-- 0979_site_issue_log.test.sql — #2521 (docs/specs/site-issue-log.spec.md; plan docs/plans/2026-11-20-site-issue-log.md).
-- Migrations under test: 0979_site_issue_log_columns.sql, 0980_site_issue_files.sql, 0981_site_issue_escalation_and_task.sql.
-- AC-SIL-001 work order on the issue's project · AC-SIL-002 close stamps are the database's · AC-SIL-003 reporter vs assignee vs manager ·
-- AC-SIL-004 close proof for High/Critical · AC-SIL-005 another org reads and adds nothing (row and storage object) ·
-- AC-SIL-006 the overdue job escalates once · AC-SIL-007 moving the due time clears the escalation · AC-SIL-008 switch off = no-op ·
-- AC-SIL-009 one task per issue through one RPC.
-- Fixtures are written as the table owner (no auth.uid(), the privileged path); every client check runs as `authenticated` with a JWT.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name, default_currency) values
  ('25210000-0000-0000-0000-00000000000a', 'SIL Org',   'IDR'),
  ('25210000-0000-0000-0000-00000000000b', 'SIL Other', 'IDR'),
  ('25210000-0000-0000-0000-00000000000c', 'SIL Off',   'IDR');
insert into auth.users (id, email) values
  ('25210000-0000-0000-0000-0000000000a1', 'sil-admin@example.com'),
  ('25210000-0000-0000-0000-0000000000a3', 'sil-pm@example.com'),
  ('25210000-0000-0000-0000-0000000000a4', 'sil-reporter@example.com'),
  ('25210000-0000-0000-0000-0000000000a5', 'sil-assignee@example.com'),
  ('25210000-0000-0000-0000-0000000000b1', 'sil-xorg@example.com'),
  ('25210000-0000-0000-0000-0000000000c1', 'sil-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25210000-0000-0000-0000-0000000000a1', '25210000-0000-0000-0000-00000000000a', 'SIL Admin',    'sil-admin@example.com',    'Admin', 'active'),
  ('25210000-0000-0000-0000-0000000000a3', '25210000-0000-0000-0000-00000000000a', 'SIL PM',       'sil-pm@example.com',       'Project Manager', 'active'),
  ('25210000-0000-0000-0000-0000000000a4', '25210000-0000-0000-0000-00000000000a', 'SIL Reporter', 'sil-reporter@example.com', 'Engineer', 'active'),
  ('25210000-0000-0000-0000-0000000000a5', '25210000-0000-0000-0000-00000000000a', 'SIL Assignee', 'sil-assignee@example.com', 'Engineer', 'active'),
  ('25210000-0000-0000-0000-0000000000b1', '25210000-0000-0000-0000-00000000000b', 'SIL XOrg',     'sil-xorg@example.com',     'Admin', 'active'),
  ('25210000-0000-0000-0000-0000000000c1', '25210000-0000-0000-0000-00000000000c', 'SIL Off',      'sil-off@example.com',      'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-00000000000a', 'SIL Site',       'Ongoing Project', '25210000-0000-0000-0000-0000000000a3'),
  ('25210000-0000-0000-0000-0000000000d2', '25210000-0000-0000-0000-00000000000a', 'SIL Site Two',   'Ongoing Project', '25210000-0000-0000-0000-0000000000a3'),
  ('25210000-0000-0000-0000-0000000000d9', '25210000-0000-0000-0000-00000000000b', 'SIL Other Site', 'Ongoing Project', null),
  ('25210000-0000-0000-0000-0000000000dc', '25210000-0000-0000-0000-00000000000c', 'SIL Off Site',   'Ongoing Project', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25210000-0000-0000-0000-000000000401', '25210000-0000-0000-0000-00000000000a', '25210000-0000-0000-0000-0000000000d1', 'SIL WO one', 'Issued', 10000, 'exclusive', 0),
  ('25210000-0000-0000-0000-000000000402', '25210000-0000-0000-0000-00000000000a', '25210000-0000-0000-0000-0000000000d2', 'SIL WO two', 'Issued', 10000, 'exclusive', 0),
  ('25210000-0000-0000-0000-000000000409', '25210000-0000-0000-0000-00000000000b', '25210000-0000-0000-0000-0000000000d9', 'SIL WO other', 'Issued', 10000, 'exclusive', 0);
insert into org_features (org_id, feature_key, enabled) values ('25210000-0000-0000-0000-00000000000c', 'incidents', false);

-- ── AC-SIL-001 ───────────────────────────────────────────────────────────────────────────────────────
select lives_ok($$ insert into incident_reports (id, org_id, incident_date, type, severity, project_id, work_order_id, reported_by) values
  ('25210000-0000-0000-0000-000000000a01', '25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',
   '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-000000000401', '25210000-0000-0000-0000-0000000000a4') $$,
  'AC-SIL-001: an issue may name a work order of its own project');
select throws_ok($$ insert into incident_reports (org_id, incident_date, type, severity, project_id, work_order_id) values
  ('25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',
   '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-000000000402') $$,
  '23514', 'work order belongs to another project', 'AC-SIL-001: a work order of another project is refused');
select throws_ok($$ insert into incident_reports (org_id, incident_date, type, severity, work_order_id) values
  ('25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', '25210000-0000-0000-0000-000000000401') $$,
  '23514', 'a work order needs the issue to name its project', 'AC-SIL-001: a work order needs the project named');
select throws_ok($$ insert into incident_reports (org_id, incident_date, type, severity, project_id, work_order_id) values
  ('25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',
   '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-000000000409') $$,
  '42501', 'work order not in this org', 'AC-SIL-001: a work order of another org is refused');

-- ── fixtures for the rest: an issue per scenario ─────────────────────────────────────────────────────
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, assignee_id, action, status) values
  ('25210000-0000-0000-0000-000000000a02', '25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',  '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4', '25210000-0000-0000-0000-0000000000a5', 'Fix the rail', 'Open'),
  ('25210000-0000-0000-0000-000000000a03', '25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'High', '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4', '25210000-0000-0000-0000-0000000000a5', 'Fix the crane', 'Open'),
  ('25210000-0000-0000-0000-000000000a04', '25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',  '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4', '25210000-0000-0000-0000-0000000000a5', 'Fix the gate', 'Open');

-- ── AC-SIL-002 close stamps ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set status = 'Closed', closed_at = '2000-01-01', closed_by = '25210000-0000-0000-0000-0000000000a4'
 where id = '25210000-0000-0000-0000-000000000a02';
reset role;
select ok((select closed_at > now() - interval '5 minutes' from incident_reports where id = '25210000-0000-0000-0000-000000000a02'),
  'AC-SIL-002: closed_at is stamped by the database, the supplied value is ignored');
select is((select closed_by from incident_reports where id = '25210000-0000-0000-0000-000000000a02'),
  '25210000-0000-0000-0000-0000000000a3'::uuid, 'AC-SIL-002: closed_by is the closing user, not the supplied one');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set status = 'Open' where id = '25210000-0000-0000-0000-000000000a02';
reset role;
select ok((select closed_at is null and closed_by is null from incident_reports where id = '25210000-0000-0000-0000-000000000a02'),
  'AC-SIL-002: reopening clears the close stamps');
select is((select count(*) from audit_events where action = 'incident.reopened' and entity_id = '25210000-0000-0000-0000-000000000a02'),
  1::bigint, 'AC-SIL-002: reopening writes an audit row');

-- ── AC-SIL-003 reporter vs assignee vs manager ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update incident_reports set assignee_id = '25210000-0000-0000-0000-0000000000a4', due_at = now() + interval '3 days'
 where id = '25210000-0000-0000-0000-000000000a04';
select throws_ok($$ insert into incident_reports (org_id, incident_date, type, severity, due_at) values
  ('25210000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low', now() - interval '1 day') $$,
  '23514', 'due time cannot be in the past', 'AC-SIL-003: a due time in the past is refused on creation');
reset role;
select is((select assignee_id from incident_reports where id = '25210000-0000-0000-0000-000000000a04'),
  '25210000-0000-0000-0000-0000000000a5'::uuid, 'AC-SIL-003: the reporter cannot reassign (row is not theirs to update)');
select ok((select due_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a04'),
  'AC-SIL-003: the reporter cannot set the due time');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ update incident_reports set due_at = now() + interval '9 days' where id = '25210000-0000-0000-0000-000000000a04' $$,
  '42501', 'only a manager may change the assignee, due time, work order or action', 'AC-SIL-003: the assignee cannot move the due time');
select throws_ok($$ update incident_reports set assignee_id = '25210000-0000-0000-0000-0000000000a4' where id = '25210000-0000-0000-0000-000000000a04' $$,
  '42501', 'only a manager may change the assignee, due time, work order or action', 'AC-SIL-003: the assignee cannot reassign');
select lives_ok($$ update incident_reports set status = 'Investigating', close_note = 'on it' where id = '25210000-0000-0000-0000-000000000a04' $$,
  'AC-SIL-003: the assignee may add a note and set Investigating');
select lives_ok($$ update incident_reports set status = 'Closed', close_note = 'done' where id = '25210000-0000-0000-0000-000000000a04' $$,
  'AC-SIL-003: the assignee may close a Low issue');
select throws_ok($$ update incident_reports set status = 'Open' where id = '25210000-0000-0000-0000-000000000a04' $$,
  '42501', 'only a manager may reopen an issue', 'AC-SIL-003: the assignee cannot reopen');
reset role;

-- ── AC-SIL-004 close proof (mutation-checked: make guard_incident_close_proof always pass → the first two go red) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  '23514', 'a High or Critical issue needs a close photo before it can be closed', 'AC-SIL-004: a High issue without a close photo cannot close');
select lives_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000f01', '25210000-0000-0000-0000-000000000a03', 'at_raise', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/f01/raise.jpg') $$,
  'AC-SIL-004: a manager adds a raise photo');
select throws_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  '23514', 'a High or Critical issue needs a close photo before it can be closed', 'AC-SIL-004: a raise photo is not close proof');
insert into incident_files (id, incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000f02', '25210000-0000-0000-0000-000000000a03', 'at_close', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/f02/close.jpg');
select lives_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  'AC-SIL-004: with a close photo the High issue closes');
reset role;

-- ── AC-SIL-005 another org ───────────────────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name) values
  ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/f02/close.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ insert into incident_files (incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000a03', 'at_raise', 'x/y/z/w.jpg') $$,
  '42501', null, 'AC-SIL-005: another org cannot add a file to the issue');
select is((select count(*) from incident_files), 0::bigint, 'AC-SIL-005: another org reads no file rows');
select is((select count(*) from storage.objects where bucket_id = 'incident-files'), 0::bigint, 'AC-SIL-005: another org reads no storage object');
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'incident-files'), 1::bigint, 'AC-SIL-005: a member of the org reads the object');
reset role;

-- ── AC-SIL-006 / 007 / 008 the overdue job ───────────────────────────────────────────────────────────
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, assignee_id, due_at) values
  ('25210000-0000-0000-0000-000000000a06', '25210000-0000-0000-0000-00000000000a', '2026-11-10', 'Defect', 'Low',
   '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4', '25210000-0000-0000-0000-0000000000a5', now() - interval '2 hours');
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by, due_at) values
  ('25210000-0000-0000-0000-000000000a08', '25210000-0000-0000-0000-00000000000c', '2026-11-10', 'Defect', 'Low',
   '25210000-0000-0000-0000-0000000000dc', '25210000-0000-0000-0000-0000000000c1', now() - interval '2 hours');
select is(public.escalate_overdue_incidents(), 1, 'AC-SIL-006: the first run escalates the one overdue issue (the switched-off org is skipped)');
select is(public.escalate_overdue_incidents(), 0, 'AC-SIL-006: a second run escalates nothing');
select is((select count(*) from notifications where metadata -> 'entity' ->> 'id' = '25210000-0000-0000-0000-000000000a06'), 2::bigint,
  'AC-SIL-006: one notification each to the assignee and the project manager');
select is((select count(*) from audit_events where action = 'incident.escalated' and entity_id = '25210000-0000-0000-0000-000000000a06'), 1::bigint,
  'AC-SIL-006: one audit row');
select ok((select escalated_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a08'),
  'AC-SIL-008: an org with the incidents switch off is left alone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set due_at = now() + interval '2 days' where id = '25210000-0000-0000-0000-000000000a06';
reset role;
select ok((select escalated_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a06'),
  'AC-SIL-007: moving the due time forward clears the escalation');
update incident_reports set due_at = now() - interval '1 minute' where id = '25210000-0000-0000-0000-000000000a06';
select is(public.escalate_overdue_incidents(), 1, 'AC-SIL-007: a later miss escalates again');
select is((select count(*) from audit_events where action = 'incident.escalated' and entity_id = '25210000-0000-0000-0000-000000000a06'), 2::bigint,
  'AC-SIL-007: the audit keeps both escalations');

-- ── AC-SIL-009 one task per issue ────────────────────────────────────────────────────────────────────
update incident_reports set due_at = now() + interval '5 days', escalated_at = null where id = '25210000-0000-0000-0000-000000000a06';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a06') $$,
  '42501', 'only a manager may create a task from an issue', 'AC-SIL-009: a non-manager cannot make the task');
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a06') $$, 'AC-SIL-009: a manager makes a task from the issue');
select is((select i.task_id from incident_reports i where i.id = '25210000-0000-0000-0000-000000000a06'), (select t.id from tasks t where t.project_id = '25210000-0000-0000-0000-0000000000d1'),
  'AC-SIL-009: the issue links to the new task');
select ok((select t.project_id = '25210000-0000-0000-0000-0000000000d1' and t.assignee_id = '25210000-0000-0000-0000-0000000000a5'
                  and t.end_date is not null from tasks t where t.id = (select t.id from tasks t where t.project_id = '25210000-0000-0000-0000-0000000000d1')),
  'AC-SIL-009: the task carries the issue''s project, assignee and due date');
select throws_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a06') $$,
  '23505', 'this issue already has a task', 'AC-SIL-009: a second attempt is refused');
update incident_reports set task_id = null where id = '25210000-0000-0000-0000-000000000a06';
select is((select count(*) from incident_reports where id = '25210000-0000-0000-0000-000000000a06' and task_id is not null), 1::bigint,
  'AC-SIL-009: a client cannot unlink or relink the task');
select throws_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a09') $$,
  '42501', 'issue not found', 'AC-SIL-009: an unknown issue is refused');
reset role;
select is((select count(*) from tasks where project_id = '25210000-0000-0000-0000-0000000000d1'), 1::bigint, 'AC-SIL-009: exactly one task was made');

select * from finish();
rollback;
