-- AC-008 — server authorization, authorship, RLS and the pre-range deployment fence.
begin;
create extension if not exists pgtap;
select plan(38);

insert into organizations (id, name) values
  ('14750000-0000-0000-0000-000000000001', 'Whole Project Roles Org'),
  ('14750000-0000-0000-0000-000000000002', 'Whole Project Other Org'),
  ('14750000-0000-0000-0000-000000000003', 'Whole Project Sole Operator Org');
insert into auth.users (id, email) values
  ('14750000-0000-0000-0000-0000000000a1', 'whole-role-pm@example.com'),
  ('14750000-0000-0000-0000-0000000000a2', 'whole-role-finance@example.com'),
  ('14750000-0000-0000-0000-0000000000a3', 'whole-role-exec@example.com'),
  ('14750000-0000-0000-0000-0000000000a4', 'whole-role-engineer@example.com'),
  ('14750000-0000-0000-0000-0000000000a5', 'whole-role-unprofiled@example.com'),
  ('14750000-0000-0000-0000-0000000000a6', 'whole-role-disabled-finance@example.com'),
  ('14750000-0000-0000-0000-0000000000b1', 'whole-role-other@example.com'),
  ('14750000-0000-0000-0000-0000000000c1', 'whole-role-sole@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('14750000-0000-0000-0000-0000000000a1', '14750000-0000-0000-0000-000000000001', 'Role PM', 'whole-role-pm@example.com', 'Project Manager'),
  ('14750000-0000-0000-0000-0000000000a2', '14750000-0000-0000-0000-000000000001', 'Role Finance', 'whole-role-finance@example.com', 'Finance'),
  ('14750000-0000-0000-0000-0000000000a3', '14750000-0000-0000-0000-000000000001', 'Role Exec', 'whole-role-exec@example.com', 'Executive'),
  ('14750000-0000-0000-0000-0000000000a4', '14750000-0000-0000-0000-000000000001', 'Role Engineer', 'whole-role-engineer@example.com', 'Engineer'),
  ('14750000-0000-0000-0000-0000000000a6', '14750000-0000-0000-0000-000000000001', 'Disabled Finance', 'whole-role-disabled-finance@example.com', 'Finance'),
  ('14750000-0000-0000-0000-0000000000b1', '14750000-0000-0000-0000-000000000002', 'Other PM', 'whole-role-other@example.com', 'Project Manager'),
  ('14750000-0000-0000-0000-0000000000c1', '14750000-0000-0000-0000-000000000003', 'Sole PM', 'whole-role-sole@example.com', 'Project Manager');
update profiles set status = 'disabled' where id = '14750000-0000-0000-0000-0000000000a6';
insert into projects (id, org_id, name, status) values
  ('14751111-0000-0000-0000-000000000001', '14750000-0000-0000-0000-000000000001', 'Whole Roles Project', 'Ongoing Project'),
  ('14751111-0000-0000-0000-000000000002', '14750000-0000-0000-0000-000000000002', 'Other Org Project', 'Ongoing Project'),
  ('14751111-0000-0000-0000-000000000003', '14750000-0000-0000-0000-000000000003', 'Sole Operator Project', 'Ongoing Project');

set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14752222-0000-0000-0000-000000000001', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 1, 'Valid Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a2', 'whole_project'),
  ('14752222-0000-0000-0000-000000000002', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 2, 'Active Whole Version', 'Active', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000003', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 3, 'Archived Whole Version', 'Archived', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000004', '14750000-0000-0000-0000-000000000002', '14751111-0000-0000-0000-000000000002', 1, 'Other Org Draft', 'Draft', '14750000-0000-0000-0000-0000000000b1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000005', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 4, 'Gap Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000006', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 5, 'Annual Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'per_year'),
  ('14752222-0000-0000-0000-000000000007', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 6, 'Phased Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000009', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 7, 'No Drafter Annual Draft', 'Draft', null, 'per_year'),
  ('14752222-0000-0000-0000-000000000008', '14750000-0000-0000-0000-000000000003', '14751111-0000-0000-0000-000000000003', 1, 'Sole Operator Draft', 'Draft', '14750000-0000-0000-0000-0000000000c1', 'per_year');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000001', 'Labor', 'Whole total', 100.00, 0),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000005', 'Labor', 'Gap total', 100.00, 0);

insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, basis)
values ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000005', 'by_days', '{}'::jsonb,
        '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, basis)
