-- tasks_parent_external_owned_rls.test.sql
-- AC-CUA-092/093/094/095 [pgTAP]: tasks.parent_task_id writes under external ownership (OD-INT-9
-- parent<->parent_task_id sync, migration 0140).
--
-- The ClickUp mirror writer (service_role) MUST be able to persist an inbound ClickUp `parent` as
-- tasks.parent_task_id on an externally-owned org — that is the whole reason the sync exists. A normal
-- authenticated user (any role, here a Project Manager) MUST NOT — the 0093 column-pin trigger
-- (enforce_assignee_status_only) treats parent_task_id as a ClickUp-owned native field (0140 extended
-- the pinned list) and raises 42501 on any change while tasks are externally-owned. And the
-- service_role bypass of the column-pin is NARROW: it does NOT also bypass the 0140 same-project
-- trigger (cross-project parent -> 42501) or the 0140 self-parent CHECK (parent_task_id = id -> 23514).
--
-- Reuses the fixture + role-switching harness established by tasks_external_owned_rls.test.sql and
-- task_model_fields.test.sql. Runs as the superuser with `request.jwt.claims` set per branch, exactly
-- like those files (RLS is bypassed by the superuser; the column-pin trigger reads the JWT claim).
begin;
select plan(5);

insert into organizations (id, name) values
  ('0ae10000-0000-0000-0000-000000000001','AC-CUA Parent Sync Org (externally-owned tasks)');

insert into auth.users (id, email) values
  ('0ae10000-0000-0000-0000-0000000000a1','parent-sync-manager@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0ae10000-0000-0000-0000-0000000000a1','0ae10000-0000-0000-0000-000000000001','Parent Sync Manager','parent-sync-manager@example.com','Project Manager','active');

insert into projects (id, org_id, code, name, status) values
  ('0ae10000-0000-0000-0000-000000000010','0ae10000-0000-0000-0000-000000000001','CUP-A','Parent Sync Project A','Ongoing Project'),
  ('0ae10000-0000-0000-0000-000000000020','0ae10000-0000-0000-0000-000000000001','CUP-B','Parent Sync Project B','Ongoing Project');

-- Flip the org's `tasks` domain to ClickUp (externally-owned).
insert into external_domain_ownership (org_id, external_tier, domain)
values ('0ae10000-0000-0000-0000-000000000001','clickup','tasks');

-- Seed every task row as the service_role (the mirror writer) — the ONLY role permitted to write
-- tasks while externally-owned. All children start at parent_task_id = null.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into tasks (id, org_id, project_id, name, status) values
  ('0ae10000-0000-0000-0000-000000000101','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000010','Parent in A','To Do'),
  ('0ae10000-0000-0000-0000-000000000201','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000020','Cross-project task in B','To Do'),
  ('0ae10000-0000-0000-0000-000000000102','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000010','Child 1 (service link target)','To Do'),
  ('0ae10000-0000-0000-0000-000000000103','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000010','Child 2 (manager link target)','To Do'),
  ('0ae10000-0000-0000-0000-000000000104','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000010','Child 3 (cross-project link target)','To Do'),
  ('0ae10000-0000-0000-0000-000000000105','0ae10000-0000-0000-0000-000000000001','0ae10000-0000-0000-0000-000000000010','Child 4 (self-parent target)','To Do');

-- AC-CUA-092: service_role CAN set parent_task_id (same-project) while externally-owned.
select lives_ok(
  $$ update tasks set parent_task_id = '0ae10000-0000-0000-0000-000000000101'
       where id = '0ae10000-0000-0000-0000-000000000102' $$,
  'AC-CUA-092: service-role sets parent_task_id (same-project) while externally-owned');
select is(
  (select parent_task_id::text from tasks where id = '0ae10000-0000-0000-0000-000000000102'),
  '0ae10000-0000-0000-0000-000000000101',
  'AC-CUA-092: service-role parent_task_id UPDATE persisted (legitimate mirror write of an inbound parent)');

-- AC-CUA-093: a normal authenticated user (Project Manager) CANNOT set parent_task_id while
-- externally-owned. RLS tasks_update permits the manager; the column-pin trigger then raises 42501
-- because parent_task_id is a ClickUp-owned native field, not an enhancement column.
set local role authenticated;
set local request.jwt.claims = '{"sub":"0ae10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update tasks set parent_task_id = '0ae10000-0000-0000-0000-000000000101'
       where id = '0ae10000-0000-0000-0000-000000000103' $$,
  '42501', null,
  'AC-CUA-093: a Project Manager UPDATE of parent_task_id is denied (column-pin) while externally-owned');

-- AC-CUA-094 / AC-CUA-095: the service_role bypass of the column-pin is NARROW — it does NOT also
-- bypass the 0140 same-project trigger or the self-parent CHECK. Proven with service_role so the
-- column-pin is the branch that returns `new` early (for any other role the column-pin would mask
-- these guards with its own 42501). Same-project trigger fires AFTER the column-pin (trigger name
-- order: tasks_assignee_status_only < tasks_check_parent_same_project) so it still runs.
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ update tasks set parent_task_id = '0ae10000-0000-0000-0000-000000000201'
       where id = '0ae10000-0000-0000-0000-000000000104' $$,
  '42501', null,
  'AC-CUA-094: service-role cross-project parent still refused (same-project trigger) while externally-owned');
select throws_ok(
  $$ update tasks set parent_task_id = id
       where id = '0ae10000-0000-0000-0000-000000000105' $$,
  '23514', null,
  'AC-CUA-095: self-parenting still refused (check constraint) for service-role while externally-owned');

select finish();
rollback;
