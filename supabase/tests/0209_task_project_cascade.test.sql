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
select plan(6);

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

update public.tasks
   set project_id = '09200000-0000-0000-0000-00000000000b'
 where id = '09210000-0000-0000-0000-000000000001';

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

-- The org floor: a cascade must never reach across tenants. Restated here because the cascade is a
-- new write path, and 0199's floor was proven only for the paths that existed then.
select is(
  (select count(*)::int from tasks
    where org_id = '02090000-0000-0000-0000-000000000002'),
  0,
  'AC-TASK-406 the cascade wrote nothing into another org'
);

select * from finish();
rollback;
