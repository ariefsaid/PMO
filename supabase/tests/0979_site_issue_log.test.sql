-- 0979_site_issue_log.test.sql — #2521 (docs/specs/site-issue-log.spec.md; plan docs/plans/2026-11-20-site-issue-log.md).
-- Migrations under test: 1026_site_issue_log_columns.sql, 1027_site_issue_files.sql, 0981_site_issue_escalation_and_task.sql.
-- AC-SIL-001 work order on the issue's project · AC-SIL-002 close stamps are the database's · AC-SIL-003 reporter vs assignee vs manager ·
-- AC-SIL-004 close proof for High/Critical · AC-SIL-005 another org reads and adds nothing (row and storage object) ·
-- AC-SIL-006 the overdue job escalates once · AC-SIL-007 moving the due time clears the escalation · AC-SIL-008 switch off = no-op ·
-- AC-SIL-009 one task per issue through one RPC.
-- Fixtures are written as the table owner (no auth.uid(), the privileged path); every client check runs as `authenticated` with a JWT.
begin;
create extension if not exists pgtap;
select plan(67);

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
select throws_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a04' $$,
  '23514', 'an assignee must investigate before closing', 'AC-SIL-003: the assignee cannot skip investigation');
select lives_ok($$ update incident_reports set status = 'Investigating', close_note = 'on it' where id = '25210000-0000-0000-0000-000000000a04' $$,
  'AC-SIL-003: the assignee may add a note and set Investigating');
select lives_ok($$ update incident_reports set status = 'Closed', close_note = 'done' where id = '25210000-0000-0000-0000-000000000a04' $$,
  'AC-SIL-003: the assignee may close a Low issue');
select throws_ok($$ update incident_reports set status = 'Open' where id = '25210000-0000-0000-0000-000000000a04' $$,
  '42501', 'only a manager may reopen an issue', 'AC-SIL-003: the assignee cannot reopen');
reset role;

insert into storage.objects (bucket_id, name) values
  ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f01/raise.jpg'),
  ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg');

-- ── AC-SIL-004 close proof (mutation-checked: make guard_incident_close_proof always pass → the first two go red) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  '23514', 'a High or Critical issue needs a close photo before it can be closed', 'AC-SIL-004: a High issue without a close photo cannot close');
select lives_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000f01', '25210000-0000-0000-0000-000000000a03', 'at_raise', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f01/raise.jpg') $$,
  'AC-SIL-004: a manager adds a raise photo');
select throws_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  '23514', 'a High or Critical issue needs a close photo before it can be closed', 'AC-SIL-004: a raise photo is not close proof');
insert into incident_files (id, incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000f02', '25210000-0000-0000-0000-000000000a03', 'at_close', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg');
select lives_ok($$ update incident_reports set status = 'Closed' where id = '25210000-0000-0000-0000-000000000a03' $$,
  'AC-SIL-004: with a close photo the High issue closes');
reset role;

-- ── AC-SIL-005 another org ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ insert into incident_files (incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000a03', 'at_raise', 'x/y/z/w.jpg') $$,
  '42501', null, 'AC-SIL-005: another org cannot add a file to the issue');
select is((select count(*) from incident_files), 0::bigint, 'AC-SIL-005: another org reads no file rows');
select is((select count(*) from storage.objects where bucket_id = 'incident-files'), 0::bigint, 'AC-SIL-005: another org reads no storage object');
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'incident-files'), 2::bigint, 'AC-SIL-005: a member of the org reads the object');
reset role;

-- Cron runs without a user JWT; reset the previous caller's claims as well as the SQL role.
set local request.jwt.claims = '{}';

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
select lives_ok($$ insert into storage.objects (bucket_id, name) values
 ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f10/raise.jpg') $$,
 'AC-SIL-008: a manager can upload when incidents are enabled');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$ insert into storage.objects (bucket_id, name) values
 ('incident-files', '25210000-0000-0000-0000-00000000000c/25210000-0000-0000-0000-000000000a08/25210000-0000-0000-0000-000000000f09/raise.jpg') $$,
 '42501', null, 'AC-SIL-008: storage upload is refused when incidents are disabled');
