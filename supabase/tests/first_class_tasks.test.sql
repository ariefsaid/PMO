-- first_class_tasks.test.sql — #525 / FR-FCT-001..015. Owns AC-FCT-001..018.
-- `grep -r AC-FCT-` finds exactly this file.
--
-- ⚑ WRITTEN BEFORE THE MIGRATION, and that ordering is the point (spec §5.1). Written afterwards
-- these get written to match whatever shipped. Several fail today at the INSERT with a NOT NULL
-- violation rather than on their assertion — that is a legitimate red, and each is shaped so it
-- turns green for ITS OWN reason afterwards, not merely because the insert started working.
--
-- The defect: the four `tasks` write policies DISAGREE on a NULL project_id. `tasks_insert`,
-- `tasks_update` and `tasks_delete` all deny via `exists (select 1 from projects …)`; only
-- `tasks_update_own_status` passes. So a project-less task would be writable by its Engineer
-- assignee and by nobody else — every manager locked out, and locked out SILENTLY: a `using` denial
-- hides the row, so UPDATE/DELETE are 0-row no-ops that the DAL reports as success.
begin;
select plan(15);

insert into organizations (id, name) values
  ('05250000-0000-0000-0000-000000000001','FCT Org'),
  ('05250000-0000-0000-0000-000000000002','FCT Other Org');
insert into auth.users (id, email) values
  ('05250000-0000-0000-0000-0000000000a1','fct-pm@example.com'),
  ('05250000-0000-0000-0000-0000000000a2','fct-eng@example.com'),
  ('05250000-0000-0000-0000-0000000000a3','fct-pm2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05250000-0000-0000-0000-0000000000a1','05250000-0000-0000-0000-000000000001','FCT PM','fct-pm@example.com','Project Manager','active'),
  ('05250000-0000-0000-0000-0000000000a2','05250000-0000-0000-0000-000000000001','FCT Eng','fct-eng@example.com','Engineer','active'),
  ('05250000-0000-0000-0000-0000000000a3','05250000-0000-0000-0000-000000000001','FCT PM2','fct-pm2@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('05250000-0000-0000-0000-000000000fd1','05250000-0000-0000-0000-000000000001','FCT Project','Ongoing Project');
insert into project_milestones (id, org_id, project_id, name, target_date) values
  ('05250000-0000-0000-0000-00000000fb01','05250000-0000-0000-0000-000000000001',
   '05250000-0000-0000-0000-000000000fd1','FCT Milestone','2026-12-31');

-- ── §A — the column and its one invariant. ──────────────────────────────────────────────────────
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='project_id'),
  'YES',
  'AC-FCT-001 tasks.project_id is nullable — a task can exist before anything owns it');

select is(
  (select confdeltype from pg_constraint
    where conrelid='public.tasks'::regclass and contype='f'
      and conkey = array[(select attnum from pg_attribute
                           where attrelid='public.tasks'::regclass and attname='project_id')]),
  'c'::"char",
  'AC-FCT-002 the FK keeps ON DELETE CASCADE — a project-less task is one that was NEVER given a '
  'project, never one orphaned by a deletion (set null would silently convert deleted work into '
  '"unassigned" work)');

-- ⚑ FR-FCT-004, and this is the one the audit found that nobody had recorded: EVERY server-side
-- rollup joins tasks through `milestone_id`, never `project_id`. Without this CHECK a project-less
-- task carrying a borrowed milestone id MOVES A PROJECT'S DELIVERY PERCENTAGE.
select throws_ok(
  $$ insert into tasks (id, org_id, project_id, milestone_id, name, status)
     values ('05250000-0000-0000-0000-00000000fc09','05250000-0000-0000-0000-000000000001',
             null,'05250000-0000-0000-0000-00000000fb01','FCT orphan with milestone','To Do') $$,
  '23514',
  null,
  'AC-FCT-003 a task with no project may not carry a milestone — every rollup joins through '
  'milestone_id, so this would move a project''s delivery percentage from outside it');

select lives_ok(
  $$ insert into tasks (id, org_id, project_id, milestone_id, name, status)
     values ('05250000-0000-0000-0000-00000000fc08','05250000-0000-0000-0000-000000000001',
             '05250000-0000-0000-0000-000000000fd1','05250000-0000-0000-0000-00000000fb01','FCT milestone task','To Do') $$,
  'AC-FCT-004 CONTROL a task WITH a project may carry that project''s milestone');

select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='timesheet_entries' and column_name='project_id'),
  'NO',
  'AC-FCT-005 timesheet_entries.project_id stays NOT NULL — logging time needs a project, and this '
  'slice does not touch the timesheet contract (DD-TASK-5)');

