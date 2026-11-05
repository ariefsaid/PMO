-- AC-008 — server authorization, authorship, RLS and whole-project activation.
begin;
create extension if not exists pgtap;
select plan(74);

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
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('14751111-0000-0000-0000-000000000001', '14750000-0000-0000-0000-000000000001', 'Whole Roles Project', 'Ongoing Project', '2027-01-01', '2027-12-31'),
  ('14751111-0000-0000-0000-000000000002', '14750000-0000-0000-0000-000000000002', 'Other Org Project', 'Ongoing Project', '2027-01-01', '2027-12-31'),
  ('14751111-0000-0000-0000-000000000003', '14750000-0000-0000-0000-000000000003', 'Sole Operator Project', 'Ongoing Project', '2027-01-01', '2027-12-31');

set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14752222-0000-0000-0000-000000000001', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 1, 'Valid Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a2', 'whole_project'),
  ('14752222-0000-0000-0000-000000000002', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 2, 'Active Whole Version', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000003', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 3, 'Archived Whole Version', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000004', '14750000-0000-0000-0000-000000000002', '14751111-0000-0000-0000-000000000002', 1, 'Other Org Draft', 'Draft', '14750000-0000-0000-0000-0000000000b1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000005', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 4, 'Gap Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000006', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 5, 'Annual Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'per_year'),
  ('14752222-0000-0000-0000-000000000007', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 6, 'Phased Whole Draft', 'Draft', '14750000-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14752222-0000-0000-0000-000000000009', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 7, 'No Drafter Annual Draft', 'Draft', null, 'per_year'),
  ('14752222-0000-0000-0000-000000000008', '14750000-0000-0000-0000-000000000003', '14751111-0000-0000-0000-000000000003', 1, 'Sole Operator Draft', 'Draft', '14750000-0000-0000-0000-0000000000c1', 'per_year');
-- Keep the project in the caller's tenant while deliberately giving this fixture a different version tenant,
-- so the version-scope authorization predicate is the only tenant gate under test.
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14752222-0000-0000-0000-000000000010', '14750000-0000-0000-0000-000000000002', '14751111-0000-0000-0000-000000000001', 8, 'Version Tenant Boundary Draft', 'Draft', '14750000-0000-0000-0000-0000000000a2', 'whole_project');
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14752222-0000-0000-0000-000000000011', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000002', 9, 'Project Tenant Boundary Draft', 'Draft', '14750000-0000-0000-0000-0000000000a2', 'whole_project'),
  ('14752222-0000-0000-0000-000000000012', '14750000-0000-0000-0000-000000000001', '14751111-0000-0000-0000-000000000001', 10, 'Cascade Draft', 'Draft', '14750000-0000-0000-0000-0000000000a2', 'whole_project');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000001', 'Labor', 'Whole total', 100.00, 0),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000002', 'Labor', 'Active total', 100.00, 0),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000003', 'Labor', 'Archived total', 100.00, 0),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000005', 'Labor', 'Gap total', 100.00, 0),
  ('14750000-0000-0000-0000-000000000002', '14752222-0000-0000-0000-000000000010', 'Labor', 'Tenant boundary total', 100.00, 0);
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
values ('14753333-0000-0000-0000-000000000012', '14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000012', 'Labor', 'Cascade probe line', 1, 0);

insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, category_overrides, basis)
values
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000002', 'by_days', '{}'::jsonb, '{}'::jsonb,
   '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000003', 'by_days', '{}'::jsonb, '{}'::jsonb,
   '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
values
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000002', 'Labor', 'FY27', 0, 100.00, 'by_days', false),
  ('14750000-0000-0000-0000-000000000001', '14752222-0000-0000-0000-000000000003', 'Labor', 'FY27', 0, 100.00, 'by_days', false);
-- The line-item guard correctly prohibits inserting source lines once a version is Active or Archived;
-- construct complete otherwise-valid fixtures as Draft, then move only their status for the gate tests.
update budget_versions set status = 'Active' where id = '14752222-0000-0000-0000-000000000002';
update budget_versions set status = 'Archived' where id = '14752222-0000-0000-0000-000000000003';

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

