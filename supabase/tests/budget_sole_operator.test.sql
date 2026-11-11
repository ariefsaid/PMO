-- AC-1050-01..06: the sole active org member may activate their own budget; the exception
-- is scoped to active membership in that org and never changes the no-drafter role rule.
begin;
create extension if not exists pgtap;
select plan(21);

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

-- An active-status profile with a future auth ban is excluded; removing the ban makes it count.
reset role;
update public.profiles set status='active' where id='a1050000-0000-0000-0000-0000000000a2';
update auth.users set banned_until = now() + interval '1 day' where id='a1050000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000002'), 'sole_operator',
  'AC-1050-03: active-status member with a future ban does not count');
reset role;
update auth.users set banned_until = null where id='a1050000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000002'), 'blocked_editor',
  'AC-1050-03: the same active member counts once unbanned');
reset role;
update public.profiles set status='disabled' where id='a1050000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';

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
-- A legacy draft without a drafter remains subject to the role guard even for its sole editor.
reset role;
set local request.jwt.claims = '{}';
update public.profiles set status='disabled' where id='a1050000-0000-0000-0000-0000000000a2';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000006','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',6,'Legacy editor','Draft');
insert into budget_version_editors (org_id,budget_version_id,user_id)
 values ('a1050000-0000-0000-0000-000000000001','a1052222-0000-0000-0000-000000000006','a1050000-0000-0000-0000-0000000000a1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000006'), 'blocked_no_drafter', 'legacy sole PM editor is blocked');
select throws_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000006') $$, '42501', 'a budget version with no recorded drafter can be activated by Admin or Finance only', 'legacy sole PM editor cannot activate');
reset role;
update public.profiles set role='Executive' where id='a1050000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000006'), 'blocked_no_drafter', 'legacy sole Executive editor is blocked');
select throws_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000006') $$, '42501', 'a budget version with no recorded drafter can be activated by Admin or Finance only', 'legacy sole Executive editor cannot activate');
reset role;
update public.profiles set role='Admin' where id='a1050000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000006'), 'sole_operator', 'legacy sole Admin editor is eligible');
select lives_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000006') $$, 'legacy sole Admin editor can activate');
reset role;
update public.profiles set role='Finance' where id='a1050000-0000-0000-0000-0000000000a1';
set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1052222-0000-0000-0000-000000000007','a1050000-0000-0000-0000-000000000001','a1051111-0000-0000-0000-000000000001',7,'Legacy finance','Draft');
insert into budget_version_editors (org_id,budget_version_id,user_id)
 values ('a1050000-0000-0000-0000-000000000001','a1052222-0000-0000-0000-000000000007','a1050000-0000-0000-0000-0000000000a1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.budget_activation_mode('a1052222-0000-0000-0000-000000000007'), 'sole_operator', 'legacy sole Finance editor is eligible');
select lives_ok($$ select public.activate_budget_version('a1052222-0000-0000-0000-000000000007') $$, 'legacy sole Finance editor can activate');

reset role;
select ok(not has_function_privilege('anon','public.budget_activation_mode(uuid)','EXECUTE')
          and not has_function_privilege('anon','public.activate_budget_version(uuid)','EXECUTE'),
  'AC-1050-06: anon cannot execute the mode helper or activation RPC');
select ok(not has_column_privilege('authenticated','public.budget_versions','activation_basis','INSERT')
          and not has_column_privilege('authenticated','public.budget_versions','activation_basis','UPDATE'),
  'AC-1050-06: clients cannot forge the activation-basis record');
select * from finish();
rollback;