select is(
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='meeting_id'),
  0,
  'AC-FCT-006 NO second nullable parent lands here — meeting_id takes its own migration, so the '
  'dangerous change is reviewed on its own diff (DD-TASK-2)');

-- ── §B — THE FOUR POLICIES AGREE. ───────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into tasks (id, org_id, project_id, name, status)
     values ('05250000-0000-0000-0000-00000000fc01','05250000-0000-0000-0000-000000000001',
             null,'FCT project-less','To Do') $$,
  'AC-FCT-010 a Project Manager may CREATE a project-less task');

select lives_ok(
  $$ update tasks set name = 'FCT renamed'
      where id = '05250000-0000-0000-0000-00000000fc01' $$,
  'AC-FCT-011 …and may EDIT it');

-- ⚑ The lock-out this issue exists to prevent was SILENT: a `using` denial hides the row, so the
-- UPDATE is a 0-row no-op the DAL reports as success. A `lives_ok` alone would therefore pass
-- against the broken policy set — the row count is what actually proves the write landed.
select is(
  (select name from tasks where id = '05250000-0000-0000-0000-00000000fc01'),
  'FCT renamed',
  'AC-FCT-012 …and the edit PERSISTED. A using-denial is a 0-row no-op, so lives_ok alone would '
  'pass against the very lock-out this proves is gone');

select lives_ok(
  $$ delete from tasks where id = '05250000-0000-0000-0000-00000000fc01' $$,
  'AC-FCT-013 …and may DELETE it');

select is(
  (select count(*)::int from tasks where id = '05250000-0000-0000-0000-00000000fc01'),
  0,
  'AC-FCT-014 …and the delete PERSISTED — same reason as AC-FCT-012');

-- ── §C — the tenancy guard is UNCHANGED for project-carrying rows. ──────────────────────────────
reset role;
insert into projects (id, org_id, name, status) values
  ('05250000-0000-0000-0000-000000000fd2','05250000-0000-0000-0000-000000000002','FCT Foreign Project','Ongoing Project');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into tasks (id, org_id, project_id, name, status)
     values ('05250000-0000-0000-0000-00000000fc02','05250000-0000-0000-0000-000000000001',
             '05250000-0000-0000-0000-000000000fd2','FCT cross-org','To Do') $$,
  '42501',
  null,
  'AC-FCT-015 a task naming ANOTHER ORG''s project is still refused — admitting project-less rows '
  'must not weaken the guard for project-carrying ones');
-- ⚑ MUTATION NOTE, recorded because the next reader will otherwise "simplify" it away: removing
-- `and p.org_id = auth_org_id()` from the EXISTS does NOT redden the assertion above. The subquery is
-- evaluated as the CALLER, so `projects_select` RLS already makes a foreign org's project invisible
-- and the EXISTS fails on visibility alone. The explicit clause is therefore defence in depth, not
-- the sole cause — the assertion pins the OUTCOME (refused), which is the thing that matters, and
-- deleting the clause would leave the outcome resting on one layer instead of two.

-- ── §D — the assignee keeps exactly the scope they have today, and no more. ─────────────────────
reset role;
insert into tasks (id, org_id, project_id, name, status, assignee_id) values
  ('05250000-0000-0000-0000-00000000fc03','05250000-0000-0000-0000-000000000001',
   null,'FCT assigned orphan','To Do','05250000-0000-0000-0000-0000000000a2');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ update tasks set status = 'In Progress'
      where id = '05250000-0000-0000-0000-00000000fc03' $$,
  'AC-FCT-016 the assignee of a project-less task may still move its STATUS');

-- ⚑ THE WIDER-DOOR CASE. Today a PM who IS the assignee passes tasks_update_own_status and then hits
-- the write-role early return in enforce_assignee_status_only — a FULL structure edit, on a row an
-- unassigned PM cannot touch at all. The Engineer path must stay status-only whatever the project is.
select throws_ok(
  $$ update tasks set name = 'FCT assignee rename'
      where id = '05250000-0000-0000-0000-00000000fc03' $$,
  '42501',
  'only the task status may be changed by its assignee',
  'AC-FCT-017 …but NOT its name. The assignee path is status-only on a project-less task exactly as '
  'it is on a project-carrying one — it must not become a full-edit door');

reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='tasks' and policyname='tasks_select'),
  1,
  'AC-FCT-018 tasks_select is untouched — the read path derives tenancy from the task''s OWN org_id '
  'and never consults project_id (#462''s "read path unaffected" claim, confirmed)');

select * from finish();
rollback;
