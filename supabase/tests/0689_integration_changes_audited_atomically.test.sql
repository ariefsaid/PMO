begin;
select plan(8);

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

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(unlink_external_integration_audited('68900000-0000-0000-0000-000000000001', 'clickup', '68900000-0000-0000-0000-000000000021', '68900000-0000-0000-0000-000000000011'),
  1, 'unlink succeeds');
reset role;
select is((select count(*)::int from audit_events where org_id='68900000-0000-0000-0000-000000000001' and action='integration.unlink' and detail->>'list_id'='list-689'),
  1, 'unlink writes one audit event carrying the list');

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
