-- AC-1472-S6A-READ — one statement returns the caller-visible saved distribution snapshot.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name) values
  ('14728200-0000-0000-0000-000000000001', 'Snapshot Tenant A'),
  ('14728200-0000-0000-0000-000000000002', 'Snapshot Tenant B');
insert into auth.users (id, email) values
  ('14728200-0000-0000-0000-0000000000a1', 'snapshot-member@example.invalid'),
  ('14728200-0000-0000-0000-0000000000a2', 'snapshot-unprofiled@example.invalid');
insert into profiles (id, org_id, full_name, email, role) values
  ('14728200-0000-0000-0000-0000000000a1', '14728200-0000-0000-0000-000000000001', 'Snapshot Member', 'snapshot-member@example.invalid', 'Finance');
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('14728211-0000-0000-0000-000000000001', '14728200-0000-0000-0000-000000000001', 'Snapshot Project A', 'Ongoing Project', '2027-01-01', '2028-12-31'),
  ('14728211-0000-0000-0000-000000000002', '14728200-0000-0000-0000-000000000002', 'Snapshot Project B', 'Ongoing Project', '2027-01-01', '2028-12-31');
set local request.jwt.claims = '{}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by, budget_mode) values
  ('14728222-0000-0000-0000-000000000001', '14728200-0000-0000-0000-000000000001', '14728211-0000-0000-0000-000000000001', 1, 'Snapshot With Plan', 'Draft', '14728200-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14728222-0000-0000-0000-000000000002', '14728200-0000-0000-0000-000000000001', '14728211-0000-0000-0000-000000000001', 2, 'Snapshot Missing Plan', 'Draft', '14728200-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14728222-0000-0000-0000-000000000003', '14728200-0000-0000-0000-000000000002', '14728211-0000-0000-0000-000000000002', 1, 'Snapshot Foreign Plan', 'Draft', '14728200-0000-0000-0000-0000000000a1', 'whole_project'),
  ('14728222-0000-0000-0000-000000000004', '14728200-0000-0000-0000-000000000001', '14728211-0000-0000-0000-000000000001', 3, 'Snapshot Large Plan', 'Draft', '14728200-0000-0000-0000-0000000000a1', 'whole_project');
insert into budget_distribution_plans
  (org_id, budget_version_id, method, inputs, category_overrides, basis)
