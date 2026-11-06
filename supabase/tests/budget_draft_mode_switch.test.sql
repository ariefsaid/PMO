-- #1472 B2/B3: atomic Draft-only mode changes, exact source witnesses and activation SoD.
begin;
create extension if not exists pgtap;
select plan(42);

insert into organizations (id, name) values
  ('14760000-0000-0000-0000-000000000001', 'Draft Mode Switch Fixture Org'),
  ('14760000-0000-0000-0000-000000000002', 'Draft Mode Switch Other Org');
insert into auth.users (id, email) values
  ('14760000-0000-0000-0000-000000000011', 'mode-admin@example.test'),
  ('14760000-0000-0000-0000-000000000012', 'mode-finance@example.test'),
  ('14760000-0000-0000-0000-000000000013', 'mode-pm@example.test'),
  ('14760000-0000-0000-0000-000000000014', 'mode-executive@example.test'),
  ('14760000-0000-0000-0000-000000000015', 'mode-engineer@example.test'),
  ('14760000-0000-0000-0000-000000000016', 'mode-disabled@example.test'),
  ('14760000-0000-0000-0000-000000000021', 'mode-other@example.test');
insert into profiles (id, org_id, full_name, email, role) values
  ('14760000-0000-0000-0000-000000000011', '14760000-0000-0000-0000-000000000001', 'Mode Admin Fixture', 'mode-admin@example.test', 'Admin'),
  ('14760000-0000-0000-0000-000000000012', '14760000-0000-0000-0000-000000000001', 'Mode Finance Fixture', 'mode-finance@example.test', 'Finance'),
  ('14760000-0000-0000-0000-000000000013', '14760000-0000-0000-0000-000000000001', 'Mode PM Fixture', 'mode-pm@example.test', 'Project Manager'),
  ('14760000-0000-0000-0000-000000000014', '14760000-0000-0000-0000-000000000001', 'Mode Executive Fixture', 'mode-executive@example.test', 'Executive'),
  ('14760000-0000-0000-0000-000000000015', '14760000-0000-0000-0000-000000000001', 'Mode Engineer Fixture', 'mode-engineer@example.test', 'Engineer'),
  ('14760000-0000-0000-0000-000000000016', '14760000-0000-0000-0000-000000000001', 'Mode Disabled Fixture', 'mode-disabled@example.test', 'Finance'),
  ('14760000-0000-0000-0000-000000000021', '14760000-0000-0000-0000-000000000002', 'Mode Other Fixture', 'mode-other@example.test', 'Finance');
update profiles set status = 'disabled' where id = '14760000-0000-0000-0000-000000000016';
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('14761111-0000-0000-0000-000000000001', '14760000-0000-0000-0000-000000000001', 'Mode Switch Project', 'Ongoing Project', '2026-01-01', '2027-12-31'),
  ('14761111-0000-0000-0000-000000000002', '14760000-0000-0000-0000-000000000002', 'Mode Switch Other Project', 'Ongoing Project', '2026-01-01', '2027-12-31');

