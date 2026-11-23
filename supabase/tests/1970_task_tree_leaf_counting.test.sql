-- 1970_task_tree_leaf_counting.test.sql — #2807: tasks nest to any depth and every progress figure counts each
-- piece of work once: a task counts when it is not archived and has no live child (task_counts_toward_progress).
--
-- AC-TREE-001  a project with no subtasks reads exactly as the old top-level rule computed it
-- AC-TREE-002  regrouping a project's leaves under new parents (two levels) leaves get_project_milestones,
--              get_projects_delivery and the executive dashboard's overdue phases identical
-- AC-TREE-003  an archived child does not make its parent a parent
-- AC-TREE-004  a parent's own status moves no figure; a leaf's does
-- AC-TREE-005  a task can never sit under its own descendant (TASK_TREE_CYCLE), a legal move still lands
-- AC-TREE-006  the helper is not callable by anon; the trigger function by no client
--
-- Fixture namespace: 19700000-… (own org, so no seed row reaches the dashboard read).
begin;
select plan(14);

\set ORG   '19700000-0000-0000-0000-000000000001'
\set EXE   '19700000-0000-0000-0000-0000000000a1'
\set P     '19700000-0000-0000-0000-0000000000d1'
\set Q     '19700000-0000-0000-0000-0000000000d2'
\set M1    '19700000-0000-0000-0000-0000000000b1'
\set M2    '19700000-0000-0000-0000-0000000000b2'
\set MDONE '19700000-0000-0000-0000-0000000000b3'
\set M3    '19700000-0000-0000-0000-0000000000b4'
\set QM1   '19700000-0000-0000-0000-0000000000b5'
\set QM2   '19700000-0000-0000-0000-0000000000b6'
\set G     '19700000-0000-0000-0001-000000000001'
\set G2    '19700000-0000-0000-0001-000000000002'

insert into organizations (id, name) values (:'ORG', 'Task Tree Org');
insert into auth.users (id, email) values (:'EXE', 'tree-exe@invalid.example');
insert into profiles (id, org_id, full_name, email, role) values (:'EXE', :'ORG', 'Tree Exe', 'tree-exe@invalid.example', 'Executive');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  (:'P', :'ORG', 'Tree P', 'Ongoing Project', 'USD', 1000, 'exclusive', 0),
  (:'Q', :'ORG', 'Tree Q', 'Ongoing Project', 'USD', 1000, 'exclusive', 0);
insert into project_milestones (id, org_id, project_id, name, weight, sort_order, target_date) values
  (:'M1',    :'ORG', :'P', 'M1',    1, 0, null),
  (:'M2',    :'ORG', :'P', 'M2',    3, 1, null),
  (:'MDONE', :'ORG', :'P', 'MDONE', 1, 2, ((now() at time zone 'UTC')::date - 10)),  -- past target, all leaves Done
  (:'M3',    :'ORG', :'P', 'M3',    1, 3, null),
  (:'QM1',   :'ORG', :'Q', 'QM1',   1, 0, null),
  (:'QM2',   :'ORG', :'Q', 'QM2',   3, 1, null);
-- P: flat leaves. M1 1/2 Done, M2 1/3 Done, MDONE 2/2 Done.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('19700000-0000-0000-0002-000000000001', :'ORG', :'P', :'M1',    'a', 'Done'),
  ('19700000-0000-0000-0002-000000000002', :'ORG', :'P', :'M1',    'b', 'To Do'),
  ('19700000-0000-0000-0002-000000000003', :'ORG', :'P', :'M2',    'c', 'Done'),
  ('19700000-0000-0000-0002-000000000004', :'ORG', :'P', :'M2',    'd', 'In Progress'),
  ('19700000-0000-0000-0002-000000000005', :'ORG', :'P', :'M2',    'e', 'Blocked'),
  ('19700000-0000-0000-0002-000000000006', :'ORG', :'P', :'MDONE', 'f', 'Done'),
  ('19700000-0000-0000-0002-000000000007', :'ORG', :'P', :'MDONE', 'g', 'Done');
-- Q: the same shape, never regrouped (the no-subtask control), plus one archived task.
insert into tasks (id, org_id, project_id, milestone_id, name, status, archived_at) values
  ('19700000-0000-0000-0003-000000000001', :'ORG', :'Q', :'QM1', 'qa', 'Done', null),
  ('19700000-0000-0000-0003-000000000002', :'ORG', :'Q', :'QM1', 'qb', 'To Do', null),
  ('19700000-0000-0000-0003-000000000003', :'ORG', :'Q', :'QM2', 'qc', 'Done', null),
  ('19700000-0000-0000-0003-000000000004', :'ORG', :'Q', :'QM2', 'qd', 'To Do', null),
  ('19700000-0000-0000-0003-000000000005', :'ORG', :'Q', :'QM2', 'qx', 'Done', now());

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);

-- AC-TREE-001: Q (no subtasks) equals the pre-#2807 rule, computed inline.
select set_eq(
  format($$ select id, task_count, calculated_pct, effective_pct from get_project_milestones(%L) $$, :'Q'),
  format($$ select m.id, count(t.id)::int,
                   count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
                   coalesce(m.input_pct, count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0), 0)
              from project_milestones m
              left join tasks t on t.milestone_id = m.id and t.parent_task_id is null and t.archived_at is null
             where m.project_id = %L group by m.id $$, :'Q'),
  'AC-TREE-001: a project with no subtasks reads exactly as the top-level rule did');
