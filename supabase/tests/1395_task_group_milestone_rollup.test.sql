-- 1395_task_group_milestone_rollup.test.sql — #2679 task groups roll up to a milestone.
-- AC-TGM-001..007 (spec docs/specs/task-group-milestone-rollup.spec.md). Fixture namespace 13950000-…
begin;
select plan(25);

\set A '00000000-0000-0000-0000-000000000001'
\set B '13950000-0000-0000-0000-000000000002'
\set PM '13950000-0000-0000-0000-0000000000a1'
\set ENG '13950000-0000-0000-0000-0000000000a2'
\set FIN '13950000-0000-0000-0000-0000000000a3'
\set EXE '13950000-0000-0000-0000-0000000000a4'
\set PMB '13950000-0000-0000-0000-0000000000b1'
\set P1 '13950000-0000-0000-0000-000000000021'
\set P2 '13950000-0000-0000-0000-000000000022'
\set PB '13950000-0000-0000-0000-000000000023'
\set M1 '13950000-0000-0000-0000-000000000031'
\set M2 '13950000-0000-0000-0000-000000000032'
\set MX '13950000-0000-0000-0000-000000000033'
\set MB '13950000-0000-0000-0000-000000000034'
\set G1 '13950000-0000-0000-0000-000000000041'
\set GX '13950000-0000-0000-0000-000000000042'

insert into organizations (id, name) values (:'B','TGM Org B');
insert into auth.users (id, email) values
  (:'PM','tgm-pm@example.com'),(:'ENG','tgm-eng@example.com'),(:'FIN','tgm-fin@example.com'),
  (:'EXE','tgm-exe@example.com'),(:'PMB','tgm-pmb@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  (:'PM',:'A','TGM PM','tgm-pm@example.com','Project Manager'),
  (:'ENG',:'A','TGM Eng','tgm-eng@example.com','Engineer'),
  (:'FIN',:'A','TGM Fin','tgm-fin@example.com','Finance'),
  (:'EXE',:'A','TGM Exe','tgm-exe@example.com','Executive'),
  (:'PMB',:'B','TGM PM B','tgm-pmb@example.com','Project Manager');
insert into companies (id, org_id, name, type) values
  ('13950000-0000-0000-0000-000000000010',:'A','TGM Client','Client'),
  ('13950000-0000-0000-0000-000000000011',:'B','TGM Client B','Client');
insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, contract_value, tax_treatment, tax_amount) values
  (:'P1',:'A','TGM-1','TGM One','Ongoing Project','13950000-0000-0000-0000-000000000010',:'PM',1000,1000,'exclusive',0),
  (:'P2',:'A','TGM-2','TGM Two','Ongoing Project','13950000-0000-0000-0000-000000000010',:'PM',1000,1000,'exclusive',0),
  (:'PB',:'B','TGM-B','TGM B','Ongoing Project','13950000-0000-0000-0000-000000000011',:'PMB',1000,1000,'exclusive',0);
insert into project_milestones (id, org_id, project_id, name, weight) values
  (:'M1',:'A',:'P1','M1',1),(:'M2',:'A',:'P1','M2',1),(:'MX',:'A',:'P2','MX',1),(:'MB',:'B',:'PB','MB',1);
-- M1: two direct tasks (1 Done). G1 (unlinked yet) holds three tasks (2 Done).
insert into tasks (id, org_id, project_id, milestone_id, name, status, assignee_id) values
  ('13950000-0000-0001-0000-000000000001',:'A',:'P1',:'M1','d1','Done',null),
  ('13950000-0000-0001-0000-000000000002',:'A',:'P1',:'M1','d2','To Do',:'ENG');
insert into task_groups (id, org_id, project_id, name) values (:'G1',:'A',:'P1','G1'),(:'GX',:'A',:'P2','GX');
insert into tasks (id, org_id, project_id, name, status, task_group_id) values
  ('13950000-0000-0001-0000-000000000011',:'A',:'P1','g1','Done',:'G1'),
  ('13950000-0000-0001-0000-000000000012',:'A',:'P1','g2','Done',:'G1'),
  ('13950000-0000-0001-0000-000000000013',:'A',:'P1','g3','To Do',:'G1');

-- AC-TGM-001: no linked group -> exactly today's figures.
select results_eq($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031' $$,
  $$ values (2, 50.00) $$, 'AC-TGM-001: milestone with no linked group counts only its direct tasks (2 tasks, 50%)');
select is((select delivery_pct::numeric(6,2) from get_projects_delivery(array['13950000-0000-0000-0000-000000000021'::uuid])), 25.00,
  'AC-TGM-001: project delivery unchanged by an unlinked group ((50 + 0) / 2)');

-- AC-TGM-002: link G1 -> 5 tasks, 3 Done = 60%.
update task_groups set milestone_id = :'M1' where id = :'G1';
select results_eq($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031' $$,
  $$ values (5, 60.00) $$, 'AC-TGM-002: linked group adds its tasks (5 tasks, 60%)');
select is((select delivery_pct::numeric(6,2) from get_projects_delivery(array['13950000-0000-0000-0000-000000000021'::uuid])), 30.00,
  'AC-TGM-002: project delivery follows ((60 + 0) / 2)');

