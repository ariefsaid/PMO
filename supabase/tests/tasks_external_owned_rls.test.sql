-- tasks_external_owned_rls.test.sql
-- AC-CUA-020/021/022/023 [pgTAP]: tasks writes split per command while flipped; managers retain
-- milestone-only enhancement writes; service-role mirror writes bypass the task column-pin only for
-- externally-owned orgs; releasing ownership restores the shipped manager write path; non-flipped orgs
-- remain byte-for-byte unchanged.
-- AC-TM-016/017 (OD-INT-9): description/priority are ClickUp-owned native fields, NOT enhancement
-- columns — a non-service-role user (including a manager role) cannot change them while tasks are
-- externally-owned, same as name/status.
begin;
select plan(17);

insert into organizations (id, name) values
  ('00910000-0000-0000-0000-000000000001','AC-CUA Tasks Org A (flipped)'),
  ('00910000-0000-0000-0000-000000000002','AC-CUA Tasks Org B (PMO-owned)');

insert into auth.users (id, email) values
  ('00910000-0000-0000-0000-0000000000a1','tasks-a-manager@example.com'),
  ('00910000-0000-0000-0000-0000000000a2','tasks-a-engineer@example.com'),
  ('00910000-0000-0000-0000-0000000000b1','tasks-b-manager@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('00910000-0000-0000-0000-0000000000a1','00910000-0000-0000-0000-000000000001','Org A Manager','tasks-a-manager@example.com','Project Manager','active'),
  ('00910000-0000-0000-0000-0000000000a2','00910000-0000-0000-0000-000000000001','Org A Engineer','tasks-a-engineer@example.com','Engineer','active'),
  ('00910000-0000-0000-0000-0000000000b1','00910000-0000-0000-0000-000000000002','Org B Manager','tasks-b-manager@example.com','Project Manager','active');

insert into projects (id, org_id, code, name, status) values
  ('00910000-0000-0000-0000-000000000010','00910000-0000-0000-0000-000000000001','CUA-A','Externally Owned Project','Ongoing Project'),
  ('00910000-0000-0000-0000-000000000020','00910000-0000-0000-0000-000000000002','CUA-B','PMO Owned Project','Ongoing Project');

insert into project_milestones (id, org_id, project_id, name, sort_order) values
  ('00910000-0000-0000-0000-000000000011','00910000-0000-0000-0000-000000000001','00910000-0000-0000-0000-000000000010','Org A Milestone',1),
  ('00910000-0000-0000-0000-000000000021','00910000-0000-0000-0000-000000000002','00910000-0000-0000-0000-000000000020','Org B Milestone',1);

reset role;
insert into tasks (id, org_id, project_id, name, status, assignee_id, start_date, end_date) values
  ('00910000-0000-0000-0000-000000000101','00910000-0000-0000-0000-000000000001','00910000-0000-0000-0000-000000000010','Mirrored Task A','To Do','00910000-0000-0000-0000-0000000000a2','2026-07-10','2026-07-12'),
  ('00910000-0000-0000-0000-000000000102','00910000-0000-0000-0000-000000000001','00910000-0000-0000-0000-000000000010','Dependency Target A','To Do','00910000-0000-0000-0000-0000000000a2','2026-07-11','2026-07-13'),
  ('00910000-0000-0000-0000-000000000201','00910000-0000-0000-0000-000000000002','00910000-0000-0000-0000-000000000020','Native Task B','To Do','00910000-0000-0000-0000-0000000000b1','2026-07-10','2026-07-12');
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00910000-0000-0000-0000-000000000001','clickup','tasks');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00910000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into tasks (org_id, project_id, name, status)
     values ('00910000-0000-0000-0000-000000000001','00910000-0000-0000-0000-000000000010','Denied Insert A','To Do') $$,
  '42501', null,
  'AC-CUA-020 user-JWT INSERT denied while tasks externally-owned');
