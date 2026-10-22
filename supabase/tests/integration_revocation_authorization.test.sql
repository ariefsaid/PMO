begin;
select plan(14);

insert into organizations (id, name) values
  ('34100000-0000-0000-0000-000000000001', 'Revocation test org');
insert into auth.users (id) values
  ('34100000-0000-0000-0000-000000000011'),
  ('34100000-0000-0000-0000-000000000012'),
  ('34100000-0000-0000-0000-000000000013'),
  ('34100000-0000-0000-0000-000000000014');
update auth.users set banned_until = now() + interval '1 day'
where id = '34100000-0000-0000-0000-000000000013';
insert into profiles (id, org_id, full_name, email, role, status) values
  ('34100000-0000-0000-0000-000000000011', '34100000-0000-0000-0000-000000000001', 'Active fixture', 'fixture-active@example.invalid', 'Admin', 'active'),
  ('34100000-0000-0000-0000-000000000012', '34100000-0000-0000-0000-000000000001', 'Inactive fixture', 'fixture-inactive@example.invalid', 'Admin', 'disabled'),
  ('34100000-0000-0000-0000-000000000013', '34100000-0000-0000-0000-000000000001', 'Banned fixture', 'fixture-banned@example.invalid', 'Admin', 'active'),
  ('34100000-0000-0000-0000-000000000014', '34100000-0000-0000-0000-000000000001', 'Member fixture', 'fixture-member@example.invalid', 'Project Manager', 'active');
insert into projects(id,org_id,name,status,project_manager_id) values
  ('34100000-0000-0000-0000-000000000021','34100000-0000-0000-0000-000000000001','Revocation project','Ongoing Project','34100000-0000-0000-0000-000000000014');
insert into external_org_bindings (org_id, external_tier, site_url, status, secret_ref)
values ('34100000-0000-0000-0000-000000000001', 'clickup', 'https://integration.example.test', 'active', '');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ select disconnect_external_integration('34100000-0000-0000-0000-000000000001', 'clickup', '34100000-0000-0000-0000-000000000012') $$,
  '42501', null, 'inactive actor cannot revoke a connection');
select throws_ok(
  $$ select unlink_external_integration('34100000-0000-0000-0000-000000000001', 'erpnext', null, '34100000-0000-0000-0000-000000000012') $$,
  '42501', null, 'inactive actor cannot unlink a connection');
select is((select status from external_org_bindings where org_id='34100000-0000-0000-0000-000000000001'), 'active', 'denied disconnect leaves binding active');
select is((select count(*)::int from external_project_bindings where org_id='34100000-0000-0000-0000-000000000001'), 0, 'denied unlink leaves bindings unchanged');
select throws_ok(
  $$ select disconnect_external_integration('34100000-0000-0000-0000-000000000001', 'clickup', '34100000-0000-0000-0000-000000000014') $$,
  '42501', null, 'disconnect requires an authorized actor');
select throws_ok(
  $$ select unlink_external_integration('34100000-0000-0000-0000-000000000001', 'erpnext', null, '34100000-0000-0000-0000-000000000014') $$,
  '42501', null, 'unlink requires an authorized actor');
select throws_ok(
  $$ select disconnect_external_integration('34100000-0000-0000-0000-000000000001', 'clickup', '34100000-0000-0000-0000-000000000013') $$,
  '42501', null, 'banned actor cannot revoke a connection');
select ok(not has_function_privilege('service_role', 'delete_vault_secret(text)', 'EXECUTE'), 'direct Vault deletion is not granted to service_role');
reset role;

select vault.create_secret('disconnect-token','341_disconnect_secret');
update external_org_bindings set secret_ref='341_disconnect_secret'
 where org_id='34100000-0000-0000-0000-000000000001' and external_tier='clickup';
insert into external_domain_ownership(org_id,external_tier,domain,created_by)
 values ('34100000-0000-0000-0000-000000000001','clickup','tasks','34100000-0000-0000-0000-000000000011');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(disconnect_external_integration('34100000-0000-0000-0000-000000000001','clickup','34100000-0000-0000-0000-000000000011'),1,'AC-SEC-341 Admin disconnect updates the binding');
select is((select status from external_org_bindings where org_id='34100000-0000-0000-0000-000000000001' and external_tier='clickup'),'disconnected','AC-SEC-341 disconnect marks the binding disconnected');
select is((select count(*)::int from vault.secrets where name='341_disconnect_secret'),0,'AC-SEC-341 disconnect removes the bound secret');
select is((select count(*)::int from external_domain_ownership where org_id='34100000-0000-0000-0000-000000000001' and external_tier='clickup' and domain='tasks'),0,'AC-SEC-341 disconnect releases domain ownership');
insert into external_project_bindings(org_id,project_id,external_tier,external_container_id)
 values ('34100000-0000-0000-0000-000000000001','34100000-0000-0000-0000-000000000021','clickup','container-341');
select is(unlink_external_integration('34100000-0000-0000-0000-000000000001','clickup','34100000-0000-0000-0000-000000000021','34100000-0000-0000-0000-000000000014'),1,'AC-SEC-341 permitted project manager unlinks a seeded binding');
select ok((select disconnected_at is not null from external_project_bindings where project_id='34100000-0000-0000-0000-000000000021'),'AC-SEC-341 unlink records disconnection on the seeded binding');
reset role;
select * from finish();
rollback;