-- Exercise the line-item trigger's own caller authorization independently of table RLS. The
-- wrapper is transaction-scoped to this pgTAP file and is removed by the final rollback.
create function public.test_budget_whole_project_line_item_write(p_org_id uuid, p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.budget_line_items
    (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
  values
    (p_org_id, p_version_id, 'Labor', 'Role guard context probe', 1, 0);
end;
$$;
revoke all on function public.test_budget_whole_project_line_item_write(uuid, uuid) from public, anon;
grant execute on function public.test_budget_whole_project_line_item_write(uuid, uuid) to authenticated;

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
select ok(
  (select p.prosecdef
          and p.proconfig @> array['search_path=public, pg_temp']
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.oid = to_regprocedure('public.enforce_draft_line_item()'))
  and exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.budget_line_items'::regclass
       and t.tgfoid = to_regprocedure('public.enforce_draft_line_item()')
       and not t.tgisinternal
       and t.tgenabled <> 'D'
  ),
  'AC-008 line-item locking stays on its SECURITY DEFINER trigger with pinned search_path and no direct client execute grant'
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
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 the trigger retains its disabled-member check when called through owner rights'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000004','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 a same-role member cannot save to another organization version');
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000010','by_days','{}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"by_days","is_override":false}]'::jsonb)$$,
  '42501', 'not authorized', 'AC-008 a matching project tenant cannot authorize a mismatched budget-version tenant');
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000002','14752222-0000-0000-0000-000000000010')$$,
  '42501', 'not authorized',
  'AC-008 the trigger retains its version/project tenant check when called through owner rights'
);
select is_empty($$select 1 from budget_distribution_plans where budget_version_id = '14752222-0000-0000-0000-000000000010'$$,
  'AC-008 a rejected mismatched version-tenant write leaves no distribution plan');
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
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000002','percent_by_year','{"FY27":"100"}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"percent_by_year","is_override":false}]'::jsonb)$$,
  'P0001', 'only a whole-project Draft can save a distribution', 'AC-008 Active versions cannot save a distribution');
select throws_ok($$select public.save_budget_distribution('14752222-0000-0000-0000-000000000003','percent_by_year','{"FY27":"100"}'::jsonb,'{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb,'[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"100.00","method":"percent_by_year","is_override":false}]'::jsonb)$$,
  'P0001', 'only a whole-project Draft can save a distribution', 'AC-008 Archived versions cannot save a distribution');
select is((select method from budget_distribution_plans where budget_version_id='14752222-0000-0000-0000-000000000002'), 'by_days',
  'AC-008 Active rejection preserves its prior plan declaration');
select is((select amount from budget_year_distributions where budget_version_id='14752222-0000-0000-0000-000000000002'), 100::numeric,
  'AC-008 Active rejection preserves its prior resolved row');
select is((select method from budget_distribution_plans where budget_version_id='14752222-0000-0000-0000-000000000003'), 'by_days',
  'AC-008 Archived rejection preserves its prior plan declaration');
select is((select amount from budget_year_distributions where budget_version_id='14752222-0000-0000-0000-000000000003'), 100::numeric,
  'AC-008 Archived rejection preserves its prior resolved row');
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
select lives_ok($$select public.activate_budget_version('14752222-0000-0000-0000-000000000001')$$,
  'AC-008 an otherwise eligible activator activates a reconciled same-range revision and archives its predecessor');
select is((select status::text from budget_versions where id='14752222-0000-0000-0000-000000000001'), 'Active',
  'AC-008 the eligible whole-project revision becomes Active');
select is((select status::text from budget_versions where id='14752222-0000-0000-0000-000000000002'), 'Archived',
  'AC-008 the exact same-range Active predecessor becomes Archived');
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
  'AC-008 activation refuses a non-reconciling category plan before changing the Active predecessor');
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

-- The guard uses the active SQL role to decide whether JWT membership claims are authoritative.
-- Its wrapper above deliberately bypasses table RLS so each caller-context refusal reaches the
-- trigger itself; direct authenticated writes below separately prove the ordinary RLS path.
select ok(
  (select rolbypassrls from pg_roles where rolname = 'postgres')
  and (select rolbypassrls from pg_roles where rolname = 'service_role')
  and not (select rolbypassrls from pg_roles where rolname = 'authenticated')
  and public.actor_bypasses_rls('postgres'::name)
  and public.actor_bypasses_rls('service_role'::name)
  and not public.actor_bypasses_rls('authenticated'::name),
  'AC-008 only the actual trusted database roles bypass caller JWT membership checks'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14753333-0000-0000-0000-000000000021','14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','ordinary client insert',1,0)$$,
  'AC-008 an active same-tenant member can insert a Draft line through ordinary RLS'
);
select lives_ok(
  $$update public.budget_line_items set budgeted_amount = 2 where id = '14753333-0000-0000-0000-000000000021'$$,
  'AC-008 an active same-tenant member can update a Draft line through ordinary RLS'
);
select lives_ok(
  $$delete from public.budget_line_items where id = '14753333-0000-0000-0000-000000000021'$$,
  'AC-008 an active same-tenant member can delete a Draft line through ordinary RLS'
);
select is_empty(
  $$select 1 from public.budget_line_items where id = '14753333-0000-0000-0000-000000000021'$$,
  'AC-008 the ordinary Draft insert/update/delete journey leaves no line behind'
);