select is((select delivery_pct::numeric(6,2) from get_projects_delivery(array[:'Q'::uuid])), 37.50::numeric(6,2),
  'AC-TREE-001: its delivery % is unchanged ((50 x 1 + 33.33 x 3) / 4 = 37.50)');

-- Snapshot P before regrouping.
create temp table before_m on commit drop as
  select id, task_count, calculated_pct, effective_pct from get_project_milestones(:'P');
create temp table before_d on commit drop as
  select delivery_pct from get_projects_delivery(array[:'P'::uuid]);
create temp table before_x on commit drop as
  select (r ->> 'overdue_milestones')::int as overdue_milestones
    from json_array_elements(get_executive_dashboard() -> 'attention_projects') r where r ->> 'id' = :'P';
select is((select overdue_milestones from before_x), 0, 'precondition: the all-Done past phase is not overdue');

-- Regroup every leaf of P: group G (To Do, no dates) holds a, b and group G2; G2 holds c, d, e, f, g.
reset role;
insert into tasks (id, org_id, project_id, milestone_id, name, status) values (:'G', :'ORG', :'P', :'M1', 'Group', 'To Do');
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values (:'G2', :'ORG', :'P', :'MDONE', 'Sub-group', 'To Do', :'G');
update tasks set parent_task_id = :'G'  where id in ('19700000-0000-0000-0002-000000000001', '19700000-0000-0000-0002-000000000002');
update tasks set parent_task_id = :'G2' where id in ('19700000-0000-0000-0002-000000000003', '19700000-0000-0000-0002-000000000004',
                                                   '19700000-0000-0000-0002-000000000005', '19700000-0000-0000-0002-000000000006',
                                                   '19700000-0000-0000-0002-000000000007');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);

-- AC-TREE-002
select set_eq(format($$ select id, task_count, calculated_pct, effective_pct from get_project_milestones(%L) $$, :'P'),
  'select * from before_m', 'AC-TREE-002: phase counts and % identical after regrouping under two levels of parents');
select is((select delivery_pct from get_projects_delivery(array[:'P'::uuid])), (select delivery_pct from before_d),
  'AC-TREE-002: project delivery % identical after regrouping');
select is((select (r ->> 'overdue_milestones')::int
             from json_array_elements(get_executive_dashboard() -> 'attention_projects') r where r ->> 'id' = :'P'),
  (select overdue_milestones from before_x),
  'AC-TREE-002: executive dashboard overdue phases identical (the To Do parents never make a Done phase late)');

-- AC-TREE-004: a parent's own status moves nothing; a leaf's does.
reset role;
update tasks set status = 'Done' where id in (:'G', :'G2');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);
select set_eq(format($$ select id, task_count, calculated_pct, effective_pct from get_project_milestones(%L) $$, :'P'),
  'select * from before_m', 'AC-TREE-004: marking the parents Done moves no phase');
reset role;
update tasks set status = 'Done' where id = '19700000-0000-0000-0002-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);
select is((select calculated_pct::numeric(6,2) from get_project_milestones(:'P') where id = :'M1'), 100.00::numeric(6,2),
  'AC-TREE-004: a leaf turning Done moves its phase (M1 2/2)');

-- AC-TREE-003: an archived child does not make a parent.
reset role;
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('19700000-0000-0000-0004-000000000001', :'ORG', :'P', :'M3', 'x', 'Done');
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id, archived_at) values
  ('19700000-0000-0000-0004-000000000002', :'ORG', :'P', :'M3', 'x-archived-child', 'To Do', '19700000-0000-0000-0004-000000000001', now());
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);
select results_eq(format($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones(%L) where id = %L $$, :'P', :'M3'),
  $$ values (1, 100.00::numeric(6,2)) $$, 'AC-TREE-003: a task whose only child is archived still counts');

-- AC-TREE-005: cycles refused, legal moves land.
reset role;
select throws_ok(format($$ update tasks set parent_task_id = %L where id = %L $$, :'G2', :'G'),
  '23514', 'TASK_TREE_CYCLE: a task cannot sit under one of its own subtasks', 'AC-TREE-005: a parent cannot move under its child');
select throws_ok(format($$ update tasks set parent_task_id = %L where id = %L $$, '19700000-0000-0000-0002-000000000003', :'G'),
  '23514', 'TASK_TREE_CYCLE: a task cannot sit under one of its own subtasks', 'AC-TREE-005: a parent cannot move under its grandchild');
select lives_ok(format($$ update tasks set parent_task_id = %L where id = %L $$, :'G2', '19700000-0000-0000-0002-000000000001'),
  'AC-TREE-005: moving a leaf to another branch still lands');

-- AC-TREE-006
select ok(not has_function_privilege('anon', 'public.task_counts_toward_progress(public.tasks)', 'execute'),
  'AC-TREE-006: anon cannot call the counting helper');
select ok(not has_function_privilege('authenticated', 'public.check_task_tree_no_cycle()', 'execute'),
  'AC-TREE-006: no client can call the cycle trigger function');

select * from finish();
rollback;
