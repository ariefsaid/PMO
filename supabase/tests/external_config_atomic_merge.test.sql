-- MEDIUM-4: atomic jsonb config patching preserves sibling keys when writers interleave.
begin;
select plan(6);

insert into organizations (id, name) values
  ('13800000-0000-0000-0000-000000000001', 'Atomic config merge org');
insert into projects (id, org_id, name) values
  ('13800000-0000-0000-0000-000000000001', '13800000-0000-0000-0000-000000000001', 'Atomic config project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config)
values ('13800000-0000-0000-0000-000000000001', 'clickup', 'https://clickup.example', 'vault-ref',
        '{"statusMap":{"open":"To Do"},"memberMap":{"u1":"user-1"}}'::jsonb);
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
values ('13800000-0000-0000-0000-000000000001', '13800000-0000-0000-0000-000000000001', 'clickup', 'list-atomic',
        '{"statusMap":{"open":"To Do"},"memberMap":{"u1":"user-1"}}'::jsonb);

set local role service_role;

select lives_ok($$ select merge_external_org_binding_config(
  '13800000-0000-0000-0000-000000000001', 'clickup', '{"clickup_actor_id":"actor-1"}'::jsonb) $$,
  'MEDIUM-4: org writer A can atomically patch clickup_actor_id');
select lives_ok($$ select merge_external_org_binding_config(
  '13800000-0000-0000-0000-000000000001', 'clickup', '{"clickup_team_id":"team-1"}'::jsonb) $$,
  'MEDIUM-4: org writer B can atomically patch clickup_team_id');
select is((select config from external_org_bindings where org_id = '13800000-0000-0000-0000-000000000001' and external_tier = 'clickup'),
  '{"statusMap":{"open":"To Do"},"memberMap":{"u1":"user-1"},"clickup_actor_id":"actor-1","clickup_team_id":"team-1"}'::jsonb,
  'MEDIUM-4: interleaved org patches preserve statusMap, memberMap, actor, and team siblings');

select lives_ok($$ select merge_external_project_binding_config(
  '13800000-0000-0000-0000-000000000001', 'clickup', 'list-atomic', '{"unhealthy":true}'::jsonb) $$,
  'MEDIUM-4: project writer A can atomically patch unhealthy');
select lives_ok($$ select merge_external_project_binding_config(
  '13800000-0000-0000-0000-000000000001', 'clickup', 'list-atomic', '{"last_error":"not found"}'::jsonb) $$,
  'MEDIUM-4: project writer B can atomically patch last_error');
select is((select config from external_project_bindings where org_id = '13800000-0000-0000-0000-000000000001' and external_container_id = 'list-atomic'),
  '{"statusMap":{"open":"To Do"},"memberMap":{"u1":"user-1"},"unhealthy":true,"last_error":"not found"}'::jsonb,
  'MEDIUM-4: interleaved project patches preserve statusMap, memberMap, and health siblings');

select * from finish();
rollback;