-- A root SQL fixture session can issue trusted maintenance statements after switching roles or
-- resetting to its session role. Stale caller claims must not turn those SQL writes into client writes.
set local role postgres;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14753333-0000-0000-0000-000000000022','14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','postgres stale tenant claim',1,0)$$,
  'AC-008 an actual postgres SQL role can write an org-A Draft line with stale org-B JWT claims'
);
reset role;
select is((select count(*)::integer from public.budget_line_items where id = '14753333-0000-0000-0000-000000000022'), 1,
  'AC-008 the trusted stale-claim SQL write is persisted in its requested tenant');
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14753333-0000-0000-0000-000000000023','14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','session role stale tenant claim',1,0)$$,
  'AC-008 reset-to-session postgres with stale JWT claims can write an org-A Draft line'
);
select is((select count(*)::integer from public.budget_line_items where id = '14753333-0000-0000-0000-000000000023'), 1,
  'AC-008 the reset-to-session trusted SQL write is persisted');

set local role service_role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14753333-0000-0000-0000-000000000024','14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','service role no claims',1,0)$$,
  'AC-008 the actual service_role can write a Draft line without user claims'
);
reset role;
select is((select count(*)::integer from public.budget_line_items where id = '14753333-0000-0000-0000-000000000024'), 1,
  'AC-008 the service_role no-claims Draft write is persisted');
set local role service_role;
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_line_items (id,org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14753333-0000-0000-0000-000000000025','14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007','Labor','service role stale user claim',1,0)$$,
  'AC-008 the actual service_role can write an org-A Draft line with stale org-B user claims'
);
reset role;
select is((select count(*)::integer from public.budget_line_items where id = '14753333-0000-0000-0000-000000000025'), 1,
  'AC-008 the service_role stale-claim Draft write is persisted');

-- Missing-subject calls are always rejected for an unprivileged SQL role, regardless of the JWT role
-- claim. These owner-rights calls reach the trigger directly instead of being stopped by RLS.
set local role authenticated;
set local request.jwt.claims = '{}';
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 an authenticated SQL role without JWT claims cannot call the trigger through owner rights'
);
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 an authenticated JWT role claim without a subject cannot call the trigger through owner rights'
);
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 an anon JWT role claim without a subject cannot call the trigger through owner rights'
);
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 a forged service_role JWT claim without a subject cannot bypass the actual authenticated SQL role'
);
set local request.jwt.claims = '{"sub":"14750000-0000-0000-0000-0000000000b1","role":"service_role"}';
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000007')$$,
  '42501', 'not authorized',
  'AC-008 a forged service_role claim cannot authorize a cross-tenant subject on the actual authenticated SQL role'
);
select throws_ok(
  $$select public.test_budget_whole_project_line_item_write('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000011')$$,
  '42501', 'not authorized',
  'AC-008 an active member cannot write through a version whose project belongs to another tenant'
);
reset role;

-- Trusted server roles still obey the Draft status and immutable-parent contracts.
set local role service_role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$insert into public.budget_line_items (org_id,budget_version_id,category,description,budgeted_amount,actual_amount)
    values ('14750000-0000-0000-0000-000000000001','14752222-0000-0000-0000-000000000002','Labor','trusted active insert',1,0)$$,
  'P0001', 'line-items can only change while the owning version is Draft',
  'AC-008 service_role cannot insert into an Active version'
);
select throws_ok(
  $$update public.budget_line_items set budgeted_amount = budgeted_amount + 1 where budget_version_id = '14752222-0000-0000-0000-000000000002'$$,
  'P0001', 'line-items can only change while the owning version is Draft',
  'AC-008 service_role cannot update a line in an Active version'
);
select throws_ok(
  $$delete from public.budget_line_items where budget_version_id = '14752222-0000-0000-0000-000000000002'$$,
  'P0001', 'line-items can only change while the owning version is Draft',
  'AC-008 service_role cannot delete a line in an Active version'
);
select throws_ok(
  $$update public.budget_line_items set budget_version_id = '14752222-0000-0000-0000-000000000007' where budget_version_id = '14752222-0000-0000-0000-000000000001'$$,
  'P0001', 'a budget line cannot move to another version',
  'AC-008 service_role cannot reparent a line between Draft versions'
);
select lives_ok(
  $$delete from public.budget_versions where id = '14752222-0000-0000-0000-000000000012'$$,
  'AC-008 service_role can cascade-delete a Draft parent after its row is gone before the child trigger runs'
);
reset role;
select is_empty(
  $$select 1 from public.budget_line_items where id = '14753333-0000-0000-0000-000000000012'$$,
  'AC-008 parent deletion cascades through its child trigger without leaving an orphan'
);

select * from finish();
rollback;
