-- 0355_finance_task_scope.test.sql — Finance is scoped on tasks exactly like an Engineer
-- (owner ruling 2026-10-23). Migration under test: supabase/migrations/0355_finance_task_scope.sql.
--
-- Finance MAY create a task, edit a task it CREATED (work fields only), and set the status of a task
-- ASSIGNED to it. Finance may NOT edit or delete anyone else's task, nor archive a task. Engineer and
-- Project Manager behaviour is pinned unchanged alongside.
-- ⚑ Fixtures are asymmetric (creator ≠ assignee) so the creator and assignee paths stay distinguishable.
-- ⚑ Row-modifying assertions COUNT ROWS via top-level CTEs: an RLS-denied UPDATE/DELETE is a silent
-- 0-row no-op, not an error, so lives_ok would pass whether the policy admits or refuses the caller.
-- ================================================================================================

begin;
select plan(20);

insert into organizations (id, name) values
  ('03550000-0000-0000-0000-000000000001','Finance Task Scope Org');

insert into auth.users (id, email) values
  ('03550000-0000-0000-0000-0000000000a1','fts-finance@example.com'),
  ('03550000-0000-0000-0000-0000000000e1','fts-engineer@example.com'),
  ('03550000-0000-0000-0000-0000000000f1','fts-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('03550000-0000-0000-0000-0000000000a1','03550000-0000-0000-0000-000000000001','Fin One','fts-finance@example.com','Finance','active'),
  ('03550000-0000-0000-0000-0000000000e1','03550000-0000-0000-0000-000000000001','Eng One','fts-engineer@example.com','Engineer','active'),
  ('03550000-0000-0000-0000-0000000000f1','03550000-0000-0000-0000-000000000001','PM One','fts-pm@example.com','Project Manager','active');

insert into projects (id, org_id, code, name, status) values
  ('03550000-0000-0000-0000-000000000010','03550000-0000-0000-0000-000000000001','FTS','Finance Task Scope Project','Ongoing Project');

-- Server-authority rows, all authored by the PM:
--   201 — assigned to the Engineer: nobody's but the PM's (Finance must not touch it).
--   202 — assigned to Finance: Finance may set its status, nothing more.
--   203 — a delete target for the Finance/Engineer refusals and the PM control.
reset role;
insert into tasks (id, org_id, project_id, name, status, assignee_id, created_by) values
  ('03550000-0000-0000-0000-000000000201','03550000-0000-0000-0000-000000000001','03550000-0000-0000-0000-000000000010','PM Task for Eng','To Do','03550000-0000-0000-0000-0000000000e1','03550000-0000-0000-0000-0000000000f1'),
  ('03550000-0000-0000-0000-000000000202','03550000-0000-0000-0000-000000000001','03550000-0000-0000-0000-000000000010','PM Task for Fin','To Do','03550000-0000-0000-0000-0000000000a1','03550000-0000-0000-0000-0000000000f1'),
  ('03550000-0000-0000-0000-000000000203','03550000-0000-0000-0000-000000000001','03550000-0000-0000-0000-000000000010','PM Task to Delete','To Do',null,'03550000-0000-0000-0000-0000000000f1');

-- ── §1 — Finance: create + edit own ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"03550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$
  insert into tasks (id, org_id, project_id, name, status, assignee_id)
  values ('03550000-0000-0000-0000-000000000101','03550000-0000-0000-0000-000000000001',
          '03550000-0000-0000-0000-000000000010','Finance-created task','To Do',
          '03550000-0000-0000-0000-0000000000e1')
$$, 'AC-TASK-FIN-001 Finance may create a task');

with u as (
  update tasks set name = 'Renamed by Finance creator'
   where id = '03550000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TASK-FIN-001 Finance may edit a task it created');

-- ── §2 — Finance: someone else's task is refused ────────────────────────────────────────────────
with u as (
  update tasks set name = 'Hijacked by Finance'
   where id = '03550000-0000-0000-0000-000000000201' returning 1)
select is((select count(*)::int from u), 0,
  'AC-TASK-FIN-001 Finance may NOT edit a task it neither created nor is assigned');

with d as (
  delete from tasks where id = '03550000-0000-0000-0000-000000000203' returning 1)
