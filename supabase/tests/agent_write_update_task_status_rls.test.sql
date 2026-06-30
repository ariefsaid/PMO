-- agent_write_update_task_status_rls.test.sql — column-pinned own-task status proof (A3).
-- AC-AW-010: update_task_status is column-pinned to the assignee for Engineer role.
--
-- The agent's updateTaskStatusAction.run executes:
--   ctx.supabase.from('tasks').update({ status }).eq('id', taskId)
-- This is identical to a direct `update tasks set status=... where id=...` under the caller JWT.
-- The existing RLS + trigger (migration 0016) is the authority; this test PROVES the agent path
-- respects it — no new migration is needed.
--
-- Assertions:
--   AC-AW-010-a  Engineer B (assignee of T1) CAN update T1's status ('To Do' → 'Done').
--   AC-AW-010-b  Engineer B updating T2 (assignee ≠ B) returns 0 rows (USING hides → RLS no-op).
--
-- Uses unique UUID namespace 00AD0010-… to avoid collisions.
begin;
select plan(4);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Use the default org (00000000-…-0001) so org_id defaults satisfy RLS without sending it.
-- (Mirrors the pattern in 0052_task_engineer_status.test.sql.)
insert into auth.users (id, email) values
  ('00ad0010-0000-0000-0000-0000000000b1','aw010-eng-b@example.com'),
  ('00ad0010-0000-0000-0000-0000000000b2','aw010-eng-b2@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00ad0010-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001',
   'AW010 Eng B','aw010-eng-b@example.com','Engineer'),
  ('00ad0010-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000001',
   'AW010 Eng B2','aw010-eng-b2@example.com','Engineer');

insert into projects (id, org_id, code, name, status) values
  ('00ad0010-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
   'AW010-001','AW010 Project','Ongoing Project');

-- T1 assigned to Engineer B (the subject); T2 assigned to someone else.
insert into tasks (id, org_id, project_id, name, status, assignee_id) values
  ('00ad0010-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',
   '00ad0010-0000-0000-0000-000000000010','AW010 Task 1','To Do',
   '00ad0010-0000-0000-0000-0000000000b1'),
  ('00ad0010-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001',
   '00ad0010-0000-0000-0000-000000000010','AW010 Task 2','To Do',
   '00ad0010-0000-0000-0000-0000000000b2');

-- ── AC-AW-010-a: Engineer B CAN update their own task (T1) status ────────────
-- The exact path updateTaskStatusAction.run follows under Engineer B's JWT.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00ad0010-0000-0000-0000-0000000000b1","role":"authenticated"}';

select lives_ok(
  $$ update tasks set status = 'Done' where id = '00ad0010-0000-0000-0000-000000000021' $$,
  'AC-AW-010-a: Engineer B can update the status of their own assigned task (agent update_task_status path)');

-- ── AC-AW-010-b: Engineer B updating T2 (not their task) → 0 rows (RLS hides) ──
-- The agent can call update but RLS USING hides the non-own row → 0-row no-op.
-- Proves the agent cannot update another user's task by passing a different taskId.
select lives_ok(
  $$ update tasks set status = 'Done' where id = '00ad0010-0000-0000-0000-000000000022' $$,
  'AC-AW-010-b: Engineer B UPDATE on another user''s task runs without error (USING hides → 0-row no-op)');

reset role;

-- Confirm T1's status changed (AC-AW-010-a was a real write) and T2 did NOT change (AC-AW-010-b no-op).
select is(
  (select status::text from tasks where id = '00ad0010-0000-0000-0000-000000000021'),
  'Done',
  'AC-AW-010-a: T1 status persisted to Done (own-task update succeeded)');

select is(
  (select status::text from tasks where id = '00ad0010-0000-0000-0000-000000000022'),
  'To Do',
  'AC-AW-010-b: T2 status unchanged (USING-hidden non-own task, 0-row no-op)');

select finish();
rollback;