values ('14750000-0000-0000-0000-000000000002', '14752222-0000-0000-0000-000000000004', 'by_days', '{}'::jsonb,
        '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method)
values ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000005', 'Labor', 'FY27', 0, 90.00, 'by_days');
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method)
values ('14750000-0000-0000-0000-000000000002', '14752222-0000-0000-0000-000000000004', 'Labor', 'FY27', 0, 100.00, 'by_days');
reset role;

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.budget_distribution_plans'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.budget_year_distributions'::regclass),
  'AC-008 both distribution tables enable and force RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.budget_distribution_plans', 'SELECT')
  and not has_table_privilege('authenticated', 'public.budget_distribution_plans', 'INSERT,UPDATE,DELETE')
  and has_table_privilege('authenticated', 'public.budget_year_distributions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.budget_year_distributions', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.budget_distribution_plans', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.budget_year_distributions', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.budget_line_items', 'INSERT'),
  'AC-008 authenticated clients cannot directly write distribution tables and anon has no line-item insert grant'
);
select ok(
  has_table_privilege('service_role', 'public.budget_distribution_plans', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'public.budget_year_distributions', 'SELECT,INSERT,UPDATE,DELETE'),
  'AC-008 service_role retains the established table privileges'
);
select ok(
  to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)') is not null
  and has_function_privilege('authenticated', to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)'), 'EXECUTE')
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)'), 'EXECUTE'), false)
  and to_regprocedure('public.budget_distribution_gaps(uuid)') is not null
  and has_function_privilege('authenticated', to_regprocedure('public.budget_distribution_gaps(uuid)'), 'EXECUTE')
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.budget_distribution_gaps(uuid)'), 'EXECUTE'), false),
  'AC-008 client RPCs are callable only by authenticated users'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000001','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 Engineer cannot save a distribution');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000001','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 an authenticated caller without a profile cannot save a distribution');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000001','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 a disabled Finance member cannot save a distribution');
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000006')$$,
  '42501', 'not authorized', 'AC-008 a disabled Finance member cannot activate a budget version');
select throws_ok(
  $$insert into budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,actual_amount) values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','disabled line writer',10,0)$$,
  '42501', 'not authorized', 'AC-008 a disabled Finance member cannot use the line-item lock trigger'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000004','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 a same-role member cannot save to another organization version');
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000004')$$,
  '42501', 'not authorized', 'AC-008 a same-role member cannot activate another organization version');
select is_empty($$select 1 from budget_distribution_plans where budget_version_id = '14752222-0000-0000-0000-000000000004'$$,
  'AC-008 an active member cannot read another organization distribution plan');
select is_empty($$select 1 from budget_year_distributions where budget_version_id = '14752222-0000-0000-0000-000000000004'$$,
  'AC-008 an active member cannot read another organization resolved rows');
select is_empty($$select public.budget_distribution_gaps('14752222-0000-0000-0000-000000000004')$$,
  'AC-008 the gap RPC returns no category information for another organization');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000006')$$,
  '42501', 'not authorized', 'AC-008 Engineer cannot activate a budget version');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000006')$$,
  '42501', 'not authorized', 'AC-008 an authenticated caller without a profile cannot activate a budget version');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000002','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[]'::jsonb)$$,
  'P0001', 'only a whole-project Draft can save a distribution', 'AC-008 Active versions cannot save a distribution');
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000003','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[]'::jsonb)$$,
  'P0001', 'only a whole-project Draft can save a distribution', 'AC-008 Archived versions cannot save a distribution');
