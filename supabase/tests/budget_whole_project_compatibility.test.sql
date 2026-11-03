-- AC-011 — the additive mode column preserves annual budget semantics and identities.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name)
values ('14740000-0000-0000-0000-000000000001', 'Whole Project Compatibility Org');
insert into auth.users (id, email) values
  ('14740000-0000-0000-0000-0000000000a1', 'whole-compat-pm@example.com'),
  ('14740000-0000-0000-0000-0000000000a2', 'whole-compat-finance@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('14740000-0000-0000-0000-0000000000a1', '14740000-0000-0000-0000-000000000001', 'Compatibility PM', 'whole-compat-pm@example.com', 'Project Manager'),
  ('14740000-0000-0000-0000-0000000000a2', '14740000-0000-0000-0000-000000000001', 'Compatibility Finance', 'whole-compat-finance@example.com', 'Finance');
insert into projects (id, org_id, name, status)
values ('14741111-0000-0000-0000-000000000001', '14740000-0000-0000-0000-000000000001', 'Compatibility Project', 'Ongoing Project');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14740000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status)
values ('14742222-0000-0000-0000-000000000001', '14740000-0000-0000-0000-000000000001',
        '14741111-0000-0000-0000-000000000001', 1, 'Legacy Annual Draft', 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
values ('14740000-0000-0000-0000-000000000001', '14742222-0000-0000-0000-000000000001', 'Labor', 'Annual line', 125.50, 0, '2027');
reset role;

-- A draft successor the annual line must never be moved into (0241 FR-BV-011 stays in force).
insert into budget_versions (id, org_id, project_id, version, name, status)
values ('14742222-0000-0000-0000-000000000002', '14740000-0000-0000-0000-000000000001',
        '14741111-0000-0000-0000-000000000001', 2, 'Legacy Annual Successor Draft', 'Draft');

insert into budget_version_account_erp_mirror (org_id, budget_version_id, fiscal_year, erp_account)
values ('14740000-0000-0000-0000-000000000001', '14742222-0000-0000-0000-000000000001', '2027', '1000');

select is(
  (select budget_mode from budget_versions where id = '14742222-0000-0000-0000-000000000001'),
  'per_year',
  'AC-011 a version created without a mode keeps the historical per_year meaning'
);
select is(
  (select fiscal_year from budget_line_items where budget_version_id = '14742222-0000-0000-0000-000000000001'),
  '2027',
  'AC-011 an annual line keeps its fiscal_year unchanged'
);
select is(
  (select fiscal_year || ':' || erp_account from budget_version_account_erp_mirror
    where budget_version_id = '14742222-0000-0000-0000-000000000001'),
  '2027:1000',
  'AC-011 the existing annual mirror pointer remains intact'
);
select is(
  public.budget_account_identity('14742222-0000-0000-0000-000000000001', '2027', '1000'),
  '14742222-0000-0000-0000-000000000001:a:8:32303237:31303030',
  'AC-011 the annual account identity retains the existing :a: encoding'
);
select is_empty(
  $$select 1 from budget_distribution_plans where budget_version_id = '14742222-0000-0000-0000-000000000001'$$,
  'AC-011 legacy annual versions gain no implicit distribution plan'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"14740000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$select public.activate_budget_version('14742222-0000-0000-0000-000000000001')$$,
  'AC-011 the established per_year activation path still succeeds for an independent Finance activator'
);
select is(
  (select status::text from budget_versions where id = '14742222-0000-0000-0000-000000000001'),
  'Active',
  'AC-011 annual activation keeps the existing Active status transition'
);
select throws_ok(
  $$update budget_line_items set budget_version_id = '14742222-0000-0000-0000-000000000002'
     where budget_version_id = '14742222-0000-0000-0000-000000000001'$$,
  'P0001', 'a budget line cannot move to another version',
  'AC-011 an existing annual line still cannot move to another version'
);
reset role;

select * from finish();
rollback;
