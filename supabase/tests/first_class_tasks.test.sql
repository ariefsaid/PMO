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
select plan(40);

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

-- ── §G — #532: THE COLUMN PIN IS AN ALLOWLIST, so a column added tomorrow is refused. ───────────
-- Migration under test: 0200_assignee_column_allowlist.sql. `grep -r AC-ACA-` finds exactly these.
--
-- The pin used to enumerate the columns an assignee may NOT change. `tasks` has 17 columns and the
-- assignee branch named 12, so `milestone_id`, `tombstoned_at` and `source_updated_at` were writable
-- by any Engineer assignee — each verified `UPDATE 1` by probe against a `42501` control on `name`.
-- Every oracle below asserts the MESSAGE, not just `42501`: `tasks` carries several 42501 gates
-- (three RLS policies and the parent guard), and a bare errcode assertion goes green for the wrong
-- reason the moment a different one moves in front of this trigger.
reset role;
reset request.jwt.claims;

-- A SECOND project in the SAME org, so the milestone oracle proves the column pin and not tenancy.
insert into projects (id, org_id, name, status) values
  ('05250000-0000-0000-0000-000000000fd3','05250000-0000-0000-0000-000000000001','FCT Second Project','Ongoing Project');
insert into project_milestones (id, org_id, project_id, name, target_date, weight) values
  ('05250000-0000-0000-0000-00000000fb02','05250000-0000-0000-0000-000000000001',
   '05250000-0000-0000-0000-000000000fd3','FCT Second Milestone','2026-12-31',10);
-- The second project's own work: one task, not done. Its delivery percentage is therefore 0.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('05250000-0000-0000-0000-00000000fc07','05250000-0000-0000-0000-000000000001',
   '05250000-0000-0000-0000-000000000fd3','05250000-0000-0000-0000-00000000fb02','FCT second-project work','To Do');
-- The Engineer's own task: DONE, and inside the FIRST project's milestone. Moving THIS row is what
-- moves the other project's number — a Done task dragged into a foreign milestone.
insert into tasks (id, org_id, project_id, milestone_id, name, status, assignee_id) values
  ('05250000-0000-0000-0000-00000000fc05','05250000-0000-0000-0000-000000000001',
   '05250000-0000-0000-0000-000000000fd1','05250000-0000-0000-0000-00000000fb01',
   'FCT engineer done task','Done','05250000-0000-0000-0000-0000000000a2');
-- A plain To Do task of the Engineer's, for the column oracles that need a live status transition.
-- ⚑ It CARRIES its project's milestone from the start. AC-ACA-012 then clears it and AC-ACA-014
-- restores it, so both are real value changes. An earlier draft had AC-ACA-012 set the same value
-- AC-ACA-014 would set, which made AC-ACA-014 a no-op diff — it stayed GREEN with the server-
-- authority exemption deleted. Caught by the mutation run, not by reading the assertion.
insert into tasks (id, org_id, project_id, milestone_id, name, status, assignee_id) values
  ('05250000-0000-0000-0000-00000000fc06','05250000-0000-0000-0000-000000000001',
   '05250000-0000-0000-0000-000000000fd1','05250000-0000-0000-0000-00000000fb01',
   'FCT engineer todo task','To Do','05250000-0000-0000-0000-0000000000a2');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ⚑ THE HARM, not merely "an update failed". An Engineer assignee pointing their own DONE task at
-- ANOTHER PROJECT's milestone moves that project's delivery percentage — every server-side rollup
-- joins tasks through `milestone_id` and never through `project_id`.
select throws_ok(
  $$ update tasks set milestone_id = '05250000-0000-0000-0000-00000000fb02'
      where id = '05250000-0000-0000-0000-00000000fc05' $$,
  '42501',
  'only the task status may be changed by its assignee',
  'AC-ACA-001 an Engineer assignee may not repoint their task at ANOTHER project''s milestone');

reset role;
select is(
  (select task_count from get_project_milestones('05250000-0000-0000-0000-000000000fd3')
    where id = '05250000-0000-0000-0000-00000000fb02'),
  1,
  'AC-ACA-002 …and the other project''s milestone still counts only its OWN task. This is the harm '
  'assertion: a rowcount on `tasks` would pass while the rollup silently moved');
select is(
  (select calculated_pct::numeric(10,0) from get_project_milestones('05250000-0000-0000-0000-000000000fd3')
    where id = '05250000-0000-0000-0000-00000000fb02'),
  0::numeric,
  'AC-ACA-003 …and its delivery percentage did not move. Admitting the write would make it 1 of 2 '
  'done = 50% on a project the Engineer has nothing to do with');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ update tasks set tombstoned_at = now()
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  '42501',
  'only the task status may be changed by its assignee',
  'AC-ACA-004 an Engineer assignee may not tombstone their task — the DAL and the agent read past '
  'tombstoned rows, so this is a delete they are not allowed to perform');

select throws_ok(
  $$ update tasks set source_updated_at = now() + interval '100 years'
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  '42501',
  'only the task status may be changed by its assignee',
  'AC-ACA-005 an Engineer assignee may not move source_updated_at — a future watermark freezes every '
  'later ClickUp mirror update for that task');