reset role;
set local request.jwt.claims = '{}';

-- The global entitlement is authoritative even when the org has no override.
insert into incident_reports (id, org_id, incident_date, type, severity, due_at)
values ('25210000-0000-0000-0000-000000000a0d', '25210000-0000-0000-0000-00000000000a', current_date, 'Defect', 'Low', now() - interval '1 hour');
update global_features set enabled = false where feature_key = 'incidents';
select is(public.escalate_overdue_incidents(), 0, 'AC-SIL-008: the job skips issues when the global entitlement is off');
select ok((select escalated_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a0d'),
  'AC-SIL-008: global off leaves the issue untouched');
update global_features set enabled = true where feature_key = 'incidents';
update incident_reports set due_at = null where id = '25210000-0000-0000-0000-000000000a0d';

set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set due_at = now() + interval '2 days' where id = '25210000-0000-0000-0000-000000000a06';
reset role;
select ok((select escalated_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a06'),
  'AC-SIL-007: moving the due time forward clears the escalation');
update incident_reports set due_at = now() - interval '1 minute' where id = '25210000-0000-0000-0000-000000000a06';
set local request.jwt.claims = '{}';
select is(public.escalate_overdue_incidents(), 1, 'AC-SIL-007: a later miss escalates again');
select is((select count(*) from audit_events where action = 'incident.escalated' and entity_id = '25210000-0000-0000-0000-000000000a06'), 2::bigint,
  'AC-SIL-007: the audit keeps both escalations');

-- A targeted pass is used by the end-to-end journey without changing other tests' issues.
insert into incident_reports (id, org_id, incident_date, type, severity, due_at) values
 ('25210000-0000-0000-0000-000000000a0e', '25210000-0000-0000-0000-00000000000a', current_date, 'Defect', 'Low', now() - interval '1 hour'),
 ('25210000-0000-0000-0000-000000000a0f', '25210000-0000-0000-0000-00000000000a', current_date, 'Defect', 'Low', now() - interval '1 hour');
select lives_ok($$ select public.escalate_overdue_incidents('25210000-0000-0000-0000-000000000a0e'::uuid) $$,
  'AC-SIL-014: a targeted pass can run the scheduled escalation for the journey');
select ok((select escalated_at is null from incident_reports where id = '25210000-0000-0000-0000-000000000a0f'),
  'AC-SIL-014: a targeted pass does not alter another issue');
update incident_reports set due_at = null where id in ('25210000-0000-0000-0000-000000000a0e','25210000-0000-0000-0000-000000000a0f');

-- A disabled project manager cannot receive a notification: use the active Admin fallback.
update profiles set status = 'disabled' where id = '25210000-0000-0000-0000-0000000000a3';
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, due_at) values
 ('25210000-0000-0000-0000-000000000a10', '25210000-0000-0000-0000-00000000000a', current_date, 'Defect', 'Low',
  '25210000-0000-0000-0000-0000000000d1', now() - interval '1 hour');
select lives_ok($$ select public.escalate_overdue_incidents('25210000-0000-0000-0000-000000000a10'::uuid) $$,
  'AC-SIL-006: escalation handles a disabled project manager');
select is((select count(*) from notifications where owner_id = '25210000-0000-0000-0000-0000000000a1'
  and metadata -> 'entity' ->> 'id' = '25210000-0000-0000-0000-000000000a10'), 1::bigint,
  'AC-SIL-006: an active Admin is notified when the project manager is disabled');
update profiles set status = 'active' where id = '25210000-0000-0000-0000-0000000000a3';

-- ── AC-SIL-009 one task per issue ────────────────────────────────────────────────────────────────────
update profiles set timezone = 'America/Los_Angeles' where id = '25210000-0000-0000-0000-0000000000a3';
update incident_reports set due_at = '2050-01-02 07:59:00+00', escalated_at = null where id = '25210000-0000-0000-0000-000000000a06';
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
select is((select t.end_date from tasks t join incident_reports i on i.task_id = t.id where i.id = '25210000-0000-0000-0000-000000000a06'),
  '2050-01-01'::date, 'AC-SIL-009: task due day follows the caller’s resolved timezone west of UTC');
select throws_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a06') $$,
  '23505', 'this issue already has a task', 'AC-SIL-009: a second attempt is refused');
