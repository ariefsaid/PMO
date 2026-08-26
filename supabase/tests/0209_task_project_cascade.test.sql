-- 0209_task_project_cascade.test.sql — a subtask follows its parent between projects
-- AC-TASK-401..406 / OD-TASK-2 / #550
--
-- ⚑ THE FIXTURE IS THREE LEVELS DEEP ON PURPOSE: a two-level fixture cannot tell a working cascade
-- from one that moves only DIRECT children.
--
-- ⚑ What it does NOT prove — stated because the first draft of this comment claimed it did — is
-- that the level-by-level walk is necessary. A single recursive UPDATE passes every case here; a
-- trigger's query sees rows the same statement already updated, so the grandchild's guard reads its
-- parent's new project. The walk exists for row-update ORDERING, which Postgres does not specify
-- and a test cannot choose. See the migration header.
--
-- DECOUPLED from seed: isolated org, UUID prefix 02090000-….
begin;
select plan(9);

insert into organizations (id, name) values
  ('02090000-0000-0000-0000-000000000001', 'Task Cascade Org (0209)'),
  ('02090000-0000-0000-0000-000000000002', 'Other Org (0209)');

insert into auth.users (id, email) values
  ('02090000-0000-0000-0000-0000000000a1', 'pm@cascade0209.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('02090000-0000-0000-0000-0000000000a1', '02090000-0000-0000-0000-000000000001',
   'PM 0209', 'pm@cascade0209.example', 'Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, tax_treatment, tax_amount)
values
  ('09200000-0000-0000-0000-00000000000a', '02090000-0000-0000-0000-000000000001',
   'SRC', 'Source Project', 'Ongoing Project', '02090000-0000-0000-0000-0000000000a1', 0, 0, 0, null, null),
  ('09200000-0000-0000-0000-00000000000b', '02090000-0000-0000-0000-000000000001',
   'DST', 'Destination Project', 'Ongoing Project', '02090000-0000-0000-0000-0000000000a1', 0, 0, 0, null, null);

-- parent → child → grandchild, all in SRC
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('09210000-0000-0000-0000-000000000001', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Parent', 'To Do', null),
  ('09210000-0000-0000-0000-000000000002', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Child', 'To Do', '09210000-0000-0000-0000-000000000001'),
  ('09210000-0000-0000-0000-000000000003', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Grandchild', 'To Do', '09210000-0000-0000-0000-000000000002'),
  -- An UNRELATED task in SRC. Without it, "the cascade moved everything in the project" would pass.
  ('09210000-0000-0000-0000-000000000004', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Unrelated', 'To Do', null);

-- Org TWO's own pair, so AC-TASK-406 has something to witness.
insert into auth.users (id, email) values
  ('02090000-0000-0000-0000-0000000000b1', 'pm@other0209.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('02090000-0000-0000-0000-0000000000b1', '02090000-0000-0000-0000-000000000002',
   'PM other', 'pm@other0209.example', 'Project Manager');
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, tax_treatment, tax_amount)
values ('09200000-0000-0000-0000-00000000000c', '02090000-0000-0000-0000-000000000002',
        'OTH', 'Other Org Project', 'Ongoing Project', '02090000-0000-0000-0000-0000000000b1', 0, 0, 0, null, null);
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('09210000-0000-0000-0000-000000000021', '02090000-0000-0000-0000-000000000002',
   '09200000-0000-0000-0000-00000000000c', 'Other Parent', 'To Do', null),
  ('09210000-0000-0000-0000-000000000022', '02090000-0000-0000-0000-000000000002',
   '09200000-0000-0000-0000-00000000000c', 'Other Child', 'To Do', '09210000-0000-0000-0000-000000000021');

-- An unrelated pair that is ALREADY inconsistent — parent in DST, child left in SRC. This is the
-- legacy shape the header says has existed since 0140, so production has it. Nobody's move should
-- repair or disturb it.
-- ⚑ THE TRIGGERS COME OFF TO BUILD THIS ONE, and that is the point: with 0209 live, a split pair
-- can no longer be CREATED — the cascade would repair it, and the BEFORE guard refuses it outright.
-- It can only be INHERITED, from rows written before this migration. So the fixture manufactures
-- the legacy shape directly, which is the only way production got it.
alter table public.tasks disable trigger tasks_cascade_project_to_subtree;
alter table public.tasks disable trigger tasks_check_parent_same_project;
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('09210000-0000-0000-0000-000000000031', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000b', 'Legacy Parent In DST', 'To Do', null),
  ('09210000-0000-0000-0000-000000000032', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Legacy Child In SRC', 'To Do', '09210000-0000-0000-0000-000000000031');
alter table public.tasks enable trigger tasks_check_parent_same_project;
alter table public.tasks enable trigger tasks_cascade_project_to_subtree;

-- A milestone-grouped subtask (0202's composite FK is what makes this the interesting case).
insert into project_milestones (id, org_id, project_id, name, weight, target_date)
values ('09230000-0000-0000-0000-000000000001', '02090000-0000-0000-0000-000000000001',
        '09200000-0000-0000-0000-00000000000a', 'SRC Milestone', 1, '2026-06-01');
insert into tasks (id, org_id, project_id, name, status, parent_task_id, milestone_id) values
  ('09210000-0000-0000-0000-000000000041', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Milestone Parent', 'To Do', null, null),
  ('09210000-0000-0000-0000-000000000042', '02090000-0000-0000-0000-000000000001',
   '09200000-0000-0000-0000-00000000000a', 'Milestone Child', 'To Do',
   '09210000-0000-0000-0000-000000000041', '09230000-0000-0000-0000-000000000001');

update public.tasks
   set project_id = '09200000-0000-0000-0000-00000000000b'
 where id in ('09210000-0000-0000-0000-000000000001', '09210000-0000-0000-0000-000000000041');

select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000002'),
  '09200000-0000-0000-0000-00000000000b'::uuid,
  'AC-TASK-401 a direct child follows its parent to the new project'
);

select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000003'),
  '09200000-0000-0000-0000-00000000000b'::uuid,
  'AC-TASK-402 a GRANDCHILD follows too — the cascade reaches the whole subtree, not just direct children'
);

select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000004'),
  '09200000-0000-0000-0000-00000000000a'::uuid,
  'AC-TASK-403 an unrelated task in the source project does NOT move — the cascade follows parentage, not the project'
);

-- OD-TASK-2's motivating workflow: filing a project-less My Tasks item into a project.
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('09210000-0000-0000-0000-000000000011', '02090000-0000-0000-0000-000000000001',
   null, 'Loose Parent', 'To Do', null),
  ('09210000-0000-0000-0000-000000000012', '02090000-0000-0000-0000-000000000001',
   null, 'Loose Child', 'To Do', '09210000-0000-0000-0000-000000000011');

update public.tasks
   set project_id = '09200000-0000-0000-0000-00000000000a'
 where id = '09210000-0000-0000-0000-000000000011';

select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000012'),
  '09200000-0000-0000-0000-00000000000a'::uuid,
  'AC-TASK-404 filing a project-less parent into a project takes its child with it (OD-TASK-2''s motivating workflow)'
);

-- The guard the cascade must not weaken: a child may still not be re-parented across projects by
-- hand. The cascade moves children WITH a parent; it does not license moving one AWAY.
select throws_ok(
  $$update public.tasks set project_id = '09200000-0000-0000-0000-00000000000a'
     where id = '09210000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'AC-TASK-405 the 0140 guard still refuses a child moved AWAY from its parent''s project'
);

-- ⚑ AC-TASK-406 WAS A DEAD ORACLE — it asserted `count(*) = 0` in org TWO while the fixture never
-- put a row there, so it read 0 whatever the code did. Org two now has a real pair to witness.
--
-- ⛔ BUT BE CLEAR WHAT THIS PROVES. It proves a cascade in one org leaves another org's subtree
-- alone. It does NOT prove the function's `c.org_id = new.org_id` filter: deleting that line still
-- leaves all 9 oracles green, because the frontier is rooted at `new.id` and 0199's org floor makes
-- a cross-org parent/child pair unconstructible, so no foreign row can ever enter the walk. The
-- ROOTING is what holds tenancy here. The org filter is a second lock, kept deliberately and
-- documented as unprovable in the migration — do not "prove" it by weakening this test.
select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000022'),
  '09200000-0000-0000-0000-00000000000c'::uuid,
  'AC-TASK-406 a cascade in one org does not move another org''s subtask (the org filter has a witness now)'
);

-- ⛔ THE CASCADE IS ROOTED AT THE MOVED ROW. The first implementation had no reference to `new.id`:
-- it matched any child whose parent already sat in the destination project, so moving ONE unrelated
-- task into DST swept every inconsistent pair in the org along with it. AC-TASK-403 could not see
-- it — that fixture's unrelated task is PARENTLESS, and the broken predicate never touched those.
select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000032'),
  '09200000-0000-0000-0000-00000000000a'::uuid,
  'AC-TASK-407 an unrelated PARENTED pair, already inconsistent, is left alone by someone else''s move'
);

-- A descendant grouped under a milestone of the OLD project. Since 0202 the FK is composite
-- (project_id, milestone_id), so carrying it across raises a raw 23503 and aborts the whole move —
-- making that parent permanently unmovable behind an error about deleting referenced records.
select is(
  (select project_id from tasks where id = '09210000-0000-0000-0000-000000000042'),
  '09200000-0000-0000-0000-00000000000b'::uuid,
  'AC-TASK-408 a milestone-grouped subtask still follows its parent — the composite FK does not make the parent unmovable'
);

select is(
  (select milestone_id from tasks where id = '09210000-0000-0000-0000-000000000042'),
  null,
  'AC-TASK-409 …and its milestone is cleared on the way, because a milestone of the old project has no meaning in the new one'
);

select * from finish();
rollback;