select lives_ok($$select public.save_budget_distribution(
  '14752222-0000-0000-0000-000000000001','by_days','{}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb
)$$, 'AC-008 an eligible editor can save a reconciled plan');
select is(
  (select updated_by from budget_distribution_plans where budget_version_id = '14752222-0000-0000-0000-000000000001'),
  auth.uid(),
  'AC-008 the saved plan attributes the editor'
);
select ok(
  exists (select 1 from budget_version_editors where budget_version_id = '14752222-0000-0000-0000-000000000001' and user_id = auth.uid()),
  'AC-008 distribution edits add the actor to the SoD editor set'
);
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000001')$$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'AC-008 a distribution editor cannot activate the same version');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000001')$$,
  '42501', 'separation of duties: the person who drafted a budget version cannot activate it',
  'AC-008 the original drafter cannot activate the same version');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000001')$$,
  'P0001', 'whole-project budget activation is unavailable until range dispatch and predecessor cancellation are installed',
  'AC-008 an otherwise eligible activator is fenced until the range money path lands');
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000009')$$,
  '42501', 'a budget version with no recorded drafter can be activated by Admin or Finance only',
  'AC-008 an Executive cannot activate a version with no recorded drafter');
select set_eq(
  $$select public.budget_distribution_gaps('14752222-0000-0000-0000-000000000005')$$,
  $$values ('Labor')$$,
  'AC-008 distribution gaps name the category that does not reconcile'
);
select throws_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000005')$$,
  'P0001', 'budget distribution is incomplete for category Labor',
  'AC-008 activation refuses a non-reconciling category plan before applying the deployment fence');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok(
  $$select public.activate_budget_version('14752222-0000-0000-0000-000000000006')$$,
  'AC-008 an untouched eligible activator can still activate a per_year version');
select is(
  (select status::text from budget_versions where id = '14752222-0000-0000-0000-000000000006'),
  'Active',
  'AC-008 per_year activation retains the established status transition'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok(
  $$select public.activate_budget_version('14752222-0000-0000-0000-000000000008')$$,
  'AC-008 the existing sole-operator exception remains available for per_year budgets');
select is(
  (select activation_basis from budget_versions where id = '14752222-0000-0000-0000-000000000008'),
  'sole_operator',
  'AC-008 the sole-operator activation is recorded with its existing basis'
);
reset role;

select throws_ok(
  $$update budget_versions set budget_mode = 'per_year' where id = '14752222-0000-0000-0000-000000000002'$$,
  'P0001', 'budget mode is immutable after a version leaves Draft',
  'AC-008 budget mode cannot be changed after activation'
);
-- Use an authorized writer so RLS does not mask the fiscal-year trigger.
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$insert into budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year) values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','invalid phase',10,0,'2027')$$,
  'P0001', 'whole-project budget lines cannot carry a fiscal year',
  'AC-008 a whole-project line cannot be assigned an annual fiscal_year'
);
reset role;
-- Isolate the definer-trigger guard from the ordinary missing-table-grant denial.
grant insert on public.budget_line_items to anon;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$insert into budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,actual_amount) values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','anonymous write',10,0)$$,
  '42501', 'not authorized',
  'AC-008 anonymous line writes cannot use the definer trigger to lock an arbitrary budget version'
);
reset role;
revoke insert on public.budget_line_items from anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$insert into budget_distribution_plans (org_id,budget_version_id,method,inputs,basis) values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000001','by_days','{}'::jsonb,'{}'::jsonb)$$,
  '42501', 'permission denied for table budget_distribution_plans',
  'AC-008 authenticated cannot directly insert a plan');
select throws_ok(
  $$update budget_distribution_plans set method = 'amount_by_year' where budget_version_id = '14752222-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table budget_distribution_plans',
  'AC-008 authenticated cannot directly update a plan');
select throws_ok(
  $$insert into budget_year_distributions (org_id,budget_version_id,category,fiscal_year,ordinal,amount,method) values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000001','Labor','FY27',0,100,'by_days')$$,
  '42501', 'permission denied for table budget_year_distributions',
  'AC-008 authenticated cannot directly insert a resolved row');
select throws_ok(
  $$update budget_year_distributions set amount = 50 where budget_version_id = '14752222-0000-0000-0000-000000000001'$$,
  '42501', 'permission denied for table budget_year_distributions',
  'AC-008 authenticated cannot directly update resolved rows');
reset role;

select * from finish();
rollback;
