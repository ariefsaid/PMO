-- 0209b_task_project_cascade_strands.test.sql — a move that cannot carry the whole subtree REFUSES
-- AC-TASK-410..411 / OD-TASK-2 / #550 (security review, Important 1 and 4)
--
-- ⛔ THE DEFECT THIS PINS. `cascade_task_project_to_subtree` is `security invoker`, so its UPDATE is
-- subject to RLS — and an UPDATE matching no rows is a SILENT no-op. A mover allowed to edit the
-- parent but not a descendant got `UPDATE 1`, no error, and a split tree: exactly the inconsistency
-- #550 exists to close, reproduced by its own fix.
--
-- The stranded subtask was then frozen for EVERYONE, because the BEFORE guard saw a parent in
-- another project — surfacing to the user as "Your role does not allow this change. Ask an
-- administrator", which is false: their role does allow it.
--
-- A split tree is a TABLE invariant, not a per-actor one, so the honest outcome is a refusal naming
-- what happened. Separate file so the happy-path fixture in 0209 stays readable.
begin;
select plan(2);

insert into organizations (id, name) values
  ('020b0000-0000-0000-0000-000000000001', 'Cascade Strand Org (0209b)');

insert into auth.users (id, email) values
  ('020b0000-0000-0000-0000-0000000000e1', 'eng@strand0209.example'),
  ('020b0000-0000-0000-0000-0000000000f1', 'pm@strand0209.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('020b0000-0000-0000-0000-0000000000e1', '020b0000-0000-0000-0000-000000000001',
   'Engineer 0209b', 'eng@strand0209.example', 'Engineer'),
  ('020b0000-0000-0000-0000-0000000000f1', '020b0000-0000-0000-0000-000000000001',
   'PM 0209b', 'pm@strand0209.example', 'Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, tax_treatment, tax_amount)
values ('0b200000-0000-0000-0000-00000000000a', '020b0000-0000-0000-0000-000000000001',
        'STR', 'Strand Project', 'Ongoing Project', '020b0000-0000-0000-0000-0000000000f1', 0, 0, 0, null, null);

-- The Engineer's own project-less parent (OD-TASK-2's motivating workflow: file a My Tasks item).
insert into tasks (id, org_id, project_id, name, status, parent_task_id, created_by) values
  ('0b210000-0000-0000-0000-000000000001', '020b0000-0000-0000-0000-000000000001',
   null, 'Engineer Parent', 'To Do', null, '020b0000-0000-0000-0000-0000000000e1'),
  -- …with a subtask someone ELSE created and that is not assigned to the Engineer. The Engineer can
  -- SEE it (reads are org-wide) but may not write it.
  ('0b210000-0000-0000-0000-000000000002', '020b0000-0000-0000-0000-000000000001',
   null, 'Foreign Subtask', 'To Do', '0b210000-0000-0000-0000-000000000001',
   '020b0000-0000-0000-0000-0000000000f1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"020b0000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select throws_ok(
  $$update public.tasks set project_id = '0b200000-0000-0000-0000-00000000000a'
     where id = '0b210000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'AC-TASK-410 a move that cannot carry every subtask is REFUSED, not silently half-applied'
);

-- And the refusal must leave nothing behind: the parent stays where it was, so the user retries
-- against an unchanged tree rather than a partly-moved one.
select is(
  (select project_id from tasks where id = '0b210000-0000-0000-0000-000000000001'),
  null,
  'AC-TASK-411 …and the parent did not move either — the whole move rolls back, never half of it'
);

select * from finish();
rollback;
