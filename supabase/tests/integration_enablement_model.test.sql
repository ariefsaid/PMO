-- Integration enablement project-ownership proofs.
-- The fixture deliberately employs ClickUp at org level but binds only project A.
begin;
select plan(17);

-- AC-IEM-010/011/012 mixed-mode fixture and AC-CUA-102 mirror path.
insert into organizations (id, name) values
  ('1e010000-0000-0000-0000-000000000001', 'IEM project ownership org');
insert into auth.users (id, email) values
  ('1e010000-0000-0000-0000-0000000000a1', 'iem-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('1e010000-0000-0000-0000-0000000000a1', '1e010000-0000-0000-0000-000000000001',
   'IEM PM', 'iem-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status) values
  ('1e010000-0000-0000-0000-00000000000a', '1e010000-0000-0000-0000-000000000001', 'IEM-A', 'Bound', 'Ongoing Project'),
  ('1e010000-0000-0000-0000-00000000000b', '1e010000-0000-0000-0000-000000000001', 'IEM-B', 'Unbound', 'Ongoing Project'),
  ('1e010000-0000-0000-0000-00000000000c', '1e010000-0000-0000-0000-000000000001', 'IEM-C', 'Created after employ', 'Leads');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into external_domain_ownership (org_id, external_tier, domain)
values ('1e010000-0000-0000-0000-000000000001', 'clickup', 'tasks');
insert into external_project_bindings
  (id, org_id, project_id, external_tier, external_container_id, linked_at)
values
  ('1e010000-0000-0000-0000-000000000101', '1e010000-0000-0000-0000-000000000001',
   '1e010000-0000-0000-0000-00000000000a', 'clickup', 'list-a', now());
insert into tasks (id, org_id, project_id, name, status)
values
  ('1e010000-0000-0000-0000-0000000000a0', '1e010000-0000-0000-0000-000000000001',
   '1e010000-0000-0000-0000-00000000000a', 'Mirrored task', 'To Do');

select is(public.project_domain_externally_owned('1e010000-0000-0000-0000-00000000000a', 'tasks'), true,
  'AC-IEM-010 bound project is externally owned');
select is(public.project_domain_externally_owned('1e010000-0000-0000-0000-00000000000b', 'tasks'), false,
  'AC-IEM-010 unbound project remains PMO-owned');
select is(public.project_domain_externally_owned('1e010000-0000-0000-0000-00000000000c', 'tasks'), false,
  'AC-IEM-011 newly created project is PMO-owned');

set local role authenticated;
set local request.jwt.claims = '{"sub":"1e010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into tasks (id, org_id, project_id, name, status)
  values ('1e010000-0000-0000-0000-0000000000b0', '1e010000-0000-0000-0000-000000000001',
          '1e010000-0000-0000-0000-00000000000b', 'Native B', 'To Do')$$,
  'AC-IEM-010 PM can insert a task in an unbound project');
select lives_ok($$update tasks set name = 'Native B updated'
  where id = '1e010000-0000-0000-0000-0000000000b0'$$,
  'AC-IEM-010 PM can edit a task in an unbound project');
select lives_ok($$delete from tasks where id = '1e010000-0000-0000-0000-0000000000b0'$$,
  'AC-IEM-010 PM can delete a task in an unbound project');
select throws_ok($$update tasks set name = 'Must remain mirrored'
  where id = '1e010000-0000-0000-0000-0000000000a0'$$,
  '42501', null, 'AC-IEM-010 PM cannot edit a task in a bound project');

select lives_ok($$insert into tasks (id, org_id, project_id, name, status)
  values ('1e010000-0000-0000-0000-0000000000c0', '1e010000-0000-0000-0000-000000000001',
          '1e010000-0000-0000-0000-00000000000c', 'Native C', 'To Do')$$,
  'AC-IEM-011 PM can insert a task in a newly created project');
select lives_ok($$update tasks set name = 'Native C updated'
  where id = '1e010000-0000-0000-0000-0000000000c0'$$,
  'AC-IEM-011 PM can edit a task in a newly created project');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update tasks set name = 'Mirrored task from ClickUp'
  where id = '1e010000-0000-0000-0000-0000000000a0'$$,
  'AC-CUA-102 service-role mirror write remains available for a bound project');
select is((select name from tasks where id = '1e010000-0000-0000-0000-0000000000a0'),
  'Mirrored task from ClickUp', 'AC-CUA-102 mirrored task update was persisted');

update external_project_bindings set disconnected_at = now()
where id = '1e010000-0000-0000-0000-000000000101';
set local role authenticated;
set local request.jwt.claims = '{"sub":"1e010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update tasks set name = 'PMO-owned after unlink'
  where id = '1e010000-0000-0000-0000-0000000000a0'$$,
  'AC-IEM-012 unlinked project task is editable again');
select ok((select count(*) from tasks where id = '1e010000-0000-0000-0000-0000000000a0') = 1,
  'AC-IEM-012 unlink retains the mirrored task row');

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into external_domain_ownership (org_id, external_tier, domain)
values ('1e010000-0000-0000-0000-000000000001', 'erpnext', 'companies');
select is(public.domain_externally_owned('1e010000-0000-0000-0000-000000000001', 'companies'), true,
  'AC-CUA-103 org-level ownership remains unchanged for a non-task domain');
select is(public.domain_externally_owned('1e010000-0000-0000-0000-000000000001', 'tasks'), true,
  'AC-CUA-103 org-level task employment remains recorded independently of project ownership');

select has_function('public', 'project_domain_externally_owned', array['uuid', 'text'],
  'AC-IEM-010 project-aware predicate exists');
select ok((select pg_get_functiondef('public.project_domain_externally_owned(uuid,text)'::regprocedure)
  like '%external_project_bindings%'), 'AC-IEM-010 predicate derives ownership from project bindings');
select finish();
rollback;