set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14762222-0000-0000-0000-000000000001', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 1, 'Per Year Draft', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000002', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 2, 'Whole Project Draft', 'Draft', null, 'whole_project'),
  ('14762222-0000-0000-0000-000000000003', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 3, 'Empty Per Year Draft', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000004', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 4, 'Empty Whole Project Draft', 'Draft', '14760000-0000-0000-0000-000000000011', 'whole_project'),
  ('14762222-0000-0000-0000-000000000005', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 5, 'Active Per Year Version', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000006', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 6, 'Archived Per Year Version', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000007', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 7, 'Rollback Per Year Draft', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000009', '14760000-0000-0000-0000-000000000001', '14761111-0000-0000-0000-000000000001', 9, 'Amount Guard Per Year Draft', 'Draft', '14760000-0000-0000-0000-000000000011', 'per_year'),
  ('14762222-0000-0000-0000-000000000008', '14760000-0000-0000-0000-000000000002', '14761111-0000-0000-0000-000000000002', 1, 'Other Tenant Draft', 'Draft', '14760000-0000-0000-0000-000000000021', 'per_year');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('14763333-0000-0000-0000-000000000001', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000001', 'Labor', 'Developers', 200000.00, 0, 'FY26'),
  ('14763333-0000-0000-0000-000000000002', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000001', 'Equipment', 'Equipment', 1000.25, 0, 'FY27'),
  ('14763333-0000-0000-0000-000000000003', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000002', 'Labor', 'Developers', 200000.00, 0, null),
  ('14763333-0000-0000-0000-000000000009', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000002', 'Equipment', 'Equipment', 1000.25, 0, null),
  ('14763333-0000-0000-0000-000000000004', '14760000-0000-0000-0000-000000000002', '14762222-0000-0000-0000-000000000008', 'Labor', 'Other tenant line', 10.00, 0, 'FY26'),
  ('14763333-0000-0000-0000-000000000005', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000005', 'Labor', 'Active line', 10.00, 0, 'FY26'),
  ('14763333-0000-0000-0000-000000000006', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000006', 'Labor', 'Archived line', 10.00, 0, 'FY26'),
  ('14763333-0000-0000-0000-000000000007', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000007', 'Labor', 'Rollback line one', 10.00, 0, 'FY26'),
  ('14763333-0000-0000-0000-000000000008', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000007', 'Equipment', 'Rollback line two', 0.25, 0, 'FY27'),
  ('14763333-0000-0000-0000-000000000010', '14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000009', 'Labor', 'Amount guard line', 10.00, 0, 'FY26');
insert into budget_distribution_plans (org_id, budget_version_id, method, inputs, category_overrides, basis)
values ('14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000002', 'by_days', '{}'::jsonb, '{}'::jsonb,
        '{"projectStart":"2026-01-01","projectEnd":"2027-12-31","years":[{"name":"FY26","start":"2026-01-01","end":"2026-12-31"},{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb);
insert into budget_year_distributions (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
values
  ('14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000002', 'Labor', 'FY26', 0, 200000.00, 'by_days', false),
  ('14760000-0000-0000-0000-000000000001', '14762222-0000-0000-0000-000000000002', 'Equipment', 'FY27', 1, 1000.25, 'by_days', false);
update budget_versions set status = 'Active' where id = '14762222-0000-0000-0000-000000000005';
update budget_versions set status = 'Archived' where id = '14762222-0000-0000-0000-000000000006';
reset role;

select ok(
  to_regprocedure('public.switch_budget_draft_mode(uuid,text,jsonb,jsonb)') is not null
  and has_function_privilege('authenticated', to_regprocedure('public.switch_budget_draft_mode(uuid,text,jsonb,jsonb)'), 'EXECUTE')
  and not has_function_privilege('anon', to_regprocedure('public.switch_budget_draft_mode(uuid,text,jsonb,jsonb)'), 'EXECUTE'),
  'AC-1472-B2 the mode switch RPC is callable only by authenticated users'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=public, pg_temp']
     from pg_proc where oid = to_regprocedure('public.switch_budget_draft_mode(uuid,text,jsonb,jsonb)')),
  'AC-1472-B2 the mode switch RPC is SECURITY DEFINER with a pinned search path'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  '42501', 'not authorized', 'AC-1472-B2 Engineer cannot switch a budget mode'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000016","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  '42501', 'not authorized', 'AC-1472-B2 a disabled Finance member cannot switch a budget mode'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000021","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  '42501', 'not authorized', 'AC-1472-B2 a same-role member in another organization cannot switch this version'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000099","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  '42501', 'not authorized', 'AC-1472-B2 a caller without an active profile cannot switch a budget mode'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project',
    '[{"id":"14763333-0000-0000-0000-000000000001","category":"Labor","budgeted_amount":"200000.01","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000002","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":"FY27"}]'::jsonb,'[]'::jsonb)$$,
  '40001', 'budget lines changed; refresh and review the mode change again', 'AC-1472-B2 stale exact line totals reject the switch'
);
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000001'), 'per_year', 'AC-1472-B2 stale witness leaves the source mode unchanged');
select is((select fiscal_year from budget_line_items where id = '14763333-0000-0000-0000-000000000001'), 'FY26', 'AC-1472-B2 stale witness leaves every source phase unchanged');
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project',
    '[{"id":"14763333-0000-0000-0000-000000000001","category":"Labor","budgeted_amount":"200000.00","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000002","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":"FY27"}]'::jsonb,
    '[{"id":"14763333-0000-0000-0000-000000000001","fiscal_year":"FY26"}]'::jsonb)$$,
  'P0001', 'whole-project mode does not accept fiscal-year assignments', 'AC-1472-B2 whole-project mode rejects supplied assignments'
);
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000001","category":"Labor","budgeted_amount":"200000.00","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000002","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":"FY27"}]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'budget is already in the requested mode', 'AC-1472-B2 mode change cannot be replayed to the current mode'
);
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000002','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000003","category":"Labor","budgeted_amount":"200000.00","fiscal_year":null},{"id":"14763333-0000-0000-0000-000000000009","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":null}]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'every budget line needs an explicit fiscal-year assignment', 'AC-1472-B2 per-year switch refuses missing line assignments'
);
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000002','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000003","category":"Labor","budgeted_amount":"200000.00","fiscal_year":null},{"id":"14763333-0000-0000-0000-000000000009","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":null}]'::jsonb,
    '[{"id":"14763333-0000-0000-0000-000000000003","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000003","fiscal_year":"FY27"}]'::jsonb)$$,
  'P0001', 'fiscal-year assignments must name every line exactly once', 'AC-1472-B2 duplicate assignments cannot replace a missing line'
);
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000002','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000003","category":"Labor","budgeted_amount":"200000.00","fiscal_year":null},{"id":"14763333-0000-0000-0000-000000000009","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":null}]'::jsonb,
    '[{"id":"14763333-0000-0000-0000-000000000003","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000099","fiscal_year":"FY27"}]'::jsonb)$$,
  'P0001', 'fiscal-year assignments must name every line exactly once', 'AC-1472-B2 assignments cannot name an unknown line'
);
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000002','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000003","category":"Labor","budgeted_amount":"200000.00","fiscal_year":null},{"id":"14763333-0000-0000-0000-000000000009","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":null}]'::jsonb,
    '[{"id":"14763333-0000-0000-0000-000000000003","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000009","fiscal_year":" "}]'::jsonb)$$,
  'P0001', 'fiscal-year assignments must name every line exactly once', 'AC-1472-B2 blank assignments are rejected'
);
select lives_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000001','whole_project',
    '[{"id":"14763333-0000-0000-0000-000000000001","category":"Labor","budgeted_amount":"200000.00","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000002","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":"FY27"}]'::jsonb,'[]'::jsonb)$$,
  'AC-1472-B2 Finance changes a per-year Draft to whole-project mode'
);
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000001'), 'whole_project', 'AC-1472-B2 per-year to whole-project transition changes the mode');
select is((select count(*)::integer from budget_line_items where budget_version_id = '14762222-0000-0000-0000-000000000001' and fiscal_year is not null), 0, 'AC-1472-B2 per-year to whole-project clears all source phases');
select is((select sum(budgeted_amount)::numeric from budget_line_items where budget_version_id = '14762222-0000-0000-0000-000000000001'), 201000.25::numeric, 'AC-1472-B2 per-year to whole-project preserves exact total amount');
select is((select count(*)::integer from budget_version_editors where budget_version_id = '14762222-0000-0000-0000-000000000001' and user_id = '14760000-0000-0000-0000-000000000012'), 1, 'AC-1472-B2 the mode switch stamps the current editor');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.activate_budget_version('14762222-0000-0000-0000-000000000001')$$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'AC-1472-B2 a mode-switch editor remains excluded from activation by SoD');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000002','per_year',
    '[{"id":"14763333-0000-0000-0000-000000000003","category":"Labor","budgeted_amount":"200000.00","fiscal_year":null},{"id":"14763333-0000-0000-0000-000000000009","category":"Equipment","budgeted_amount":"1000.25","fiscal_year":null}]'::jsonb,
    '[{"id":"14763333-0000-0000-0000-000000000003","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000009","fiscal_year":"FY27"}]'::jsonb)$$,
  'AC-1472-B2 Project Manager changes a whole-project Draft to per-year mode'
);
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000002'), 'per_year', 'AC-1472-B2 whole-project to per-year transition changes the mode');
select is((select fiscal_year from budget_line_items where id = '14763333-0000-0000-0000-000000000003'), 'FY26', 'AC-1472-B2 whole-project to per-year applies the selected year');
select is((select fiscal_year from budget_line_items where id = '14763333-0000-0000-0000-000000000009'), 'FY27', 'AC-1472-B2 whole-project to per-year applies every selected year');
select is((select sum(budgeted_amount)::numeric from budget_line_items where budget_version_id = '14762222-0000-0000-0000-000000000002'), 201000.25::numeric, 'AC-1472-B2 whole-project to per-year preserves exact source totals');
select is((select count(*)::integer from budget_distribution_plans where budget_version_id = '14762222-0000-0000-0000-000000000002'), 0, 'AC-1472-B2 mode switch clears the incompatible saved plan');
select is((select count(*)::integer from budget_year_distributions where budget_version_id = '14762222-0000-0000-0000-000000000002'), 0, 'AC-1472-B2 mode switch clears incompatible resolved rows');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000014","role":"authenticated"}';
select lives_ok($$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000004','per_year','[]'::jsonb,'[]'::jsonb)$$,
  'AC-1472-B2 Executive can change a Draft with no source lines');
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000004'), 'per_year', 'AC-1472-B2 Executive transition commits the requested mode');
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000003','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  'AC-1472-B2 Admin can change a Draft with no source lines');
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000003'), 'whole_project', 'AC-1472-B2 Admin transition commits the requested mode');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000005','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'only a Draft budget can change mode', 'AC-1472-B2 Active versions cannot change mode');
select throws_ok($$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000006','whole_project','[]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'only a Draft budget can change mode', 'AC-1472-B2 Archived versions cannot change mode');
reset role;