update incident_reports set task_id = null where id = '25210000-0000-0000-0000-000000000a06';
select is((select count(*) from incident_reports where id = '25210000-0000-0000-0000-000000000a06' and task_id is not null), 1::bigint,
  'AC-SIL-009: a client cannot unlink or relink the task');
select throws_ok($$ select public.create_task_from_incident('25210000-0000-0000-0000-000000000a09') $$,
  '42501', 'issue not found', 'AC-SIL-009: an unknown issue is refused');
reset role;
select is((select count(*) from tasks where project_id = '25210000-0000-0000-0000-0000000000d1'), 1::bigint, 'AC-SIL-009: exactly one task was made');

-- Evidence rows must refer to the actual uploaded object and cannot be retargeted.
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
  ('25210000-0000-0000-0000-000000000f03', '25210000-0000-0000-0000-000000000a04', 'at_close', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a04/25210000-0000-0000-0000-000000000f03/missing.jpg') $$,
  '23514', 'evidence object is missing or invalid', 'AC-SIL-004: a fabricated close attachment is refused');
select throws_ok($$ update incident_files set incident_id = '25210000-0000-0000-0000-000000000a04'
  where id = '25210000-0000-0000-0000-000000000f02' $$,
  '42501', 'only archiving evidence is allowed', 'AC-SIL-004: evidence cannot be moved to another issue');
reset role;

-- The Storage API permits this operation; the transaction-local setting models its delete path.
set local storage.allow_delete_query = 'true';
-- An uploader can clean an orphan after a failed metadata insert, but cannot delete recorded evidence.
set local request.jwt.claims = '{}';
insert into storage.objects (bucket_id, name, owner_id) values
 ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f08/orphan.jpg', '25210000-0000-0000-0000-0000000000a3');
update storage.objects set owner_id = '25210000-0000-0000-0000-0000000000a3'
 where bucket_id = 'incident-files' and name = '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
with changed as (delete from storage.objects where bucket_id = 'incident-files'
 and name = '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f08/orphan.jpg' returning 1)
select is((select count(*) from changed), 1::bigint, 'AC-SIL-010: uploader can remove an unrecorded orphan');
with changed as (delete from storage.objects where bucket_id = 'incident-files'
 and name = '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg' returning 1)
select is((select count(*) from changed), 0::bigint, 'AC-SIL-010: recorded evidence cannot be removed through orphan cleanup');
reset role;

select throws_ok($$ delete from storage.objects where bucket_id = 'incident-files'
 and name = '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg' $$,
 '23503', null, 'AC-SIL-004: the database prevents deleting an object while evidence references it');
select is((select count(*) from storage.objects where bucket_id = 'incident-files'
 and name = '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a03/25210000-0000-0000-0000-000000000f02/close.jpg'),
 1::bigint, 'AC-SIL-004: the recorded proof object remains after a delete attempt');

-- A full raise-photo set does not consume a close-proof slot.
set local request.jwt.claims = '{}';
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by)
values ('25210000-0000-0000-0000-000000000a0b', '25210000-0000-0000-0000-00000000000a', current_date,
        'Defect', 'High', '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4');
insert into storage.objects (bucket_id, name)
select 'incident-files', 'fixture/raise/' || n from generate_series(1,10) n;
insert into incident_files (incident_id, kind, file_path)
select '25210000-0000-0000-0000-000000000a0b', 'at_raise', 'fixture/raise/' || n from generate_series(1,10) n;
insert into storage.objects (bucket_id, name) values
 ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0b/25210000-0000-0000-0000-000000000f04/close.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
 ('25210000-0000-0000-0000-000000000f04', '25210000-0000-0000-0000-000000000a0b', 'at_close',
  '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0b/25210000-0000-0000-0000-000000000f04/close.jpg') $$,
 'AC-SIL-004: close proof can be added when ten raise files exist');
