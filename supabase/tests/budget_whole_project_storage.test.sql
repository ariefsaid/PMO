-- AC-007 — the saved whole-project distribution is durable, replaceable and cloneable.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name)
values ('14730000-0000-0000-0000-000000000001', 'Whole Project Storage Org');
insert into auth.users (id, email) values
  ('14730000-0000-0000-0000-0000000000a1', 'whole-storage-pm@example.com'),
  ('14730000-0000-0000-0000-0000000000a2', 'whole-storage-finance@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('14730000-0000-0000-0000-0000000000a1', '14730000-0000-0000-0000-000000000001', 'Storage PM', 'whole-storage-pm@example.com', 'Project Manager'),
  ('14730000-0000-0000-0000-0000000000a2', '14730000-0000-0000-0000-000000000001', 'Storage Finance', 'whole-storage-finance@example.com', 'Finance');
insert into projects (id, org_id, name, status)
values ('14731111-0000-0000-0000-000000000001', '14730000-0000-0000-0000-000000000001', 'Storage Project', 'Ongoing Project');

create temporary table whole_project_clone (id uuid) on commit drop;
grant all on whole_project_clone to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status, budget_mode)
values ('14732222-0000-0000-0000-000000000001', '14730000-0000-0000-0000-000000000001',
        '14731111-0000-0000-0000-000000000001', 1, 'Whole Project Draft', 'Draft', 'whole_project');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
values
  ('14730000-0000-0000-0000-000000000001', '14732222-0000-0000-0000-000000000001', 'Labor', 'Team', 100.00, 0),
  ('14730000-0000-0000-0000-000000000001', '14732222-0000-0000-0000-000000000001', 'Travel & accommodation', 'Explicit zero', 0.00, 0);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.budget_distribution_plans'::regclass),
  'AC-007 distribution plans enable and force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.budget_year_distributions'::regclass),
  'AC-007 yearly rows enable and force RLS'
);

select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'AC-007 an authorized whole-project Draft can save an exact category/year distribution');
select is(
  (select jsonb_build_object('method', method, 'inputs', inputs, 'basis', basis)
     from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  '{"method":"percent_by_year","inputs":{"FY27":"40","FY28":"60"},"basis":{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}}'::jsonb,
  'AC-007 reload returns the approved method, inputs and calendar witness'
);
select is(
  (select count(*)::int from budget_year_distributions where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  4,
  'AC-007 every source category, including an explicit zero, stores one row for each basis year'
);
select ok(
  (select bool_and(amount = 0) from budget_year_distributions
    where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Travel & accommodation'),
  'AC-007 the zero-total category remains an explicit zero in every year'
);
select is_empty(
  $$select public.budget_distribution_gaps('14732222-0000-0000-0000-000000000001')$$,
  'AC-007 a saved distribution that exactly reconciles has no gaps'
);

insert into whole_project_clone select public.clone_budget_version('14732222-0000-0000-0000-000000000001');
select is(
  (select budget_mode from budget_versions where id = (select id from whole_project_clone)),
  'whole_project',
  'AC-007 clone preserves the version mode'
);
select is(
  (select jsonb_build_object('method', method, 'inputs', inputs, 'basis', basis)
     from budget_distribution_plans where budget_version_id = (select id from whole_project_clone)),
  (select jsonb_build_object('method', method, 'inputs', inputs, 'basis', basis)
     from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  'AC-007 clone preserves the approved distribution configuration and basis'
);
select is(
  (select count(*)::int from budget_year_distributions where budget_version_id = (select id from whole_project_clone)),
  4,
  'AC-007 clone copies each resolved category/year row'
);
select ok(
  (select bool_and(is_override) from budget_year_distributions
    where budget_version_id = (select id from whole_project_clone) and category = 'Travel & accommodation'),
  'AC-007 clone preserves category override markers'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14730000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'AC-007 a later save replaces the prior distribution');
select is(
  (select count(*)::int from budget_year_distributions where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  4,
  'AC-007 replacement leaves no duplicate or stale rows'
);
select is(
  (select string_agg(amount::text, ',' order by ordinal) from budget_year_distributions
    where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Labor'),
  '70.00,30.00',
  'AC-007 replacement reloads the new exact amounts'
);
select is(
  (select updated_by from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  '14730000-0000-0000-0000-0000000000a2'::uuid,
  'AC-007 the latest editor is stamped on the saved plan'
);
select ok(
  exists (select 1 from budget_version_editors where budget_version_id = '14732222-0000-0000-0000-000000000001' and user_id = auth.uid()),
  'AC-007 saving a distribution records the actor in the version editor set'
);

select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'P0001', 'budget distribution for Travel & accommodation must include every basis year',
  'AC-007 a missing year is rejected with its category named');
select is(
  (select inputs->>'FY27' from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  '70',
  'AC-007 a missing-year failure leaves the previous plan intact'
);
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"69.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor must reconcile to its source lines',
  'AC-007 exact category totals are enforced by the database');
select is(
  (select string_agg(amount::text, ',' order by ordinal) from budget_year_distributions
    where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Labor'),
  '70.00,30.00',
  'AC-007 a total mismatch leaves the previous rows intact'
);
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor contains duplicate fiscal-year rows',
  'AC-007 duplicate category/year inputs are rejected before replacement');
select is(
  (select string_agg(amount::text, ',' order by ordinal) from budget_year_distributions
    where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Labor'),
  '70.00,30.00',
  'AC-007 duplicate-row failure also preserves the prior distribution'
);

reset role;
select * from finish();
rollback;