create function public.test_budget_mode_switch_abort_on_travel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category = 'Equipment' and new.fiscal_year is null then
    raise exception 'mode switch rollback probe' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger zz_test_budget_mode_switch_abort
  before update of fiscal_year on public.budget_line_items
  for each row execute function public.test_budget_mode_switch_abort_on_travel();
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000007','whole_project',
    '[{"id":"14763333-0000-0000-0000-000000000007","category":"Labor","budgeted_amount":"10.00","fiscal_year":"FY26"},{"id":"14763333-0000-0000-0000-000000000008","category":"Equipment","budgeted_amount":"0.25","fiscal_year":"FY27"}]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'mode switch rollback probe', 'AC-1472-B2 a failure during phase clearing rolls the mode switch back atomically'
);
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000007'), 'per_year', 'AC-1472-B2 failed transition leaves the version mode unchanged');
select is((select count(*)::integer from budget_line_items where budget_version_id = '14762222-0000-0000-0000-000000000007' and fiscal_year is not null), 2, 'AC-1472-B2 failed transition restores every source phase');
select is((select count(*)::integer from budget_version_editors where budget_version_id = '14762222-0000-0000-0000-000000000007' and user_id = '14760000-0000-0000-0000-000000000011'), 0, 'AC-1472-B2 failed transition does not stamp a partial editor change');

