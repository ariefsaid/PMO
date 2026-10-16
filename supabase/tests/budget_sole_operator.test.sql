-- AC-1050-01..06: the sole active org member may activate their own budget; the exception
-- is scoped to active membership in that org and never changes the no-drafter role rule.
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name) values
  ('a1050000-0000-0000-0000-000000000001','Sole Operator Org'),
  ('a1050000-0000-0000-0000-000000000002','Other Org');
insert into auth.users (id, email) values
  ('a1050000-0000-0000-0000-0000000000a1','sole@example.com'),
  ('a1050000-0000-0000-0000-0000000000a2','second@example.com'),
  ('a1050000-0000-0000-0000-0000000000a3','other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1050000-0000-0000-0000-0000000000a1','a1050000-0000-0000-0000-000000000001','Solo','sole@example.com','Project Manager','active'),
  ('a1050000-0000-0000-0000-0000000000a2','a1050000-0000-0000-0000-000000000001','Second','second@example.com','Project Manager','disabled'),
  ('a1050000-0000-0000-0000-0000000000a3','a1050000-0000-0000-0000-000000000002','Other','other@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('a1051111-0000-0000-0000-000000000001','a1050000-0000-0000-0000-000000000001','Solo Project','Ongoing Project');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000001','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',1,'Solo draft','Draft');
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000001'), 'sole_operator',
  'AC-1050-01: the sole active member is told the own-draft exception applies');
select lives_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000001') $$,
  'AC-1050-01: sole active member activates their own draft');
select is((select activation_basis from public.budget_versions where id='a1052222-0000-0000-0000-000000000001'), 'sole_operator',
  'AC-1050-01: sole-operator activation is recorded on the version');

-- An inactive additional profile does not change the membership denominator.
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000002','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',2,'Second draft','Draft');
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000002'), 'sole_operator',
  'AC-1050-03: an inactive second member does not count');
select lives_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000002') $$,
  'AC-1050-03: activation remains available with an inactive second profile');

-- A member belonging to a different organization is irrelevant.
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000003','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',3,'Other org member','Draft');
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000003'), 'sole_operator',
  'AC-1050-04: active members of another org do not count');

-- A second active member disables the exception and preserves the exact legacy editor message.
reset role;
update public.profiles set status='active' where id='a1050000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000004','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',4,'Two members','Draft');
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000004'), 'blocked_editor',
  'AC-1050-02: a second active member disables the exception');
select throws_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000004') $$,
  '42501','separation of duties: You edited this version, so someone else must activate it.',
  'AC-1050-02: with two active members the unchanged editor refusal applies');

reset role;
set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000005','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',5,'No drafter','Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000005') $$,
  '42501','a budget version with no recorded drafter can be activated by Admin or Finance only',
  'AC-1050-05: the sole-operator exception does not alter the no-drafter rule');
reset role;
select ok(not has_function_privilege('anon','public.budget_activation_mode(uuid)','EXECUTE')
          and not has_function_privilege('anon','public.activate_budget_version(uuid)','EXECUTE'),
  'AC-1050-06: anon cannot execute the mode helper or activation RPC');
select ok(not has_column_privilege('authenticated','public.budget_versions','activation_basis','INSERT')
          and not has_column_privilege('authenticated','public.budget_versions','activation_basis','UPDATE'),
  'AC-1050-06: clients cannot forge the activation-basis record');
select * from finish();
rollback;