reset role;
select is(
  (select count(*)::int from tasks
    where id = '05250000-0000-0000-0000-00000000fc06'
      and tombstoned_at is null and source_updated_at is null),
  1,
  'AC-ACA-006 …and neither landed. throws_ok proves an exception, not that the row is intact');

-- ⚑ THE POLARITY ITSELF. This is the oracle the deny-list could never have: a column that did not
-- exist when the trigger was written is refused by DEFAULT. It is added and dropped inside this
-- transaction, so it models the next `alter table tasks add column` exactly.
alter table public.tasks add column zz_future_column text;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ update tasks set zz_future_column = 'engineer wrote this'
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  '42501',
  'only the task status may be changed by its assignee',
  'AC-ACA-007 a column added to `tasks` AFTER the trigger was written is refused to the assignee by '
  'default. Under the old deny-list every such column was writable — that is the whole defect, and '
  'it recurred three times because nothing could fail');
reset role;
alter table public.tasks drop column zz_future_column;

-- ── completed_at: allowed at the pin, controlled at the stamp. ──────────────────────────────────
-- The pin (`tasks_assignee_status_only`) fires BEFORE the stamp (`trg_stamp_task_completed_at`) —
-- BEFORE ROW triggers fire in trigger-NAME order and 'ta' < 'tr'. So a client that sends
-- `completed_at` reaches the pin with a genuinely changed value; pinning it would REFUSE the write
-- rather than ignore it. Allowing it costs nothing because the stamp reassigns it unconditionally.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ update tasks set completed_at = '2020-01-01T00:00:00Z'
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  'AC-ACA-008 an assignee may SEND completed_at — the pin allows it because the stamp, not the pin, '
  'is what controls the column');

reset role;
select is(
  (select completed_at from tasks where id = '05250000-0000-0000-0000-00000000fc06'),
  null::timestamptz,
  'AC-ACA-009 …and it did NOT land: the task is not Done, so the stamp reasserted null over the '
  'value the client sent. THIS is why completed_at is safe to allow at the pin');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ update tasks set status = 'Done', completed_at = '2020-01-01T00:00:00Z'
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  'AC-ACA-010 CONTROL the assignee can still complete their task — the write the whole trigger '
  'exists to permit, with a forged completion date riding along');

reset role;
select ok(
  (select completed_at from tasks where id = '05250000-0000-0000-0000-00000000fc06')
    >= now() - interval '5 seconds',
  'AC-ACA-011 …and completed_at is the stamp''s now(), not the 2020 date the client sent — an '
  'assignee cannot backdate their own completion');

-- ── The write-role path is untouched: managers still own the whole row. ─────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05250000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ update tasks set name = 'FCT PM full edit', tombstoned_at = now(),
                      source_updated_at = now(), milestone_id = null
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  'AC-ACA-012 CONTROL a Project Manager still writes every one of the newly-pinned columns — the '
  'allowlist tightened the ASSIGNEE branch, not the write-role early return');

reset role;
select is(
  (select count(*)::int from tasks
    where id = '05250000-0000-0000-0000-00000000fc06' and name = 'FCT PM full edit'
      and milestone_id is null and tombstoned_at is not null and source_updated_at is not null),
  1,
  'AC-ACA-013 …and every one of them persisted — lives_ok alone would pass against a policy that '
  'hid the row, and naming only one column would leave the other three unbound');

-- ── §C — the server-authority exemption. ───────────────────────────────────────────────────────
-- `auth_role()` reads profiles.role for auth.uid(), so a writer with NO request JWT answers NULL,
-- fails the write-role early return, and lands in the assignee branch. Pinning `milestone_id`
-- without this exemption is exactly what broke `seed.sql` during #525 and got reverted.
--
-- ⚑ It is keyed on `auth.uid()`, the CALLER's identity, not on the executing DB role — probed in
-- 0200 §C: `request.jwt.claims` is transaction-local and survives into a SECURITY DEFINER function,
-- so an Engineer calling a definer RPC still answers 'Engineer' here and stays pinned. That is what
-- makes it different from the exemption DD-WO-8 refused on the work-order freeze.
reset role;
reset request.jwt.claims;
select lives_ok(
  $$ update tasks set milestone_id = '05250000-0000-0000-0000-00000000fb01'
      where id = '05250000-0000-0000-0000-00000000fc06' $$,
  'AC-ACA-014 a server-side writer with no request JWT may still set milestone_id — this is '
  '`seed.sql`''s own statement shape, verbatim, and without the exemption the pin refuses it');

select is(
  (select milestone_id::text from tasks where id = '05250000-0000-0000-0000-00000000fc06'),
  '05250000-0000-0000-0000-00000000fb01',
  'AC-ACA-015 …and it landed');

-- The exemption''s reachable surface over PostgREST, pinned so a future grant sweep cannot widen it
-- silently: the anon key is a JWT with a role claim and NO sub, so `auth.uid()` is null for it too.
-- The only thing standing between anon and the exemption is the absence of an UPDATE grant.
select ok(
  not has_table_privilege('anon', 'public.tasks', 'UPDATE'),
  'AC-ACA-016 `anon` holds no UPDATE grant on tasks — an anon caller has no `sub`, so it would take '
  'the server-authority exemption if it could ever reach the trigger at all');

reset role;

reset role;
select * from finish();
rollback;