select throws_ok(
  $$ update tasks set name = 'Denied Rename A' where id = '00910000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'AC-CUA-020 user-JWT UPDATE of a native field denied while tasks externally-owned');
with d as (
  delete from tasks where id = '00910000-0000-0000-0000-000000000101'
  returning 1
)
select is(
  (select count(*)::int from d),
  0,
  'AC-CUA-020 user-JWT DELETE denied while tasks externally-owned (RLS row-hiding no-op)');
select lives_ok(
  $$ update tasks set milestone_id = '00910000-0000-0000-0000-000000000011' where id = '00910000-0000-0000-0000-000000000101' $$,
  'AC-CUA-021 manager milestone-only UPDATE lives while tasks externally-owned');
select throws_ok(
  $$ update tasks set name = 'Denied Manager Rename A' where id = '00910000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'AC-CUA-021 manager native-field UPDATE denied while tasks externally-owned');
select throws_ok(
  $$ update tasks set description = 'Denied Manager Description A' where id = '00910000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'AC-TM-016 manager description UPDATE denied while tasks externally-owned (ClickUp-owned field)');
select throws_ok(
  $$ update tasks set priority = 'Urgent' where id = '00910000-0000-0000-0000-000000000101' $$,
  '42501', null,
  'AC-TM-017 manager priority UPDATE denied while tasks externally-owned (ClickUp-owned field)');
select lives_ok(
  $$ insert into task_dependencies (task_id, depends_on_id, org_id)
     values ('00910000-0000-0000-0000-000000000101','00910000-0000-0000-0000-000000000102','00910000-0000-0000-0000-000000000001') $$,
  'AC-CUA-021 task dependency insert remains writable while tasks externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update tasks
        set name = 'Mirrored Task A (service)', start_date = '2026-07-14', end_date = '2026-07-15'
      where id = '00910000-0000-0000-0000-000000000101' $$,
  'AC-CUA-020 service-role native-field UPDATE lives for flipped org');
select lives_ok(
  $$ insert into tasks (id, org_id, project_id, name, status)
       values ('00910000-0000-0000-0000-000000000103','00910000-0000-0000-0000-000000000001','00910000-0000-0000-0000-000000000010','Mirror Insert A','To Do') $$,
  'AC-CUA-020 service-role INSERT lives for flipped org');
select lives_ok(
  $$ delete from tasks where id = '00910000-0000-0000-0000-000000000103' $$,
  'AC-CUA-020 service-role DELETE lives for flipped org');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00910000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select lives_ok(
  $$ update tasks set name = 'Native Task B Updated' where id = '00910000-0000-0000-0000-000000000201' $$,
  'AC-CUA-023 org-B manager native-field UPDATE lives while not externally-owned');
select lives_ok(
  $$ insert into tasks (id, org_id, project_id, name, status)
       values ('00910000-0000-0000-0000-000000000202','00910000-0000-0000-0000-000000000002','00910000-0000-0000-0000-000000000020','Native Insert B','To Do') $$,
  'AC-CUA-023 org-B manager INSERT lives while not externally-owned');
select lives_ok(
  $$ delete from tasks where id = '00910000-0000-0000-0000-000000000202' $$,
  'AC-CUA-023 org-B manager DELETE lives while not externally-owned');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
delete from external_domain_ownership
 where org_id = '00910000-0000-0000-0000-000000000001' and external_tier = 'clickup' and domain = 'tasks';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00910000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update tasks set name = 'Restored Manager Rename A' where id = '00910000-0000-0000-0000-000000000101' $$,
  'AC-CUA-022 manager native-field UPDATE lives again after releasing external ownership');

reset role;
select is(
  (select name from tasks where id = '00910000-0000-0000-0000-000000000101'),
  'Restored Manager Rename A',
  'AC-CUA-022 released org persisted the manager native-field UPDATE');
select is(
  (select milestone_id::text from tasks where id = '00910000-0000-0000-0000-000000000101'),
  '00910000-0000-0000-0000-000000000011',
  'AC-CUA-022 released org update left unrelated enhancement columns unchanged');

select finish();
rollback;
