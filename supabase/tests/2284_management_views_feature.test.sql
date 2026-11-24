-- AC-MV-007: management views resolve off for existing organisations until their own switch is enabled.
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name) values
  ('22840000-0000-0000-0000-000000000001', 'Management views default org'),
  ('22840000-0000-0000-0000-000000000002', 'Management views opted-in org');
insert into auth.users (id, email) values
  ('22840000-0000-0000-0000-0000000000a1', 'management-default@example.invalid'),
  ('22840000-0000-0000-0000-0000000000a2', 'management-opted-in@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22840000-0000-0000-0000-0000000000a1', '22840000-0000-0000-0000-000000000001', 'Management views default', 'management-default@example.invalid', 'Admin', 'active'),
  ('22840000-0000-0000-0000-0000000000a2', '22840000-0000-0000-0000-000000000002', 'Management views opted in', 'management-opted-in@example.invalid', 'Finance', 'active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select management_views_enabled from public.organizations where id = public.auth_org_id()), false,
  'AC-MV-007 management views default off');
select lives_ok('update public.organizations set management_views_enabled = true where id = public.auth_org_id()',
  'AC-MV-007 an Admin can enable the setting');
select is((select management_views_enabled from public.organizations where id = public.auth_org_id()), true,
  'AC-MV-007 the enabled setting is readable');
set local request.jwt.claims = '{"sub":"22840000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select management_views_enabled from public.organizations where id = public.auth_org_id()), false,
  'AC-MV-007 another organisation remains off');
select lives_ok('update public.organizations set management_views_enabled = true where id = public.auth_org_id()',
  'AC-MV-007 a non-Admin update is filtered');
select is((select management_views_enabled from public.organizations where id = public.auth_org_id()), false,
  'AC-MV-007 a non-Admin cannot enable the setting');
reset role;
select * from finish();
rollback;
