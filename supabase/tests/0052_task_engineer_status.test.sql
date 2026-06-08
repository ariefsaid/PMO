-- 0052_task_engineer_status.test.sql — the Tasks Engineer own-status RLS contract (CRUD+RBAC Tasks slice).
-- Proves migration 0016 widens tasks RLS so an assignee Engineer can UPDATE the STATUS of their OWN
-- task and ONLY the status (column-pinned), on top of the EXISTING tasks_write FOR ALL policy
-- (org + the four delivery/master write-roles) + the parent-project org guard:
--   AC-TASK-101  an Engineer assignee CAN update the status of their OWN task (To Do → In Progress).
--   AC-TASK-102  an Engineer assignee CANNOT change a NON-status column on their own task (name) → 42501.
--   AC-TASK-103  an Engineer assignee CANNOT reassign their own task away (assignee_id) → 42501.
--   AC-TASK-104  an Engineer who is NOT the assignee CANNOT update another's task status (USING hides → 0-row no-op).
--   AC-TASK-105  an Engineer CANNOT INSERT a task (tasks_write WITH CHECK role gate → 42501).
--   AC-TASK-106  an Engineer CANNOT DELETE a task (no permissive policy grants Engineer delete → 0-row no-op).
--   AC-TASK-107  a manager (PM) retains FULL structure edit (rename + reassign + status) on any task.
--   AC-TASK-108  cross-org isolation: an org-B Engineer cannot touch an org-A task (USING hides → 0-row no-op).
-- RLS is the enforcement authority; the FE gating (policy.ts taskStatus.edit) is only a clarity projection
-- (rbac-visibility.md §F). The column pin is realized by the BEFORE UPDATE trigger enforce_assignee_status_only;
-- the own-row scope by the permissive tasks_update_own_status policy. `is distinct from` is null-safe.
begin;
select plan(14);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org ('00000000-…-0001') so a write-role satisfies the org WITH CHECK without
-- sending org_id (the production path). Org-B is the cross-org attacker. Unique 00520000-… namespace.
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000002','Tasks Engineer Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','tk-eng@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','tk-eng2@example.com'),
  ('00520000-0000-0000-0000-0000000000a3','tk-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','tk-eng-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','TK Eng','tk-eng@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','TK Eng2','tk-eng2@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','TK PM','tk-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','TK Eng B','tk-eng-b@example.com','Engineer');

insert into projects (id, org_id, code, name, status) values
  ('00520000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','TK-001','Tasks Project','Ongoing Project');

-- T1 assigned to Engineer a1; T2 assigned to Engineer a2 (the "someone else's task").
insert into tasks (id, org_id, project_id, name, status, assignee_id) values
  ('00520000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','00520000-0000-0000-0000-000000000010','Survey site','To Do','00520000-0000-0000-0000-0000000000a1'),
  ('00520000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','00520000-0000-0000-0000-000000000010','Mobilise crew','To Do','00520000-0000-0000-0000-0000000000a2');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-TASK-101/102/103/104/105/106: Engineer a1 (assignee of T1) — run first, baselines untouched.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-TASK-101: the assignee Engineer CAN update the status of their OWN task.
select lives_ok(
  $$ update tasks set status = 'In Progress' where id = '00520000-0000-0000-0000-000000000021' $$,
  'AC-TASK-101: an Engineer assignee can update the STATUS of their own task');

-- AC-TASK-102: a NON-status column change on the own task is rejected by the column-pin trigger → 42501.
select throws_ok(
  $$ update tasks set name = 'Renamed by engineer' where id = '00520000-0000-0000-0000-000000000021' $$,
  '42501', null,
  'AC-TASK-102: an Engineer assignee cannot change a non-status column (name) on their own task → 42501');

-- AC-TASK-103: reassigning the own task away (assignee_id) is rejected by the column-pin trigger → 42501.
select throws_ok(
  $$ update tasks set assignee_id = '00520000-0000-0000-0000-0000000000a2'
       where id = '00520000-0000-0000-0000-000000000021' $$,
  '42501', null,
  'AC-TASK-103: an Engineer assignee cannot reassign their own task away → 42501');

-- AC-TASK-104: the Engineer is NOT the assignee of T2 → the own-status policy USING hides the row,
-- and tasks_write excludes the Engineer role, so the UPDATE matches no rows (silent 0-row no-op).
select lives_ok(
  $$ update tasks set status = 'Done' where id = '00520000-0000-0000-0000-000000000022' $$,
  'AC-TASK-104: an Engineer updating ANOTHER user''s task status runs without error (USING hides → RLS no-op)');

-- AC-TASK-105: the Engineer cannot INSERT a task (tasks_write WITH CHECK role gate denies) → 42501.
select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
       values (auth_org_id(), '00520000-0000-0000-0000-000000000010', 'Eng Task', 'To Do') $$,
  '42501', null,
  'AC-TASK-105: an Engineer cannot INSERT a task (tasks_write WITH CHECK role gate → 42501)');

-- AC-TASK-106: the Engineer cannot DELETE a task (no permissive policy grants Engineer delete → no-op).
select lives_ok(
  $$ delete from tasks where id = '00520000-0000-0000-0000-000000000021' $$,
  'AC-TASK-106: an Engineer DELETE of a task runs without error (no permissive grant → RLS 0-row no-op)');

reset role;

-- Confirm the own-task STATUS change persisted (AC-TASK-101) and nothing else moved.
select is(
  (select status::text from tasks where id = '00520000-0000-0000-0000-000000000021'),
  'In Progress',
  'AC-TASK-101: the Engineer''s own-task status change persisted');
select is(
  (select name from tasks where id = '00520000-0000-0000-0000-000000000021'),
  'Survey site',
  'AC-TASK-102: the task name is unchanged (the non-status edit was rejected, not partially applied)');
select is(
  (select assignee_id::text from tasks where id = '00520000-0000-0000-0000-000000000021'),
  '00520000-0000-0000-0000-0000000000a1',
  'AC-TASK-103: the task assignee is unchanged (the reassign was rejected)');
-- Confirm AC-TASK-104 was a no-op: T2 still To Do, and AC-TASK-106 deleted nothing: T1 still present.
select is(
  (select status::text from tasks where id = '00520000-0000-0000-0000-000000000022'),
  'To Do',
  'AC-TASK-104: another user''s task status was NOT changed by the Engineer (0-row no-op)');
select ok(
  (select exists (select 1 from tasks where id = '00520000-0000-0000-0000-000000000021')),
  'AC-TASK-106: the Engineer DELETE affected 0 rows (the task still exists)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-TASK-107: a manager (PM) retains FULL structure edit (rename + reassign + status).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ update tasks set name = 'Survey site (PM)', assignee_id = '00520000-0000-0000-0000-0000000000a2', status = 'Done'
       where id = '00520000-0000-0000-0000-000000000021' $$,
  'AC-TASK-107: a PM can edit a task''s name + assignee + status (full structure edit retained)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-TASK-108: cross-org isolation — an org-B Engineer cannot touch an org-A task.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- The org-B Engineer is not the assignee AND not in org-A → every policy USING hides the row → 0-row no-op.
select lives_ok(
  $$ update tasks set status = 'Blocked' where id = '00520000-0000-0000-0000-000000000022' $$,
  'AC-TASK-108: a cross-org Engineer UPDATE of an org-A task runs without error (USING hides → RLS no-op)');

reset role;

select is(
  (select status::text from tasks where id = '00520000-0000-0000-0000-000000000022'),
  'To Do',
  'AC-TASK-108: the org-A task status was NOT changed by the cross-org Engineer');

select * from finish();
rollback;