select is((select count(*)::int from d), 0,
  'AC-TASK-FIN-001 Finance may NOT delete someone else''s task');

with d as (
  delete from tasks where id = '03550000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from d), 0,
  'AC-TASK-FIN-001 Finance may NOT delete even a task it created (delete stays with managers)');

-- ── §3 — Finance as assignee: status only ───────────────────────────────────────────────────────
with u as (
  update tasks set status = 'In Progress'
   where id = '03550000-0000-0000-0000-000000000202' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TASK-FIN-001 Finance may set the status of a task assigned to it');

select throws_ok($$
  update tasks set name = 'Assignee rename' where id = '03550000-0000-0000-0000-000000000202'
$$, '42501', 'only the task status may be changed by its assignee',
  'AC-TASK-FIN-001 Finance as assignee may NOT edit fields other than status');

-- ── §4 — Finance may not archive (lifecycle column), not even its own task ─────────────────────
select throws_ok($$
  update tasks set archived_at = now() where id = '03550000-0000-0000-0000-000000000101'
$$, '42501', 'creator may edit task fields, not lifecycle or provenance columns',
  'AC-TASK-FIN-001 Finance may NOT archive a task, even one it created');

-- ── §5 — the rows Finance was refused are genuinely unchanged (read as server authority) ───────
reset role;
select is((select name from tasks where id = '03550000-0000-0000-0000-000000000201'), 'PM Task for Eng',
  'AC-TASK-FIN-001 the other person''s task is unchanged after Finance''s refused edit');
select is((select count(*)::int from tasks where id = '03550000-0000-0000-0000-000000000203'), 1,
  'AC-TASK-FIN-001 the other person''s task still exists after Finance''s refused delete');
select is((select count(*)::int from tasks where id = '03550000-0000-0000-0000-000000000101'), 1,
  'AC-TASK-FIN-001 Finance''s own task still exists after its refused delete');
select is((select name from tasks where id = '03550000-0000-0000-0000-000000000202'), 'PM Task for Fin',
  'AC-TASK-FIN-001 the assigned task''s name is unchanged after the refused assignee rename');
select ok((select archived_at is null from tasks where id = '03550000-0000-0000-0000-000000000101'),
  'AC-TASK-FIN-001 Finance''s own task is not archived after the refused archive');

-- ── §6 — Engineer behaviour unchanged ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"03550000-0000-0000-0000-0000000000e1","role":"authenticated"}';

with u as (
  update tasks set name = 'Hijacked by Engineer'
   where id = '03550000-0000-0000-0000-000000000202' returning 1)
select is((select count(*)::int from u), 0,
  'AC-TASK-FIN-001 CONTROL an Engineer still may NOT edit someone else''s task');

with d as (
  delete from tasks where id = '03550000-0000-0000-0000-000000000203' returning 1)
select is((select count(*)::int from d), 0,
  'AC-TASK-FIN-001 CONTROL an Engineer still may NOT delete a task');

with u as (
  update tasks set status = 'In Progress'
   where id = '03550000-0000-0000-0000-000000000201' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TASK-FIN-001 CONTROL an Engineer still sets the status of a task assigned to them');

-- ── §7 — Project Manager unchanged ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"03550000-0000-0000-0000-0000000000f1","role":"authenticated"}';

with u as (
  update tasks set name = 'Renamed by PM'
   where id = '03550000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TASK-FIN-001 CONTROL a Project Manager still edits a task someone else created');

with u as (
  update tasks set archived_at = now()
   where id = '03550000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-TASK-FIN-001 CONTROL a Project Manager still archives a task');

with d as (
  delete from tasks where id = '03550000-0000-0000-0000-000000000203' returning 1)
select is((select count(*)::int from d), 1,
  'AC-TASK-FIN-001 CONTROL a Project Manager still deletes a task');

-- ── §8 — policy shape: is_active_member() still composes every task write policy ───────────────
reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'tasks' and cmd in ('UPDATE','DELETE','INSERT')
      and coalesce(qual, with_check) like '%is_active_member()%'),
  4,
  'AC-TASK-FIN-001 every task write policy still carries is_active_member()');

select * from finish();
rollback;
