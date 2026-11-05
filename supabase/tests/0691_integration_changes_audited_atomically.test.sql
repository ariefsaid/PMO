begin;
select plan(21);

insert into organizations (id, name) values ('68900000-0000-0000-0000-000000000001', 'Audit atomicity org');
insert into auth.users (id) values ('68900000-0000-0000-0000-000000000011');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('68900000-0000-0000-0000-000000000011', '68900000-0000-0000-0000-000000000001', 'Admin fixture', 'fixture-admin@example.invalid', 'Admin', 'active');
insert into projects(id, org_id, name, status) values
  ('68900000-0000-0000-0000-000000000021', '68900000-0000-0000-0000-000000000001', 'Audit project', 'Ongoing Project'),
  ('68900000-0000-0000-0000-000000000022', '68900000-0000-0000-0000-000000000001', 'Audit project two', 'Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, status, secret_ref)
values ('68900000-0000-0000-0000-000000000001', 'clickup', 'https://integration.example.test', 'active', '');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ select link_external_project_audited('68900000-0000-0000-0000-000000000001', '68900000-0000-0000-0000-000000000011', '68900000-0000-0000-0000-000000000021', 'list-689', '{"direction":"two-way"}') $$,
  'link succeeds');
reset role;
select is((select count(*)::int from audit_events where org_id='68900000-0000-0000-0000-000000000001' and action='integration.link' and detail->>'list_id'='list-689'),
  1, 'link writes exactly one audit event with the change');
select is((select entity_id from audit_events where action='integration.link' and org_id='68900000-0000-0000-0000-000000000001'),
  (select id from external_project_bindings where project_id='68900000-0000-0000-0000-000000000021'), 'audit event names the new binding');

-- fixtures for the refusal cases: a second org, a Finance user (no tier role), an active ERP binding
insert into organizations (id, name) values ('68900000-0000-0000-0000-000000000002', 'Audit other org');
insert into auth.users (id) values ('68900000-0000-0000-0000-000000000012');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('68900000-0000-0000-0000-000000000012', '68900000-0000-0000-0000-000000000001', 'Finance fixture', 'fixture-finance@example.invalid', 'Finance', 'active');
insert into external_org_bindings (org_id, external_tier, site_url, status, secret_ref, config)
values ('68900000-0000-0000-0000-000000000001', 'erpnext', 'https://erp.example.test', 'active', '', '{"company":"ACME"}');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(unlink_external_integration_audited('68900000-0000-0000-0000-000000000001', 'clickup', '68900000-0000-0000-0000-000000000021', '68900000-0000-0000-0000-000000000011'),
  1, 'unlink succeeds');
reset role;
select is((select count(*)::int from audit_events where org_id='68900000-0000-0000-0000-000000000001' and action='integration.unlink' and detail->>'list_id'='list-689'),
  1, 'unlink writes one audit event carrying the list');

-- Refusals: wrong org and wrong role are refused THROUGH each wrapper, and nothing is written.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$ select link_external_project_audited('68900000-0000-0000-0000-000000000002', '68900000-0000-0000-0000-000000000011', '68900000-0000-0000-0000-000000000022', 'list-x', '{}') $$,
  '42501', null, 'link: an actor of another org is refused');
select throws_ok($$ select link_external_project_audited('68900000-0000-0000-0000-000000000001', '68900000-0000-0000-0000-000000000012', '68900000-0000-0000-0000-000000000022', 'list-x', '{}') $$,
  '42501', null, 'link: a role without permission is refused');
select throws_ok($$ select unlink_external_integration_audited('68900000-0000-0000-0000-000000000002', 'erpnext', null, '68900000-0000-0000-0000-000000000011') $$,
  '42501', null, 'unlink: an actor of another org is refused');
select throws_ok($$ select unlink_external_integration_audited('68900000-0000-0000-0000-000000000001', 'erpnext', null, '68900000-0000-0000-0000-000000000012') $$,
  '42501', null, 'unlink: a role without permission is refused');
select throws_ok($$ select disconnect_external_integration_audited('68900000-0000-0000-0000-000000000002', 'erpnext', '68900000-0000-0000-0000-000000000011') $$,
  '42501', null, 'disconnect: an actor of another org is refused');
select throws_ok($$ select disconnect_external_integration_audited('68900000-0000-0000-0000-000000000001', 'erpnext', '68900000-0000-0000-0000-000000000012') $$,
  '42501', null, 'disconnect: a role without permission is refused');
-- activation has no actor check of its own (the edge fn gates Admin); the org is still enforced
select throws_ok($$ select activate_external_binding_audited('68900000-0000-0000-0000-000000000002', 'erpnext', 16, 'ACME', '{}', '68900000-0000-0000-0000-000000000011') $$,
  'P0001', null, 'activate: another org has no binding to activate, refused');
reset role;
select is((select count(*)::int from audit_events where action like 'integration.%' and org_id in ('68900000-0000-0000-0000-000000000001','68900000-0000-0000-0000-000000000002')),
  2, 'refusals wrote no audit row (only the earlier link and unlink)');
select ok((select config->>'company' = 'ACME' and status = 'active' from external_org_bindings where org_id='68900000-0000-0000-0000-000000000001' and external_tier='erpnext')
  and (select status = 'active' and disconnected_at is null from external_org_bindings where org_id='68900000-0000-0000-0000-000000000001' and external_tier='clickup')
  and not exists (select 1 from external_project_bindings where external_container_id = 'list-x'),
  'refusals changed no binding');

-- an authenticated caller cannot call any wrapper
set local role authenticated;
select throws_ok($$ select link_external_project_audited('68900000-0000-0000-0000-000000000001', '68900000-0000-0000-0000-000000000011', '68900000-0000-0000-0000-000000000022', 'list-x', '{}') $$, '42501', null, 'link: authenticated refused');
select throws_ok($$ select unlink_external_integration_audited('68900000-0000-0000-0000-000000000001', 'erpnext', null, '68900000-0000-0000-0000-000000000011') $$, '42501', null, 'unlink: authenticated refused');
select throws_ok($$ select disconnect_external_integration_audited('68900000-0000-0000-0000-000000000001', 'erpnext', '68900000-0000-0000-0000-000000000011') $$, '42501', null, 'disconnect: authenticated refused');
select throws_ok($$ select activate_external_binding_audited('68900000-0000-0000-0000-000000000001', 'erpnext', 16, 'ACME', '{}', '68900000-0000-0000-0000-000000000011') $$, '42501', null, 'activate: authenticated refused');
reset role;

-- A failing audit write rolls the change back.
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit down' using errcode = 'P0001'; end $$;
create trigger zz_fail_audit before insert on audit_events for each row execute function pg_temp.fail_audit();
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$ select link_external_project_audited('68900000-0000-0000-0000-000000000001', '68900000-0000-0000-0000-000000000011', '68900000-0000-0000-0000-000000000022', 'list-689b', '{}') $$,
  'P0001', 'audit down', 'link fails when its audit cannot be written');
select throws_ok(
  $$ select disconnect_external_integration_audited('68900000-0000-0000-0000-000000000001', 'clickup', '68900000-0000-0000-0000-000000000011') $$,
  'P0001', 'audit down', 'disconnect fails when its audit cannot be written');
reset role;
select is((select count(*)::int from external_project_bindings where external_container_id='list-689b'), 0, 'no link row survives the failed audit');

select * from finish();
rollback;
