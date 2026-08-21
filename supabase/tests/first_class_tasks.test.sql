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
select plan(24);

insert into organizations (id, name) values
  ('05250000-0000-0000-0000-000000000001','FCT Org'),
  ('05250000-0000-0000-0000-000000000002','FCT Other Org');
insert into auth.users (id, email) values
  ('05250000-0000-0000-0000-0000000000a1','fct-pm@example.com'),
  ('05250000-0000-0000-0000-0000000000a2','fct-eng@example.com'),
  ('05250000-0000-0000-0000-0000000000a3','fct-pm2@example.com');
insert into auth.users (id, email) values
  ('05250000-0000-0000-0000-0000000000a4','fct-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  -- ⛔ An OFFBOARDED Project Manager. `auth_role()` reads profiles.role with NO status filter, so
  -- this row still answers 'Project Manager' to every policy that asks.
  ('05250000-0000-0000-0000-0000000000a4','05250000-0000-0000-0000-000000000001','FCT Gone','fct-gone@example.com','Project Manager','disabled'),
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

-- ── §E — the guard §1 made vacuous, and the tenancy floor on the new path. ──────────────────────
-- Both are about the SAME hole: with `project_id` nullable, comparisons that used to imply tenancy
-- stop implying it. These prove the implication is now stated rather than inherited.
reset role;
insert into tasks (id, org_id, project_id, name, status) values
  ('05250000-0000-0000-0000-00000000fd01','05250000-0000-0000-0000-000000000002',
   null,'FCT foreign orphan','To Do');
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into tasks (org_id, project_id, parent_task_id, name, status)
     values ('05250000-0000-0000-0000-000000000001', null,
             '05250000-0000-0000-0000-00000000fd01','FCT cross-org child','To Do') $$,
  '42501',
  'parent task must be in the same project',
  'AC-FCT-019 a project-less task may NOT parent another org''s project-less task. Both project_ids '
  'being NULL made 0140''s `is distinct from` comparison FALSE, so the guard did not fire — and only '
  'this migration could arm that, because project_id could not be NULL before it');
-- ⚑ MUTATION NOTE: 0199 §5 guards this TWICE — fail-closed on an invisible parent, and an org
-- floor. They are redundant here, so removing either alone leaves this green; removing BOTH reddens
-- it. Recorded so nobody deletes one citing a passing suite.

select lives_ok(
  $$ insert into tasks (id, org_id, project_id, parent_task_id, name, status)
     values ('05250000-0000-0000-0000-00000000fc04','05250000-0000-0000-0000-000000000001', null,
             '05250000-0000-0000-0000-00000000fc03','FCT same-org child','To Do') $$,
  'AC-FCT-020 CONTROL a project-less task MAY parent a project-less task in its own org — the fix is '
  'an org floor, not a ban on project-less parenting');

-- ⚑ On the project-less path the `exists (… p.org_id = auth_org_id())` clause is bypassed BY DESIGN,
-- so `org_id = auth_org_id()` is the ONLY tenancy guard left. Nothing pinned it. Asserted as a row
-- count, not throws_ok, because a `using` denial is silent — the same reason as AC-FCT-012.
reset role;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local role authenticated;
do $$
declare v_rows int;
begin
  update tasks set name = 'FCT cross-org edit'
   where id = '05250000-0000-0000-0000-00000000fd01';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'cross-org update touched % row(s)', v_rows; end if;
  delete from tasks where id = '05250000-0000-0000-0000-00000000fd01';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'cross-org delete touched % row(s)', v_rows; end if;
end $$;
select pass('AC-FCT-021 another org''s project-less task is untouchable — org_id = auth_org_id() is '
  'the SOLE remaining tenancy guard once the project clause is bypassed, and it holds');

reset role;
select is(
  (select name from tasks where id = '05250000-0000-0000-0000-00000000fd01'),
  'FCT foreign orphan',
  'AC-FCT-022 …and it is genuinely unchanged and still present — a rowcount alone would pass against '
  'a policy that admitted the write and stored the same value');

-- ⚑ AC-FCT-018 counted a policy NAME, which no behavioural break can redden. This reads instead.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select count(*)::int from tasks where id = '05250000-0000-0000-0000-00000000fd01'),
  0,
  'AC-FCT-023 the READ path is org-scoped too — another org''s project-less task is invisible, which '
  'is the behaviour AC-FCT-018''s policy-name count only asserted the existence of');

-- ── §F — THE THIRD JOB THE EXISTS WAS DOING. ────────────────────────────────────────────────────
-- `projects_select` carries `is_active_member()`. So before this migration an OFFBOARDED member
-- failed the mandatory `exists (select 1 from projects …)` on visibility and was refused — standing
-- was enforced by a subquery nobody had written down as a standing check. The `project_id is null`
-- disjunct deletes that subquery. Without `is_active_member()` stated on the policies, a disabled PM
-- holding an unexpired token can INSERT project-less tasks: exactly the bucket the meeting module
-- will treat as real action items.
--
-- ⚑ The CONTROL matters as much as the assertion. It shows the pre-migration shape is still refused,
-- so a green here cannot come from the policy simply denying everything.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
     values ('05250000-0000-0000-0000-000000000001', null,'FCT offboarded insert','To Do') $$,
  '42501',
  null,
  'AC-FCT-024 an OFFBOARDED member may not create a project-less task — standing is STATED on the '
  'policy, not inherited from a projects subquery that the null case no longer runs');

select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
     values ('05250000-0000-0000-0000-000000000001',
             '05250000-0000-0000-0000-000000000fd1','FCT offboarded project insert','To Do') $$,
  '42501',
  null,
  'AC-FCT-025 CONTROL …and still may not create a project-CARRYING one, which is 0146''s behaviour '
  'unchanged — so AC-FCT-024 cannot be passing merely because everything is denied');

do $$
declare v_rows int;
begin
  update tasks set name = 'FCT offboarded edit'
   where id = '05250000-0000-0000-0000-00000000fc03';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'an offboarded member edited % row(s)', v_rows; end if;
end $$;
select pass('AC-FCT-026 …and may not EDIT an existing project-less task either — the standing check '
  'is on all four policies, not only the one the probe happened to use');

reset role;
select is(
  (select name from tasks where id = '05250000-0000-0000-0000-00000000fc03'),
  'FCT assigned orphan',
  'AC-FCT-027 …and the row is genuinely untouched — a rowcount alone would pass against a policy '
  'that admitted the write and stored the same value');

reset role;
select * from finish();
rollback;