reset role;

set local request.jwt.claims = '{}';
insert into storage.objects (bucket_id, name) values
 ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0b/25210000-0000-0000-0000-000000000f06/raise.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
 ('25210000-0000-0000-0000-000000000f06', '25210000-0000-0000-0000-000000000a0b', 'at_raise',
  '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0b/25210000-0000-0000-0000-000000000f06/raise.jpg') $$,
 '23514', 'an issue holds at most 10 raise attachments', 'AC-SIL-010: an eleventh raise attachment is refused');
reset role;

set local request.jwt.claims = '{}';
insert into storage.objects (bucket_id, name) values ('incident-files', 'fixture/archived');
insert into incident_files (id, incident_id, kind, file_path, archived_at)
values ('25210000-0000-0000-0000-000000000f07', '25210000-0000-0000-0000-000000000a0b', 'at_raise', 'fixture/archived', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ update incident_files set archived_at = null where id = '25210000-0000-0000-0000-000000000f07' $$,
 '23514', 'an issue holds at most 10 raise attachments', 'AC-SIL-010: restoring an eleventh raise attachment is refused');
reset role;

set local request.jwt.claims = '{}';
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by)
values ('25210000-0000-0000-0000-000000000a0c', '25210000-0000-0000-0000-00000000000a', current_date,
        'Defect', 'High', '25210000-0000-0000-0000-0000000000d1', '25210000-0000-0000-0000-0000000000a4');
insert into storage.objects (bucket_id, name)
select 'incident-files', 'fixture/close/' || n from generate_series(1,5) n;
insert into incident_files (incident_id, kind, file_path)
select '25210000-0000-0000-0000-000000000a0c', 'at_close', 'fixture/close/' || n from generate_series(1,5) n;
insert into storage.objects (bucket_id, name) values
 ('incident-files', '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0c/25210000-0000-0000-0000-000000000f05/close.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ insert into incident_files (id, incident_id, kind, file_path) values
 ('25210000-0000-0000-0000-000000000f05', '25210000-0000-0000-0000-000000000a0c', 'at_close',
  '25210000-0000-0000-0000-00000000000a/25210000-0000-0000-0000-000000000a0c/25210000-0000-0000-0000-000000000f05/close.jpg') $$,
 '23514', 'an issue holds at most 5 close attachments', 'AC-SIL-004: a sixth close attachment is refused');
reset role;

select ok(exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'incident_files' and grantee = 'authenticated' and privilege_type = 'SELECT'), 'authenticated has evidence select privilege');
select ok(exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'incident_files' and grantee = 'authenticated' and privilege_type = 'INSERT'), 'authenticated has evidence insert privilege');
select ok(exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'incident_files' and grantee = 'authenticated' and privilege_type = 'UPDATE'), 'authenticated has evidence update privilege');
-- Inspect the deployed catalog, including grants and function ownership, not just policy text.
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.incident_files'::regclass),
  'evidence table enforces RLS even for its owner');
select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
  and table_name = 'incident_files' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE','DELETE')),
  'anonymous role has no evidence write grant');
select ok((select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'incident_files'
  and policyname in ('incident_files_select','incident_files_insert','incident_files_update')),
  'evidence select, insert and update policies are installed');
select ok((select count(*) = 6 and bool_and(p.prosecdef and p.proowner = 'postgres'::regrole
  and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')
  and not has_function_privilege('anon', p.oid, 'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname in ('guard_incident_issue_fields','can_add_incident_evidence','guard_incident_file',
    'guard_incident_close_proof','escalate_overdue_incidents','create_task_from_incident')),
  'issue definers have the expected owner, pinned search path and no anonymous execute');

select * from finish();
rollback;
