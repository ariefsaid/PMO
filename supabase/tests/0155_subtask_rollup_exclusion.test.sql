-- 0155_subtask_rollup_exclusion.test.sql
-- OD-INT-9 subtask rollup rule (binding): only tasks with parent_task_id IS NULL participate in
-- milestone counts (task_count / calculated_pct) and project delivery_pct. Subtasks never
-- independently move a percentage. Without this rule a parent and its children double-count and
-- delivery reporting silently inflates.
--
-- This is the RED→GREEN proof for the rollup bug. Pre-fix (parent_task_id column exists but no
-- consumer excludes subtasks): a Done parent + 2 To-Do subtasks counts as 1/3 Done → 33% instead
-- of the correct 100%. Post-fix (get_project_milestones / get_projects_delivery filter
-- parent_task_id IS NULL): only the parent counts → 1/1 Done → 100%.
--
-- AC-SUB-001  parent + 2 subtasks in a milestone → task_count counts ONLY the parent (1, not 3)
-- AC-SUB-002  parent Done + 2 subtasks To-Do → calculated_pct = 100 (not 33)
-- AC-SUB-003  single-milestone project → delivery_pct = effective_pct of that milestone (100, not 33)
-- AC-SUB-004  a milestone with ONLY subtasks (no top-level task) → task_count = 0, calculated_pct null
-- AC-SUB-005  a 3-level chain (grandparent→parent→child): only the grandparent (parent_task_id null) counts
-- AC-SUB-006  a parent's subtask flipping Done does NOT change the milestone's calculated_pct
--
-- Fixture namespace: 01550000-… (unique to this test).
begin;
select plan(9);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('01550000-0000-0000-0000-0000000000a1','sub-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01550000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'Subtask PM','sub-pm@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('01550000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Sub Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, contract_value) values
  ('01550000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'SUB-001','Subtask Rollup Project','Ongoing Project',
   '01550000-0000-0000-0000-000000000010',
   '01550000-0000-0000-0000-0000000000a1',100000,100000),
  -- SUB-002: a clean single-milestone project dedicated to the project-level delivery_pct proof.
  ('01550000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',
   'SUB-002','Single-Milestone Subtask Project','Ongoing Project',
   '01550000-0000-0000-0000-000000000010',
   '01550000-0000-0000-0000-0000000000a1',100000,100000);

-- SUB-002's single milestone (weight 10) — the unambiguous project-level delivery_pct proof.
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  ('01550000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000021','Engineering',10,0);

-- Milestone M (weight 10) — holds the parent + its subtasks.
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  ('01550000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','Engineering',10,0),
  -- Milestone ONLY (subtasks-only): every task under here is a subtask → task_count must be 0.
  ('01550000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','Subtasks-only',10,1),
  -- Milestone CHAIN: hosts the 3-level grandparent→parent→child chain.
  ('01550000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','Chain',10,2);

-- Parent P (Done) + 2 subtasks (To Do) under milestone M.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('01550000-0000-0001-0001-000000000001','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000031','Parent P','Done');
-- Two subtasks under P, same milestone, status To Do (the inflation trap: pre-fix these drag the % down).
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values
  ('01550000-0000-0001-0001-000000000002','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000031','Subtask S1','To Do',
   '01550000-0000-0001-0001-000000000001'),
  ('01550000-0000-0001-0001-000000000003','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000031','Subtask S2','To Do',
   '01550000-0000-0001-0001-000000000001');

-- Milestone "Subtasks-only": two subtasks whose parents live elsewhere in the project (parents are
-- top-level tasks with NO milestone, so only the subtasks reference this milestone). Every task in
-- this milestone is a subtask → rollup must yield task_count = 0 and calculated_pct = null.
insert into tasks (id, org_id, project_id, name, status) values
  ('01550000-0000-0001-0002-000000000010','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','Orphan parent A','To Do');
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values
  ('01550000-0000-0001-0002-000000000011','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000032','Orphan sub A1','Done',
   '01550000-0000-0001-0002-000000000010'),
  ('01550000-0000-0001-0002-000000000012','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000032','Orphan sub A2','Done',
   '01550000-0000-0001-0002-000000000010');

-- Milestone "Chain": grandparent (Done, top-level) → parent (To Do) → child (To Do).
-- Only the grandparent (parent_task_id is null) counts → 1/1 Done → 100%.
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values
  ('01550000-0000-0001-0003-000000000020','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000033','Grandparent','Done', null),
  ('01550000-0000-0001-0003-000000000021','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000033','Midparent','To Do',
   '01550000-0000-0001-0003-000000000020'),
  ('01550000-0000-0001-0003-000000000022','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000020','01550000-0000-0000-0000-000000000033','Leaf child','To Do',
   '01550000-0000-0001-0003-000000000021');

-- ── Tests (as the PM, so RLS scopes results to the default org). ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-SUB-001: task_count counts ONLY the parent (1, not 3).
select is(
  (select task_count from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000031'),
  1,
  'AC-SUB-001: task_count counts ONLY the parent (1, not parent+2 subtasks = 3)');

-- AC-SUB-002: parent Done + 2 subtasks To-Do → calculated_pct = 100 (not 33.33).
select is(
  (select calculated_pct::numeric(10,0) from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000031'),
  100::numeric,
  'AC-SUB-002: calculated_pct = 100 when only the Done parent counts (pre-fix it was 33)');

-- AC-SUB-003: project-level delivery_pct on a clean single-milestone project (SUB-002). Parent Done,
-- 2 subtasks To-Do → milestone effective = 100 (only parent counts) → project delivery = 100.
-- Pre-fix this was 33 (1/3 Done) — the inflation/deflation the rule eliminates.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('01550000-0000-0001-0004-000000000001','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000021','01550000-0000-0000-0000-000000000040','Parent P2','Done');
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values
  ('01550000-0000-0001-0004-000000000002','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000021','01550000-0000-0000-0000-000000000040','Parent P2 Sub A','To Do',
   '01550000-0000-0001-0004-000000000001'),
  ('01550000-0000-0001-0004-000000000003','00000000-0000-0000-0000-000000000001',
   '01550000-0000-0000-0000-000000000021','01550000-0000-0000-0000-000000000040','Parent P2 Sub B','To Do',
   '01550000-0000-0001-0004-000000000001');
select is(
  (select delivery_pct::numeric(10,0)
     from get_projects_delivery(array['01550000-0000-0000-0000-000000000021'::uuid])),
  100::numeric,
  'AC-SUB-003: delivery_pct = 100 on a single-milestone project (subtasks neither inflate nor deflate)');

-- AC-SUB-004: a milestone with ONLY subtasks (no top-level task) → task_count = 0, calculated_pct null.
select is(
  (select task_count from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000032'),
  0,
  'AC-SUB-004: a milestone with only subtasks has task_count = 0');

select ok(
  (select calculated_pct is null from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000032'),
  'AC-SUB-004: a milestone with only subtasks has calculated_pct = null (no top-level tasks)');

-- AC-SUB-005: 3-level chain — only the grandparent (parent_task_id null) counts → 1/1 Done → 100%.
select is(
  (select task_count from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000033'),
  1,
  'AC-SUB-005: 3-level chain — only the top-level (grandparent) counts (task_count = 1, not 3)');

select is(
  (select calculated_pct::numeric(10,0) from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000033'),
  100::numeric,
  'AC-SUB-005: 3-level chain — calculated_pct = 100 (grandparent Done; midparent + leaf excluded)');

-- AC-SUB-006: flipping a SUBTASK to Done must NOT change the milestone's calculated_pct.
-- Subtask S1 (under milestone M) Done → milestone M is still 100% (parent already Done; subtask ignored).
reset role;
update tasks set status = 'Done'
 where id = '01550000-0000-0001-0001-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select calculated_pct::numeric(10,0) from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000031'),
  100::numeric,
  'AC-SUB-006: flipping a subtask to Done does not change calculated_pct (still 100, not 150-style inflation)');

select is(
  (select task_count from get_project_milestones('01550000-0000-0000-0000-000000000020')
    where id = '01550000-0000-0000-0000-000000000031'),
  1,
  'AC-SUB-006: task_count is still 1 after a subtask status change');

reset role;

select * from finish();
rollback;
