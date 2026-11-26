-- 1971_task_leaf_readers.test.sql — #2807 review follow-up: the leaf test written inline in the readers, and a
-- parent's own status and due date feeding no overdue figure.
--
-- AC-TREE-101  the helper and the inline leaf test agree on every task of the fixture (parity)
-- AC-TREE-102  a child deleted in the task tool does not make its parent a parent
-- AC-TREE-103  a parent past its due date whose subtasks are all Done is not overdue on the executive dashboard;
--              a late leaf still is
-- AC-TREE-104  the same on the scheduled overdue report
-- AC-TREE-105  the phase counts the subtasks, not their parent (the inline join reads the same as the helper)
--
-- Fixture namespace: 19710000-… (own org, so no seed row reaches the dashboard read).
begin;
select plan(7);

\set ORG '19710000-0000-0000-0000-000000000001'
\set EXE '19710000-0000-0000-0000-0000000000a1'
\set R   '19710000-0000-0000-0000-0000000000d1'
\set RM  '19710000-0000-0000-0000-0000000000b1'
\set RN  '19710000-0000-0000-0000-0000000000b2'
\set PAR '19710000-0000-0000-0002-000000000001'
\set TT  '19710000-0000-0000-0002-000000000010'

insert into organizations (id, name) values (:'ORG', 'Leaf Readers Org');
insert into auth.users (id, email) values (:'EXE', 'leaf-exe@invalid.example');
insert into profiles (id, org_id, full_name, email, role) values (:'EXE', :'ORG', 'Leaf Exe', 'leaf-exe@invalid.example', 'Executive');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  (:'R', :'ORG', 'Leaf R', 'Ongoing Project', 'USD', 1000, 'exclusive', 0);
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  (:'RM', :'ORG', :'R', 'RM', 1, 0),
  (:'RN', :'ORG', :'R', 'RN', 1, 1);
-- A parent past its due date, stored To Do, whose two subtasks are Done (and past due themselves).
insert into tasks (id, org_id, project_id, milestone_id, name, status, end_date) values
  (:'PAR', :'ORG', :'R', :'RM', 'parent', 'To Do', (now() at time zone 'UTC')::date - 10);
insert into tasks (id, org_id, project_id, milestone_id, name, status, end_date, parent_task_id) values
  ('19710000-0000-0000-0002-000000000002', :'ORG', :'R', :'RM', 'sub done 1', 'Done', (now() at time zone 'UTC')::date - 12, :'PAR'),
  ('19710000-0000-0000-0002-000000000003', :'ORG', :'R', :'RM', 'sub done 2', 'Done', (now() at time zone 'UTC')::date - 11, :'PAR');
-- A late leaf, and a task whose only child was deleted in the task tool, plus one with an archived child.
insert into tasks (id, org_id, project_id, milestone_id, name, status, end_date) values
  ('19710000-0000-0000-0002-000000000004', :'ORG', :'R', :'RM', 'late leaf', 'In Progress', (now() at time zone 'UTC')::date - 3),
  (:'TT', :'ORG', :'R', :'RN', 'tombstone parent', 'Done', null),
  ('19710000-0000-0000-0002-000000000020', :'ORG', :'R', :'RN', 'archive parent', 'To Do', null);
-- (the children sit in no phase: the readers still count a deleted leaf itself, a separate, older question;
-- written as a signed-in write so the sync's place rule (1972) leaves them unplaced)
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id, tombstoned_at, archived_at) values
  ('19710000-0000-0000-0002-000000000011', :'ORG', :'R', null, 'deleted in the tool', 'To Do', :'TT', now(), null),
  ('19710000-0000-0000-0002-000000000021', :'ORG', :'R', null, 'archived child', 'To Do', '19710000-0000-0000-0002-000000000020', null, now());
select set_config('request.jwt.claims', '', true);

-- AC-TREE-101: the helper (kept for callers) and the inline test the readers use agree row for row.
select set_eq(
  format($$ select t.id, public.task_counts_toward_progress(t) from tasks t where t.org_id = %L $$, :'ORG'),
  format($$ select t.id, t.archived_at is null and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.archived_at is null and c.tombstoned_at is null)
              from tasks t where t.org_id = %L $$, :'ORG'),
  'AC-TREE-101: the helper and the inline leaf test agree on every task');

-- AC-TREE-102
select is((select public.task_counts_toward_progress(t) from tasks t where t.id = :'TT'), true,
  'AC-TREE-102: a task whose only child was deleted in the task tool still counts');

-- AC-TREE-104 (definer, service-side: called as the scheduler does)
select is((select body from public.scheduled_report_content('overdue_tasks', :'ORG', :'EXE',
            (now() at time zone 'UTC')::date - 30, (now() at time zone 'UTC')::date, 'en', 'Weekly')) like '%Leaf R: 1 overdue%',
  true, 'AC-TREE-104: the scheduled report counts the late leaf only, never the parent with all subtasks Done');

-- AC-TREE-106
insert into tasks (org_id, project_id, name, status, end_date, archived_at)
values (:'ORG', :'R', 'archived late task', 'To Do', (now() at time zone 'UTC')::date - 5, now());
select is((select split_part(body, E'\n\n', 2) from public.scheduled_report_content('overdue_tasks', :'ORG', :'EXE',
            (now() at time zone 'UTC')::date - 30, (now() at time zone 'UTC')::date, 'en', 'Weekly')),
  'Leaf R: 1 overdue', 'AC-TREE-106: the scheduled report excludes archived overdue tasks');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);

-- AC-TREE-103
select is((select (r ->> 'overdue_tasks')::int
             from json_array_elements(get_executive_dashboard() -> 'attention_projects') r where r ->> 'id' = :'R'),
  1, 'AC-TREE-103: the dashboard counts the late leaf as overdue and not the parent whose subtasks are all Done');

-- AC-TREE-105: RM counts sub done 1, sub done 2 and the late leaf (2 of 3 Done); RN counts the tombstone parent
-- and the archive parent (its only child is archived).
select results_eq(format($$ select name, task_count, calculated_pct::numeric(6,2) from get_project_milestones(%L) order by sort_order $$, :'R'),
  $$ values ('RM'::text, 3, 66.67::numeric(6,2)), ('RN'::text, 2, 50.00::numeric(6,2)) $$,
  'AC-TREE-105: phases count the leaves (inline leaf test), never the parent');
select is((select delivery_pct::numeric(6,2) from get_projects_delivery(array[:'R'::uuid])), 58.33::numeric(6,2),
  'AC-TREE-105: delivery % is the equal-weight mean of the two phases ((66.67 + 50) / 2)');

select * from finish();
rollback;
