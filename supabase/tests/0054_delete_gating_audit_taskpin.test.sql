-- 0054_delete_gating_audit_taskpin.test.sql — delete-gating consistency + audit stamp + task pin (0017).
-- Proves:
--   • project_documents hard-DELETE is Admin-only server-side (restrictive policy):
--       AC-DOC-210  PM denied delete (restrictive Admin gate → 0-row no-op).
--       AC-DOC-211  Engineer denied delete (no permissive write grant → 0-row no-op).
--       AC-DOC-212  Admin CAN delete (the affordance works).
--   • incident_reports hard-DELETE is Admin-only server-side (previously NO delete policy = silent no-op):
--       AC-IN-210  PM denied delete (no permissive grant → 0-row no-op).
--       AC-IN-211  Engineer denied delete (no permissive grant → 0-row no-op).
--       AC-IN-212  Admin CAN delete (the affordance now works).
--   • incident_reports.reported_by is authentically stamped from auth.uid() on the create path:
--       AC-IN-220  an Engineer-filed incident records reported_by = the caller's uid.
--   • the 0017 task column pin also rejects an Engineer change to created_at:
--       AC-TASK-210  an Engineer assignee cannot change created_at on their own task → 42501.
begin;
select plan(11);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
insert into auth.users (id, email) values
  ('00540000-0000-0000-0000-0000000000a1','del-pm@example.com'),
  ('00540000-0000-0000-0000-0000000000a2','del-eng@example.com'),
  ('00540000-0000-0000-0000-0000000000a3','del-admin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00540000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','DEL PM','del-pm@example.com','Project Manager'),
  ('00540000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','DEL Eng','del-eng@example.com','Engineer'),
  ('00540000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','DEL Admin','del-admin@example.com','Admin');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00540000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
   'DEL-PRJ','Delete Gating Project','Ongoing Project','00540000-0000-0000-0000-0000000000a1');

-- A document + an incident + a task to attempt deletes / edits against.
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00540000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00540000-0000-0000-0000-000000000010','DEL-DOC-001','Drawing','Delete Me Doc','Draft',
   '00540000-0000-0000-0000-0000000000a1');
insert into incident_reports (id, org_id, incident_date, type, severity, status, reported_by) values
  ('00540000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001',
   '2026-06-01','Near Miss','Low','Open','00540000-0000-0000-0000-0000000000a2');
insert into tasks (id, org_id, project_id, name, status, assignee_id) values
  ('00540000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000001',
   '00540000-0000-0000-0000-000000000010','Pinned Task','To Do','00540000-0000-0000-0000-0000000000a2');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-210/211 + AC-IN-210/211: PM + Engineer denied hard-delete (run before the Admin deletes).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00540000-0000-0000-0000-0000000000a1","role":"authenticated"}';  -- PM
select lives_ok(
  $$ delete from project_documents where id = '00540000-0000-0000-0000-000000000030' $$,
  'AC-DOC-210: a PM DELETE of a document runs without error (restrictive Admin gate → RLS 0-row no-op)');
select lives_ok(
  $$ delete from incident_reports where id = '00540000-0000-0000-0000-000000000040' $$,
  'AC-IN-210: a PM DELETE of an incident runs without error (no permissive grant → RLS 0-row no-op)');

set local request.jwt.claims = '{"sub":"00540000-0000-0000-0000-0000000000a2","role":"authenticated"}';  -- Engineer
select lives_ok(
  $$ delete from project_documents where id = '00540000-0000-0000-0000-000000000030' $$,
  'AC-DOC-211: an Engineer DELETE of a document runs without error (no permissive grant → RLS 0-row no-op)');
select lives_ok(
  $$ delete from incident_reports where id = '00540000-0000-0000-0000-000000000040' $$,
  'AC-IN-211: an Engineer DELETE of an incident runs without error (no permissive grant → RLS 0-row no-op)');

reset role;
-- Confirm nothing was deleted by the PM/Engineer attempts.
select is(
  (select count(*)::int from project_documents where id = '00540000-0000-0000-0000-000000000030'),
  1, 'AC-DOC-210/211: the document still exists after the PM + Engineer delete attempts');
select is(
  (select count(*)::int from incident_reports where id = '00540000-0000-0000-0000-000000000040'),
  1, 'AC-IN-210/211: the incident still exists after the PM + Engineer delete attempts');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-TASK-210: an Engineer assignee cannot change created_at on their own task → 42501.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00540000-0000-0000-0000-0000000000a2","role":"authenticated"}';  -- Engineer (assignee)
select throws_ok(
  $$ update tasks set created_at = '2020-01-01T00:00:00Z' where id = '00540000-0000-0000-0000-000000000050' $$,
  '42501', null,
  'AC-TASK-210: an Engineer assignee cannot change created_at on their own task (column pin → 42501)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IN-220: incident_reports.reported_by is stamped from auth.uid() on the Engineer create path.
-- ════════════════════════════════════════════════════════════════════════════
insert into incident_reports (incident_date, type, severity)
  values ('2026-06-08','Spill','High');

reset role;
select is(
  (select reported_by::text from incident_reports where type = 'Spill'),
  '00540000-0000-0000-0000-0000000000a2',
  'AC-IN-220: the Engineer-filed incident stamps reported_by = the caller''s uid (audit authenticity)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-212 + AC-IN-212: Admin CAN hard-delete a document AND an incident.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00540000-0000-0000-0000-0000000000a3","role":"authenticated"}';  -- Admin
select lives_ok(
  $$ delete from project_documents where id = '00540000-0000-0000-0000-000000000030' $$,
  'AC-DOC-212: Admin can hard-delete a document');
select lives_ok(
  $$ delete from incident_reports where id = '00540000-0000-0000-0000-000000000040' $$,
  'AC-IN-212: Admin can hard-delete an incident (the affordance now works server-side)');

reset role;
select is(
  (select count(*)::int from project_documents where id = '00540000-0000-0000-0000-000000000030')
    + (select count(*)::int from incident_reports where id = '00540000-0000-0000-0000-000000000040'),
  0, 'AC-DOC-212/AC-IN-212: both the document and the incident are gone after the Admin deletes');

select * from finish();
rollback;
