-- 0145_task_archive_rollup_and_rls.test.sql
-- Archive is PMO-owned only, and archived tasks are excluded from delivery rollups.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01450000-0000-0000-0000-000000000001', 'Archive Rollup Org');
insert into auth.users (id, email) values
  ('01450000-0000-0000-0000-0000000000a1', 'archive-manager@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01450000-0000-0000-0000-0000000000a1', '01450000-0000-0000-0000-000000000001',
   'Archive Manager', 'archive-manager@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status) values
  ('01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000001', 'ARC-1', 'Archive project', 'Ongoing Project');
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  ('01450000-0000-0000-0000-000000000010', '01450000-0000-0000-0000-000000000001',
   '01450000-0000-0000-0000-000000000001', 'Delivery', 10, 0);

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('01450000-0000-0000-0000-000000000011', '01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000010', 'Done live', 'Done'),
  ('01450000-0000-0000-0000-000000000012', '01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000010', 'Obsolete archived', 'To Do');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01450000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update tasks set archived_at = now() where id = '01450000-0000-0000-0000-000000000012';

select is((select task_count from get_project_milestones('01450000-0000-0000-0000-000000000001') where id = '01450000-0000-0000-0000-000000000010'), 1, 'AC-CUA-099: archived non-Done task is excluded from milestone task_count');
select is((select calculated_pct::numeric(10,0) from get_project_milestones('01450000-0000-0000-0000-000000000001') where id = '01450000-0000-0000-0000-000000000010'), 100::numeric, 'AC-CUA-100: archived non-Done task is excluded from calculated_pct');
select is((select delivery_pct::numeric(10,0) from get_projects_delivery(array['01450000-0000-0000-0000-000000000001'::uuid])), 100::numeric, 'AC-CUA-101: archived non-Done task is excluded from delivery_pct');

-- PMO ownership: manager can set and clear the reversible archive marker.
select lives_ok($$update tasks set archived_at = now() where id = '01450000-0000-0000-0000-000000000011'$$, 'AC-CUA-099: manager can archive a task while tasks are PMO-owned');
select lives_ok($$update tasks set archived_at = null where id = '01450000-0000-0000-0000-000000000011'$$, 'AC-CUA-100: manager can unarchive a task while tasks are PMO-owned');

-- Flip ownership as the fixture owner. The trigger, not the UI gate, rejects the authenticated write.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into external_domain_ownership (org_id, external_tier, domain) values ('01450000-0000-0000-0000-000000000001', 'clickup', 'tasks');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id)
values ('01450000-0000-0000-0000-000000000001', '01450000-0000-0000-0000-000000000001', 'clickup', 'archive-list');
set local role authenticated;
set local request.jwt.claims = '{"sub":"01450000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update tasks set archived_at = now() where id = '01450000-0000-0000-0000-000000000011'$$, '42501', null, 'AC-CUA-101: non-service user cannot archive while tasks are externally-owned');
select finish();
rollback;
