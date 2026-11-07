-- AC-1413-01..08: an approver returns a waiting Draft budget version to its authors (migration 0730).
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name) values
  ('a1413000-0000-0000-0000-000000000001','Return Org'),
  ('a1413000-0000-0000-0000-000000000002','Return Other Org');
insert into auth.users (id, email) values
  ('a1413000-0000-0000-0000-0000000000a1','author@example.com'),
  ('a1413000-0000-0000-0000-0000000000a2','approver@example.com'),
  ('a1413000-0000-0000-0000-0000000000a3','outsider@example.com'),
  ('a1413000-0000-0000-0000-0000000000a4','engineer@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1413000-0000-0000-0000-0000000000a1','a1413000-0000-0000-0000-000000000001','Author','author@example.com','Project Manager','active'),
  ('a1413000-0000-0000-0000-0000000000a2','a1413000-0000-0000-0000-000000000001','Approver','approver@example.com','Finance','active'),
  ('a1413000-0000-0000-0000-0000000000a3','a1413000-0000-0000-0000-000000000002','Outsider','outsider@example.com','Finance','active'),
  ('a1413000-0000-0000-0000-0000000000a4','a1413000-0000-0000-0000-000000000001','Engineer','engineer@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('a1413111-0000-0000-0000-000000000001','a1413000-0000-0000-0000-000000000001','Return Project','Ongoing Project');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status)
 values ('a1413222-0000-0000-0000-000000000001','a1413000-0000-0000-0000-000000000001','a1413111-0000-0000-0000-000000000001',1,'Return draft','Draft');

select throws_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','too high') $$,
  '42501', 'separation of duties: You edited this version, so someone else must return it.',
  'AC-1413-01: the drafter/editor cannot return their own version');

set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','too high') $$,
  '42501', 'not authorized', 'AC-1413-02: a role outside the activation gate cannot return');

set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','too high') $$,
  '42501', 'not authorized', 'AC-1413-03: another org cannot return');

set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','   ') $$,
  '22023', 'a reason is required', 'AC-1413-04: a blank reason is refused');
select lives_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','  Contingency too high ') $$,
  'AC-1413-05: a different approver returns the draft');
select is((select status::text from budget_versions where id='a1413222-0000-0000-0000-000000000001'), 'Draft',
  'AC-1413-05: the version stays an editable Draft');
select results_eq($$ select return_reason, returned_by, returned_at is not null from budget_versions where id='a1413222-0000-0000-0000-000000000001' $$,
  $$ values ('Contingency too high'::text, 'a1413000-0000-0000-0000-0000000000a2'::uuid, true) $$,
  'AC-1413-05: reason (trimmed), who and when are recorded');
select throws_ok($$ select public.return_budget_version('a1413222-0000-0000-0000-000000000001','again') $$,
  'P0001', 'this version has already been returned', 'AC-1413-05: a returned version cannot be returned twice');
select throws_ok($$ select public.activate_budget_version('a1413222-0000-0000-0000-000000000001') $$,
  'P0001', 'this version was returned to its authors; it must be resubmitted before activation',
  'AC-1413-06: a returned draft cannot be activated');

set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.resubmit_budget_version('a1413222-0000-0000-0000-000000000001') $$,
  'AC-1413-07: the author resubmits after the return');
select results_eq($$ select returned_at is null and returned_by is null and return_reason is null from budget_versions where id='a1413222-0000-0000-0000-000000000001' $$,
  $$ values (true) $$, 'AC-1413-07: resubmit clears the waiting-return state');
select throws_ok($$ select public.resubmit_budget_version('a1413222-0000-0000-0000-000000000001') $$,
  'P0001', 'only a returned Draft version can be resubmitted', 'AC-1413-07: resubmit needs a returned draft');
set local request.jwt.claims = '{"sub":"a1413000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.activate_budget_version('a1413222-0000-0000-0000-000000000001') $$,
  'AC-1413-07: the approver can activate after resubmission');

reset role;
select ok(not has_function_privilege('anon','public.return_budget_version(uuid,text)','EXECUTE')
      and not has_function_privilege('anon','public.resubmit_budget_version(uuid)','EXECUTE')
      and not has_column_privilege('authenticated','public.budget_versions','return_reason','UPDATE'),
  'AC-1413-08: anon cannot execute; clients cannot write the return columns');
select * from finish();
rollback;
