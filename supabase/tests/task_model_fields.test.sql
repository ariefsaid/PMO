-- task_model_fields.test.sql
-- Migration under test: 0123_task_model_fields.sql (OD-INT-9)
--
-- Extends public.tasks with four nullable columns: description, priority (new task_priority
-- enum), parent_task_id (self-FK subtask model, ON DELETE CASCADE), archived_at. Proves the two
-- constraints called out in the task brief: a task cannot be its own parent, and a subtask must
-- live in the SAME project as its parent (enforced by a same-project trigger mirroring the 0043
-- incident_reports/projects invariant pattern). Also proves the parent_task_id index exists and
-- that the four columns are treated as ClickUp-owned native fields by the 0093 column-pin trigger
-- (see task_model_fields_external_owned.test.sql for the pin proof — kept in the existing
-- tasks_external_owned_rls.test.sql fixture instead, see AC-TM-016/017 below appended there).
--
-- AC-TM-001  tasks.description column exists, text, nullable
-- AC-TM-002  tasks.priority column exists, task_priority, nullable
-- AC-TM-003  task_priority enum is exactly {Urgent, High, Normal, Low}
-- AC-TM-004  tasks.parent_task_id column exists, uuid, nullable
-- AC-TM-005  parent_task_id is a FK to tasks(id) with ON DELETE CASCADE
-- AC-TM-006  tasks_parent_task_id_idx index exists on tasks(parent_task_id)
-- AC-TM-007  tasks.archived_at column exists, timestamptz, nullable
-- AC-TM-008  a task cannot be its own parent (check constraint) → insert throws
-- AC-TM-009  a task cannot be its own parent → update throws
-- AC-TM-010  parent in a DIFFERENT project (same org) → throws 42501 (no existence leak)
-- AC-TM-011  parent in the SAME project → lives_ok
-- AC-TM-012  deleting a parent task cascades to delete its subtasks
-- AC-TM-013  a task inserted with no new-column values leaves all four null
-- AC-TM-014  parent_task_id update to a different-project parent → throws 42501
-- AC-TM-015  priority accepts each of the four enum values

begin;
select plan(26);

-- ── Schema assertions ────────────────────────────────────────────────────────

select has_column('public', 'tasks', 'description',
  'AC-TM-001: tasks.description column exists');
select col_type_is('public', 'tasks', 'description', 'text',
  'AC-TM-001: tasks.description is text');
select col_is_null('public', 'tasks', 'description',
  'AC-TM-001: tasks.description is nullable');

select has_column('public', 'tasks', 'priority',
  'AC-TM-002: tasks.priority column exists');
select col_type_is('public', 'tasks', 'priority', 'task_priority',
  'AC-TM-002: tasks.priority is task_priority');
select col_is_null('public', 'tasks', 'priority',
  'AC-TM-002: tasks.priority is nullable');

select ok(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_priority')
  = array['Urgent','High','Normal','Low'],
  'AC-TM-003: task_priority enum is exactly {Urgent, High, Normal, Low}'
);

select has_column('public', 'tasks', 'parent_task_id',
  'AC-TM-004: tasks.parent_task_id column exists');
select col_type_is('public', 'tasks', 'parent_task_id', 'uuid',
  'AC-TM-004: tasks.parent_task_id is uuid');
select col_is_null('public', 'tasks', 'parent_task_id',
  'AC-TM-004: tasks.parent_task_id is nullable');

select ok(
  exists(
    select 1
    from pg_constraint c
    join pg_class t   on t.oid = c.conrelid
    join pg_class rt  on rt.oid = c.confrelid
    where c.contype = 'f'
      and t.relname  = 'tasks'
      and rt.relname = 'tasks'
      and c.confdeltype = 'c'  -- 'c' = ON DELETE CASCADE
      and (select attname from pg_attribute
           where attrelid = c.conrelid and attnum = c.conkey[1]) = 'parent_task_id'
  ),
  'AC-TM-005: parent_task_id is a self-FK to tasks(id) with ON DELETE CASCADE'
);

select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'tasks'
      and indexname  = 'tasks_parent_task_id_idx'
  ),
  'AC-TM-006: tasks_parent_task_id_idx exists on tasks(parent_task_id)'
);

select has_column('public', 'tasks', 'archived_at',
  'AC-TM-007: tasks.archived_at column exists');
select col_type_is('public', 'tasks', 'archived_at', 'timestamp with time zone',
  'AC-TM-007: tasks.archived_at is timestamptz');
select col_is_null('public', 'tasks', 'archived_at',
  'AC-TM-007: tasks.archived_at is nullable');

-- ── Behavioural fixtures ─────────────────────────────────────────────────────

insert into organizations (id, name) values
  ('0ac10000-0000-0000-0000-000000000001', 'Task Model Org A');

insert into auth.users (id, email) values
  ('0ac10000-0000-0000-0000-000000000c0f', 'task-model-manager@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0ac10000-0000-0000-0000-000000000c0f', '0ac10000-0000-0000-0000-000000000001', 'Task Model Manager', 'task-model-manager@example.com', 'Project Manager', 'active');

