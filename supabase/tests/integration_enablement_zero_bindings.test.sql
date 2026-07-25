-- AC-IEM-015 [pgTAP]: an employed ClickUp org with zero project bindings is healthy and inert.
begin;
select plan(8);

insert into organizations (id, name) values
  ('1e015000-0000-0000-0000-000000000001', 'IEM zero-binding org');
insert into auth.users (id, email) values
  ('1e015000-0000-0000-0000-0000000000a1', 'iem-zero-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('1e015000-0000-0000-0000-0000000000a1', '1e015000-0000-0000-0000-000000000001',
   'IEM Zero PM', 'iem-zero-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status) values
  ('1e015000-0000-0000-0000-00000000000a', '1e015000-0000-0000-0000-000000000001', 'IEM-Z', 'Native project', 'Ongoing Project');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_at)
values ('1e015000-0000-0000-0000-000000000001', 'clickup', 'https://app.clickup.com', 'iem-zero-secret', 'active', now());
insert into external_domain_ownership (org_id, external_tier, domain)
values ('1e015000-0000-0000-0000-000000000001', 'clickup', 'tasks');
insert into tasks (id, org_id, project_id, name, status)
values ('1e015000-0000-0000-0000-0000000000a0', '1e015000-0000-0000-0000-000000000001',
        '1e015000-0000-0000-0000-00000000000a', 'PMO task', 'To Do');

select is((select status from external_org_bindings
  where org_id = '1e015000-0000-0000-0000-000000000001' and external_tier = 'clickup'),
  'active', 'AC-IEM-015 connected zero-binding tier remains Active');
select is((select count(*)::int from external_project_bindings
  where org_id = '1e015000-0000-0000-0000-000000000001' and external_tier = 'clickup'),
  0, 'AC-IEM-015 no project bindings means no sync work is enumerated');
select is(public.project_domain_externally_owned('1e015000-0000-0000-0000-00000000000a', 'tasks'),
  false, 'AC-IEM-015 no task is ClickUp-owned without a project binding');
select is((select count(*)::int from tasks
  where org_id = '1e015000-0000-0000-0000-000000000001'), 1,
  'AC-IEM-015 the PMO task remains present');

set local role authenticated;
set local request.jwt.claims = '{"sub":"1e015000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update tasks set name = 'PMO task edited' where id = '1e015000-0000-0000-0000-0000000000a0'$$,
  'AC-IEM-015 write-role can edit every task in the zero-binding org');
select is((select name from tasks where id = '1e015000-0000-0000-0000-0000000000a0'), 'PMO task edited',
  'AC-IEM-015 PMO edit persists');
select lives_ok($$delete from tasks where id = '1e015000-0000-0000-0000-0000000000a0'$$,
  'AC-IEM-015 write-role can delete the PMO task');
select is((select count(*)::int from external_project_bindings
  where org_id = '1e015000-0000-0000-0000-000000000001'), 0,
  'AC-IEM-015 no binding is created as a side effect of task writes');

select finish();
rollback;
