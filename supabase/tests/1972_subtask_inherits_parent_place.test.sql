-- 1972_subtask_inherits_parent_place.test.sql — #2807 review follow-up: a subtask sits in its parent's place.
--
-- AC-TREE-201  a task-tool sync write (no signed-in user) of an unplaced subtask takes its parent's phase
-- AC-TREE-202  ... and its parent's group, also when the parent is set by a later update
-- AC-TREE-203  a subtask placed somewhere explicitly keeps its own place; a signed-in write is never rewritten
-- AC-TREE-204  the backfill: a parent in a phase with unplaced subtasks (two levels) gets their work back in its
--              phase (count and %); an explicitly placed subtask is not touched
-- AC-TREE-205  no client may call the trigger or backfill functions
--
-- Fixture namespace: 19720000-…
begin;
select plan(9);

\set ORG '19720000-0000-0000-0000-000000000001'
\set EXE '19720000-0000-0000-0000-0000000000a1'
\set S   '19720000-0000-0000-0000-0000000000d1'
\set SM  '19720000-0000-0000-0000-0000000000b1'
\set SO  '19720000-0000-0000-0000-0000000000b2'
\set SG  '19720000-0000-0000-0001-000000000001'
\set SP  '19720000-0000-0000-0002-000000000001'
\set GP  '19720000-0000-0000-0002-000000000002'

insert into organizations (id, name) values (:'ORG', 'Place Org');
insert into auth.users (id, email) values (:'EXE', 'place-exe@invalid.example');
insert into profiles (id, org_id, full_name, email, role) values (:'EXE', :'ORG', 'Place Exe', 'place-exe@invalid.example', 'Executive');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  (:'S', :'ORG', 'Place S', 'Ongoing Project', 'USD', 1000, 'exclusive', 0);
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  (:'SM', :'ORG', :'S', 'SM', 1, 0),
  (:'SO', :'ORG', :'S', 'SO', 1, 1);
insert into task_groups (id, org_id, project_id, name) values (:'SG', :'ORG', :'S', 'Group');
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  (:'SP', :'ORG', :'S', :'SM', 'parent in SM', 'To Do'),
  ('19720000-0000-0000-0002-000000000003', :'ORG', :'S', :'SM', 'leaf in SM', 'Done');
insert into tasks (id, org_id, project_id, task_group_id, name, status) values (:'GP', :'ORG', :'S', :'SG', 'parent in group', 'To Do');

-- Sync writes: no signed-in user.
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('19720000-0000-0000-0003-000000000001', :'ORG', :'S', 'synced sub', 'To Do', :'SP');
select is((select milestone_id from tasks where id = '19720000-0000-0000-0003-000000000001'), :'SM'::uuid,
  'AC-TREE-201: a synced subtask with no place takes its parent''s phase');
insert into tasks (id, org_id, project_id, name, status) values ('19720000-0000-0000-0003-000000000002', :'ORG', :'S', 'synced flat', 'To Do');
update tasks set parent_task_id = :'GP' where id = '19720000-0000-0000-0003-000000000002';
select results_eq($$ select milestone_id, task_group_id from tasks where id = '19720000-0000-0000-0003-000000000002' $$,
  format($$ values (null::uuid, %L::uuid) $$, :'SG'),
  'AC-TREE-202: a synced task nested later takes its parent''s group');
insert into tasks (id, org_id, project_id, milestone_id, name, status, parent_task_id) values
  ('19720000-0000-0000-0003-000000000003', :'ORG', :'S', :'SO', 'synced placed sub', 'To Do', :'SP');
select is((select milestone_id from tasks where id = '19720000-0000-0000-0003-000000000003'), :'SO'::uuid,
  'AC-TREE-203: a subtask placed explicitly keeps its own phase');

-- Signed-in writes are never rewritten (the app places subtasks itself): seed the unplaced tree the backfill fixes.
select set_config('request.jwt.claims', json_build_object('sub', :'EXE', 'role', 'authenticated')::text, true);
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('19720000-0000-0000-0004-000000000001', :'ORG', :'S', 'sub 1', 'Done', :'SP'),
  ('19720000-0000-0000-0004-000000000002', :'ORG', :'S', 'sub 2', 'To Do', :'SP');
insert into tasks (id, org_id, project_id, name, status, parent_task_id) values
  ('19720000-0000-0000-0004-000000000003', :'ORG', :'S', 'sub 2.1', 'To Do', '19720000-0000-0000-0004-000000000002');
select is((select count(*)::int from tasks where id::text like '19720000-0000-0000-0004-%' and milestone_id is null and task_group_id is null), 3,
  'AC-TREE-203: a signed-in write is never rewritten by the sync rule');
select set_config('request.jwt.claims', '', true);

-- Before the backfill: SM counts leaf in SM (Done) and the synced sub (To Do); sub 1 and sub 2.1 count nowhere.
select results_eq(format($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones(%L) where id = %L $$, :'S', :'SM'),
  $$ values (2, 50.00::numeric(6,2)) $$, 'precondition: the unplaced subtasks are missing from their parent''s phase');
select public.backfill_subtask_places();
-- After: leaf in SM (Done), synced sub (To Do), sub 1 (Done), sub 2.1 (To Do): 4 tasks, 50%.
select results_eq(format($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones(%L) where id = %L $$, :'S', :'SM'),
  $$ values (4, 50.00::numeric(6,2)) $$, 'AC-TREE-204: the parent''s phase counts its subtasks'' work again (two levels down)');
select is((select milestone_id from tasks where id = '19720000-0000-0000-0003-000000000003'), :'SO'::uuid,
  'AC-TREE-204: the backfill leaves an explicitly placed subtask where it is');

-- AC-TREE-205
select ok(not has_function_privilege('authenticated', 'public.backfill_subtask_places()', 'execute')
      and not has_function_privilege('anon', 'public.backfill_subtask_places()', 'execute'),
  'AC-TREE-205: no client may run the backfill');
select ok(not has_function_privilege('authenticated', 'public.inherit_parent_task_place()', 'execute'),
  'AC-TREE-205: no client may call the trigger function');

select * from finish();
rollback;