insert into projects (id, org_id, code, name, status) values
  ('0ac10000-0000-0000-0000-0000000000a0', '0ac10000-0000-0000-0000-000000000001', 'TM-A', 'Task Model Project A', 'Ongoing Project'),
  ('0ac10000-0000-0000-0000-0000000000b0', '0ac10000-0000-0000-0000-000000000001', 'TM-B', 'Task Model Project B', 'Ongoing Project');

insert into tasks (id, org_id, project_id, name, status) values
  ('0ac10000-0000-0000-0000-00000000e001', '0ac10000-0000-0000-0000-000000000001', '0ac10000-0000-0000-0000-0000000000a0', 'Parent Task A', 'To Do'),
  ('0ac10000-0000-0000-0000-00000000e002', '0ac10000-0000-0000-0000-000000000001', '0ac10000-0000-0000-0000-0000000000b0', 'Parent Task B (other project)', 'To Do');

-- AC-TM-008: self-parent on insert → throws
select throws_ok(
  $$ insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
       ('0ac10000-0000-0000-0000-00000000e003', '0ac10000-0000-0000-0000-000000000001',
        '0ac10000-0000-0000-0000-0000000000a0', 'Self Parent', 'To Do',
        '0ac10000-0000-0000-0000-00000000e003') $$,
  null, null,
  'AC-TM-008: a task cannot be its own parent (insert)'
);

-- AC-TM-013: no new-column values on insert → all four null
insert into tasks (id, org_id, project_id, name, status) values
  ('0ac10000-0000-0000-0000-00000000e004', '0ac10000-0000-0000-0000-000000000001',
   '0ac10000-0000-0000-0000-0000000000a0', 'Bare Task', 'To Do');
select ok(
  (select description is null and priority is null and parent_task_id is null and archived_at is null
     from tasks where id = '0ac10000-0000-0000-0000-00000000e004'),
  'AC-TM-013: a task inserted with no new-column values leaves all four null'
);

-- The remaining assertions are UPDATEs; the 0016/0093 assignee-status-only trigger column-pins any
-- caller whose role does not resolve to a manager role (blank auth context resolves to no role,
-- which would otherwise mask these checks behind an unrelated 42501). Run them as the manager
-- profile set up above so the assertions below prove the NEW constraints, not the pin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0ac10000-0000-0000-0000-000000000c0f","role":"authenticated"}';

-- AC-TM-009: self-parent on update → throws
select throws_ok(
  $$ update tasks set parent_task_id = id where id = '0ac10000-0000-0000-0000-00000000e004' $$,
  null, null,
  'AC-TM-009: a task cannot be its own parent (update)'
);

-- AC-TM-010: parent in a DIFFERENT project (same org) → 42501, no existence leak
select throws_ok(
  $$ insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
       ('0ac10000-0000-0000-0000-00000000e005', '0ac10000-0000-0000-0000-000000000001',
        '0ac10000-0000-0000-0000-0000000000a0', 'Cross Project Subtask', 'To Do',
        '0ac10000-0000-0000-0000-00000000e002') $$,
  '42501', null,
  'AC-TM-010: a subtask must live in the SAME project as its parent (cross-project insert → 42501)'
);

-- AC-TM-011: parent in the SAME project → lives_ok
select lives_ok(
  $$ insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
       ('0ac10000-0000-0000-0000-00000000e006', '0ac10000-0000-0000-0000-000000000001',
        '0ac10000-0000-0000-0000-0000000000a0', 'Same Project Subtask', 'To Do',
        '0ac10000-0000-0000-0000-00000000e001') $$,
  'AC-TM-011: a subtask in the SAME project as its parent is accepted'
);

-- AC-TM-014: update parent_task_id to a different-project parent → 42501
select throws_ok(
  $$ update tasks set parent_task_id = '0ac10000-0000-0000-0000-00000000e002'
       where id = '0ac10000-0000-0000-0000-00000000e006' $$,
  '42501', null,
  'AC-TM-014: updating parent_task_id to a different-project parent → 42501'
);

-- AC-TM-012: deleting a parent task cascades to delete its subtasks
delete from tasks where id = '0ac10000-0000-0000-0000-00000000e001';
select is(
  (select count(*)::int from tasks where id = '0ac10000-0000-0000-0000-00000000e006'),
  0,
  'AC-TM-012: deleting a parent task cascades to delete its subtask'
);

-- AC-TM-015: priority accepts each of the four enum values
select lives_ok(
  $$ update tasks set priority = 'Urgent' where id = '0ac10000-0000-0000-0000-00000000e004' $$,
  'AC-TM-015: priority accepts Urgent'
);
select lives_ok(
  $$ update tasks set priority = 'High' where id = '0ac10000-0000-0000-0000-00000000e004' $$,
  'AC-TM-015: priority accepts High'
);
select lives_ok(
  $$ update tasks set priority = 'Normal' where id = '0ac10000-0000-0000-0000-00000000e004' $$,
  'AC-TM-015: priority accepts Normal'
);
select lives_ok(
  $$ update tasks set priority = 'Low' where id = '0ac10000-0000-0000-0000-00000000e004' $$,
  'AC-TM-015: priority accepts Low'
);

select finish();
rollback;
