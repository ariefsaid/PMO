-- AC-MV-007: management views resolve off for existing organisations until their own switch is enabled.
begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name) values
  ('22840000-0000-0000-0000-000000000001', 'Management views default org'),
  ('22840000-0000-0000-0000-000000000002', 'Management views opted-in org');
insert into auth.users (id, email) values
  ('22840000-0000-0000-0000-0000000000a1', 'management-default@example.invalid'),
  ('22840000-0000-0000-0000-0000000000a2', 'management-opted-in@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22840000-0000-0000-0000-0000000000a1', '22840000-0000-0000-0000-000000000001', 'Management views default', 'management-default@example.invalid', 'Finance', 'active'),
  ('22840000-0000-0000-0000-0000000000a2', '22840000-0000-0000-0000-000000000002', 'Management views opted in', 'management-opted-in@example.invalid', 'Finance', 'active');
insert into public.org_features (org_id, feature_key, enabled) values
  ('22840000-0000-0000-0000-000000000002', 'management_views', true);

select is((select count(*)::int from public.plan_features where feature_key = 'management_views' and not enabled), 4,
  'AC-MV-007 every existing plan defaults management views off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select enabled from public.resolved_org_features() where feature_key = 'management_views'), false,
  'AC-MV-007 an existing organisation without an override resolves management views off');
select is((select source from public.resolved_org_features() where feature_key = 'management_views'), 'plan'::text,
  'AC-MV-007 the default-off decision comes from its plan');
set local request.jwt.claims = '{"sub":"22840000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select enabled from public.resolved_org_features() where feature_key = 'management_views'), true,
  'AC-MV-007 an organisation-specific override can opt in');
select is(public.org_feature_enabled(public.auth_org_id(), 'management_views'), true,
  'AC-MV-007 the server feature resolver reports the enabled organisation switch');
reset role;
select * from finish();
rollback;