-- AC-TGM-003: a task directly on M1 and also in G1 counts once.
update tasks set task_group_id = :'G1' where id = '13950000-0000-0001-0000-000000000002';
select is((select task_count from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031'), 5,
  'AC-TGM-003: a task both direct and in the linked group counts once');

-- Subtasks and archived tasks of the group never count.
insert into tasks (id, org_id, project_id, name, status, task_group_id, parent_task_id, archived_at) values
  ('13950000-0000-0001-0000-000000000021',:'A',:'P1','sub','Done',:'G1','13950000-0000-0001-0000-000000000011',null),
  ('13950000-0000-0001-0000-000000000022',:'A',:'P1','arch','Done',:'G1',null,now());
select is((select task_count from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031'), 5,
  'AC-TGM-004: subtasks and archived tasks of the group never count');

-- AC-TGM-004: archived group, then unlinked group -> back to the direct tasks.
update task_groups set archived_at = now() where id = :'G1';
select results_eq($$ select task_count, calculated_pct::numeric(6,2) from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031' $$,
  $$ values (2, 50.00) $$, 'AC-TGM-004: an archived group stops counting (direct tasks only)');
update task_groups set archived_at = null where id = :'G1';
update task_groups set milestone_id = null where id = :'G1';
select is((select task_count from get_project_milestones('13950000-0000-0000-0000-000000000021') where id = '13950000-0000-0000-0000-000000000031'), 2,
  'AC-TGM-004: an unlinked group stops counting');
update task_groups set milestone_id = :'M1' where id = :'G1';

-- Deleting the milestone unlinks the group and keeps it.
-- (Checked on M2 to keep M1's fixture: link GX is cross-project so use a fresh group.)
insert into task_groups (id, org_id, project_id, name, milestone_id) values ('13950000-0000-0000-0000-000000000043',:'A',:'P1','G2',:'M2');
delete from project_milestones where id = :'M2';
select is((select milestone_id from task_groups where id = '13950000-0000-0000-0000-000000000043'), null,
  'FK: deleting a milestone unlinks its group and keeps the group');

-- ── Roles ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"13950000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-TGM-006: PM and Admin-shape writes work.
select lives_ok($$ insert into task_groups (id, project_id, name) values ('13950000-0000-0000-0000-000000000044','13950000-0000-0000-0000-000000000021','PM group') $$,
  'AC-TGM-006: a Project Manager creates a task group (org_id stamped by default)');
select lives_ok($$ update task_groups set milestone_id = '13950000-0000-0000-0000-000000000031' where id = '13950000-0000-0000-0000-000000000044' $$,
  'AC-TGM-006: a Project Manager links a group to a milestone of its project');
select lives_ok($$ update tasks set task_group_id = '13950000-0000-0000-0000-000000000044' where id = '13950000-0000-0000-0000-000000000013' $$,
  'AC-TGM-006: a Project Manager assigns a task to a group');

-- AC-TGM-005: cross-project refusals.
select throws_ok($$ update tasks set task_group_id = '13950000-0000-0000-0000-000000000042' where id = '13950000-0000-0001-0000-000000000013' $$,
  '23503', null, 'AC-TGM-005: a task cannot join a group of another project');
select throws_ok($$ update task_groups set milestone_id = '13950000-0000-0000-0000-000000000033' where id = '13950000-0000-0000-0000-000000000041' $$,
  '23503', null, 'AC-TGM-005: a group cannot link to a milestone of another project');
select throws_ok($$ insert into task_groups (project_id, name) values ('13950000-0000-0000-0000-000000000023','Cross org') $$,
  '42501', null, 'AC-TGM-007: a Project Manager cannot create a group in another organisation''s project');

-- Engineer assignee.
set local request.jwt.claims = '{"sub":"13950000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ update tasks set task_group_id = '13950000-0000-0000-0000-000000000044' where id = '13950000-0000-0001-0000-000000000002' $$,
  '42501', null, 'AC-TGM-006: an Engineer assignee cannot move a task into another group');
select throws_ok($$ insert into tasks (project_id, name, task_group_id) values ('13950000-0000-0000-0000-000000000021','eng new','13950000-0000-0000-0000-000000000041') $$,
  '42501', 'only a manager may assign a task to a task group', 'AC-TGM-006: an Engineer cannot create a task already in a group');
select throws_ok($$ insert into task_groups (project_id, name) values ('13950000-0000-0000-0000-000000000021','eng group') $$,
  '42501', null, 'AC-TGM-006: an Engineer cannot create a group');
select is((select count(*)::int from task_groups where project_id = '13950000-0000-0000-0000-000000000021'), 3,
  'any member of the organisation reads the groups of the project (G1, the unlinked G2, the PM group)');

-- Finance and Executive.
set local request.jwt.claims = '{"sub":"13950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ insert into task_groups (project_id, name) values ('13950000-0000-0000-0000-000000000021','fin group') $$,
  '42501', null, 'AC-TGM-006: Finance cannot create a group');
select throws_ok($$ insert into tasks (project_id, name, task_group_id) values ('13950000-0000-0000-0000-000000000021','fin new','13950000-0000-0000-0000-000000000041') $$,
  '42501', null, 'AC-TGM-006: Finance cannot create a task already in a group');
set local request.jwt.claims = '{"sub":"13950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ insert into task_groups (project_id, name) values ('13950000-0000-0000-0000-000000000021','exe group') $$,
  '42501', null, 'AC-TGM-006: Executive cannot create a group');

-- Org B manager.
set local request.jwt.claims = '{"sub":"13950000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from task_groups), 0, 'AC-TGM-007: another organisation reads none of the groups');
select throws_ok($$ insert into task_groups (org_id, project_id, name, milestone_id) values ('13950000-0000-0000-0000-000000000002','13950000-0000-0000-0000-000000000023','b group','13950000-0000-0000-0000-000000000031') $$,
  '23503', null, 'AC-TGM-007: another organisation cannot link its group to this organisation''s milestone');

reset role;
select is((select task_group_id from tasks where id = '13950000-0000-0001-0000-000000000002'), '13950000-0000-0000-0000-000000000041'::uuid,
  'the Engineer''s refused write left the task''s group unchanged');

select * from finish();
rollback;