create function public.test_budget_mode_switch_change_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.id = '14763333-0000-0000-0000-000000000010' and new.fiscal_year is null then
    new.budgeted_amount := new.budgeted_amount + 0.01;
  end if;
  return new;
end;
$$;
create trigger zz_test_budget_mode_switch_change_amount
  before update of fiscal_year on public.budget_line_items
  for each row execute function public.test_budget_mode_switch_change_amount();
set local role authenticated;
set local request.jwt.claims = '{"sub":"14760000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok(
  $$select public.switch_budget_draft_mode('14762222-0000-0000-0000-000000000009','whole_project',
    '[{"id":"14763333-0000-0000-0000-000000000010","category":"Labor","budgeted_amount":"10.00","fiscal_year":"FY26"}]'::jsonb,'[]'::jsonb)$$,
  'P0001', 'budget line totals changed during mode switch', 'AC-1472-B2 a source amount change during conversion aborts atomically');
reset role;
select is((select budget_mode from budget_versions where id = '14762222-0000-0000-0000-000000000009'), 'per_year', 'AC-1472-B2 an amount guard failure leaves the mode unchanged');
select is((select fiscal_year from budget_line_items where id = '14763333-0000-0000-0000-000000000010'), 'FY26', 'AC-1472-B2 an amount guard failure restores the source phase');
select is((select budgeted_amount::numeric from budget_line_items where id = '14763333-0000-0000-0000-000000000010'), 10.00::numeric, 'AC-1472-B2 an amount guard failure restores the exact source amount');

select * from finish();
rollback;