values
  ('14728200-0000-0000-0000-000000000001', '14728222-0000-0000-0000-000000000001', 'amount_by_year',
   '{"FY27":"0.00","FY28":"40.00"}'::jsonb,
   '{"Materials":{"method":"percent_by_year","inputs":{"FY27":"0","FY28":"100.00"}}}'::jsonb,
   '{"projectStart":"2027-01-01","projectEnd":null,"years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb),
  ('14728200-0000-0000-0000-000000000002', '14728222-0000-0000-0000-000000000003', 'by_days', '{}'::jsonb, '{}'::jsonb,
   '{"projectStart":"2027-01-01","projectEnd":"2027-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"}]}'::jsonb),
  ('14728200-0000-0000-0000-000000000001', '14728222-0000-0000-0000-000000000004', 'by_days', '{}'::jsonb, '{}'::jsonb,
   jsonb_build_object(
     'projectStart', '1000-01-01',
     'projectEnd', '2000-12-31',
     'years', (
       select jsonb_agg(jsonb_build_object(
         'name', 'FY' || lpad(year_index::text, 4, '0'),
         'start', to_char(date '1000-01-01' + make_interval(years => year_index), 'YYYY-MM-DD'),
         'end', to_char(date '1000-12-31' + make_interval(years => year_index), 'YYYY-MM-DD')
       ) order by year_index)
       from generate_series(0, 1000) as years(year_index)
     )
   ));
insert into budget_year_distributions
  (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
values
  ('14728200-0000-0000-0000-000000000001', '14728222-0000-0000-0000-000000000001', 'Labor', 'FY27', 0, 0.00, 'amount_by_year', false),
  ('14728200-0000-0000-0000-000000000001', '14728222-0000-0000-0000-000000000001', 'Materials', 'FY27', 0, 999999999999.99, 'percent_by_year', true),
  ('14728200-0000-0000-0000-000000000002', '14728222-0000-0000-0000-000000000003', 'Labor', 'FY27', 0, 7.00, 'by_days', false);
insert into budget_year_distributions
  (org_id, budget_version_id, category, fiscal_year, ordinal, amount, method, is_override)
select
  '14728200-0000-0000-0000-000000000001',
  '14728222-0000-0000-0000-000000000004',
  'Labor',
  'FY' || lpad(year_index::text, 4, '0'),
  year_index,
  case when year_index = 0 then 999999999999.99::numeric else 0.00::numeric end,
  'by_days',
  false
from generate_series(0, 1000) as years(year_index);

select ok(
  to_regprocedure('public.get_budget_distribution_snapshot(uuid)') is not null,
  'the snapshot RPC has the expected single uuid argument'
);
select ok(
  has_function_privilege('authenticated', to_regprocedure('public.get_budget_distribution_snapshot(uuid)'), 'EXECUTE')
  and not has_function_privilege('anon', to_regprocedure('public.get_budget_distribution_snapshot(uuid)'), 'EXECUTE'),
  'the snapshot RPC is executable by authenticated callers only'
);
select ok(
  not exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
     where p.oid = to_regprocedure('public.get_budget_distribution_snapshot(uuid)')
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ),
  'the snapshot RPC has no PUBLIC execute grant'
);
select ok(
  exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.get_budget_distribution_snapshot(uuid)')
       and not p.prosecdef
       and p.provolatile = 's'
       and p.proconfig @> array['search_path=pg_catalog, public']
  ),
  'the snapshot RPC is stable, security invoker, and pins its search path'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"14728200-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001') is not null,
  'an active member reads the saved snapshot for its tenant'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->>'method',
  'amount_by_year',
  'the snapshot preserves the declared method'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'inputs',
  '{"FY27":"0.00","FY28":"40.00"}'::jsonb,
  'the snapshot preserves exact input strings'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'category_overrides',
  '{"Materials":{"method":"percent_by_year","inputs":{"FY27":"0","FY28":"100.00"}}}'::jsonb,
  'the snapshot preserves category overrides and input strings'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'basis',
  '{"projectStart":"2027-01-01","projectEnd":null,"years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  'the snapshot preserves its exact date and fiscal-year basis'
);
select is(
  jsonb_array_length(public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'),
  2,
  'the snapshot contains every stored row'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->0->>'amount',
  '0.00',
  'a stored zero remains an exact decimal string'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->1->>'amount',
  '999999999999.99',
  'the maximum numeric(14,2) amount remains an exact decimal string'
);
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->0->>'category' = 'Labor'
  and public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->1->>'category' = 'Materials'
  and public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->1->>'method' = 'percent_by_year'
  and public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001')->'rows'->1->>'is_override' = 'true',
  'rows are ordered deterministically with method and override markers intact'
);
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000002') is null,
  'a visible version without a saved plan returns null'
);
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000003') is null,
  'a member cannot read a foreign-tenant snapshot'
);
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000004')->'rows' is not null,
  'the large snapshot remains visible to its active member'
);
select is(
  jsonb_array_length(public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000004')->'rows'),
  1001,
  'the JSON aggregate returns all 1001 rows beyond PostgREST max_rows'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000004')->'rows'->0->>'fiscal_year',
  'FY0000',
  'the aggregate starts with its first ordinal'
);
select is(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000004')->'rows'->1000->>'fiscal_year',
  'FY1000',
  'the aggregate ends with its last ordinal'
);

set local request.jwt.claims = '{"sub":"14728200-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(
  public.get_budget_distribution_snapshot('14728222-0000-0000-0000-000000000001') is null,
  'an authenticated caller without an active member profile sees no snapshot'
);
reset role;

select * from finish();
rollback;
