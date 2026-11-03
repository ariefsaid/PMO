-- AC-007 — the saved whole-project distribution is durable, replaceable and cloneable.
begin;
create extension if not exists pgtap;
select plan(48);

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
create temporary table whole_project_override_clone (id uuid) on commit drop;
grant all on whole_project_override_clone to authenticated;

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
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb
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
select is(
  (select bool_and(is_override) from budget_year_distributions
    where budget_version_id = (select id from whole_project_clone) and category = 'Travel & accommodation'),
  (select bool_and(is_override) from budget_year_distributions
    where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Travel & accommodation'),
  'AC-007 clone preserves the category override markers of its source'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"14730000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb
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


-- ── Per-category method/input overrides (FR-003/008/019): stored, reloaded, cloned and validated. ──
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year',
  '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"amount_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"0","FY28":"0"}}}'::jsonb
)$$, 'AC-007 a category with its own method and entered amounts saves beside the budget-wide rule');
select is(
  (select category_overrides from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  '{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"0","FY28":"0"}}}'::jsonb,
  'AC-007 reload returns the category override method and its explicit entered values'
);
select is_empty(
  $$select public.budget_distribution_gaps('14732222-0000-0000-0000-000000000001')$$,
  'AC-007 an overridden distribution that reconciles has no gaps'
);
insert into whole_project_override_clone select public.clone_budget_version('14732222-0000-0000-0000-000000000001');
select is(
  (select category_overrides from budget_distribution_plans where budget_version_id = (select id from whole_project_override_clone)),
  (select category_overrides from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  'AC-007 clone reproduces the approved category override inputs'
);
select is(
  (select string_agg(distinct method::text, ',') from budget_year_distributions
    where budget_version_id = (select id from whole_project_override_clone)
      and category = 'Travel & accommodation'),
  'amount_by_year',
  'AC-007 clone keeps each overridden category on its own method'
);
select ok(
  to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb,jsonb)') is not null
  and to_regprocedure('public.save_budget_distribution(uuid,text,jsonb,jsonb,jsonb)') is null,
  'AC-007 only the six-argument save signature exists (the five-argument call still resolves to it)'
);

select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"amount_by_year","is_override":true},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"50.00","method":"amount_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb,
  '{"Labor":{"method":"amount_by_year","inputs":{"FY27":"40","FY28":"50"}}}'::jsonb
)$$, 'P0001', 'budget distribution inputs for Labor must sum to its source total',
  'AC-007 an amount override that does not sum to its category total is refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":true},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb,
  '{"Labor":{"method":"percent_by_year","inputs":{"FY27":"50","FY28":"40"}}}'::jsonb
)$$, 'P0001', 'budget distribution inputs for Labor must sum to 100',
  'AC-007 an override whose percentages do not total 100 is refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"amount_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"0"}}}'::jsonb
)$$, 'P0001', 'budget distribution inputs for Travel & accommodation must include every basis year',
  'AC-007 an override missing an in-span year is refused with its category named');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"amount_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"0","FY28":"0","FY29":"0"}}}'::jsonb
)$$, 'P0001', 'budget distribution inputs for Travel & accommodation contain a year outside its basis',
  'AC-007 an override naming an out-of-span year is refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"amount_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"-1","FY28":"1"}}}'::jsonb
)$$, 'P0001', 'budget distribution inputs for Travel & accommodation contain an invalid value',
  'AC-007 a negative override value is refused rather than repaired');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":true},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb,
  '{"Labor":{"method":"amount_by_year","inputs":{"FY27":"40","FY28":"60"}}}'::jsonb
)$$, 'P0001', 'budget distribution for Labor has a row method that does not match its declared method',
  'AC-007 a row whose method contradicts its override is refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"70","FY28":"30"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":true},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":true}]'::jsonb
)$$, 'P0001', 'budget distribution for Travel & accommodation has an override flag that does not match its declaration',
  'AC-007 a row claiming an override that was not declared is refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"30.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"70.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not follow its percentage inputs (year FY27)',
  'AC-007 rows that reconcile in total but ignore the entered percentages are refused');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000001', 'percent_by_year', '{"FY27":"40","FY28":"60"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Travel & accommodation","fiscal_year":"FY28","ordinal":1,"amount":"0.00","method":"percent_by_year","is_override":false}]'::jsonb,
  '{"Vehicle":{"method":"by_days","inputs":{}}}'::jsonb
)$$, 'P0001', 'budget distribution has no source lines for category Vehicle',
  'AC-007 an override for a category with no source lines is refused');
select is(
  (select jsonb_build_object('overrides', category_overrides,
                             'labor', (select string_agg(amount::text, ',' order by ordinal)
                                         from budget_year_distributions
                                        where budget_version_id = '14732222-0000-0000-0000-000000000001' and category = 'Labor'))
     from budget_distribution_plans where budget_version_id = '14732222-0000-0000-0000-000000000001'),
  '{"overrides":{"Travel & accommodation":{"method":"amount_by_year","inputs":{"FY27":"0","FY28":"0"}}},"labor":"40.00,60.00"}'::jsonb,
  'AC-007 every rejected override leaves the previously approved plan intact'
);


-- ── Exact S2 arithmetic: the DB must reproduce budgetDistribution.allocate, not a tolerance. ──────
insert into budget_versions (id, org_id, project_id, version, name, status, budget_mode)
values ('14732222-0000-0000-0000-000000000050', '14730000-0000-0000-0000-000000000001',
        '14731111-0000-0000-0000-000000000001', 50, 'Exact Remainder Draft', 'Draft', 'whole_project');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
values ('14730000-0000-0000-0000-000000000001', '14732222-0000-0000-0000-000000000050', 'Labor', 'One cent total', 100.01, 0);

-- 50/50 of 100.01: both shares floor to 50.00, the single remaining cent is a tie and goes to the
-- earlier fiscal year. 50.00/50.01 is therefore the only accepted answer.
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"50","FY28":"50"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"50.01","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"50.00","method":"percent_by_year","is_override":false}]'::jsonb
)$$, 'AC-007 a tied 50/50 remainder of one cent goes to the earlier fiscal year');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"50","FY28":"50"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"50.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"50.01","method":"percent_by_year","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not follow its percentage inputs (year FY27)',
  'AC-007 the same cent on the later year is refused (a balanced one-cent error)');

-- A 0% year stays exactly zero: no remainder unit may be moved onto it.
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"0","FY28":"100"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"0.00","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"100.01","method":"percent_by_year","is_override":false}]'::jsonb
)$$, 'AC-007 a 0% year keeps an exact zero and the other year carries the whole total');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"0","FY28":"100"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"0.01","method":"percent_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"100.00","method":"percent_by_year","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not follow its percentage inputs (year FY27)',
  'AC-007 a nonzero amount on a 0% year is refused even though the total still reconciles');

-- Budget-wide amount vectors are proportions: 1:2 of 100.01 floors to 33.33/66.67, and the remaining
-- cent follows the larger remainder (year one).
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'amount_by_year',
  '{"FY27":"1.00","FY28":"2.00"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"33.34","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"66.67","method":"amount_by_year","is_override":false}]'::jsonb
)$$, 'AC-007 proportional amounts place the remaining cent by largest remainder');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'amount_by_year',
  '{"FY27":"1.00","FY28":"2.00"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"33.33","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"66.68","method":"amount_by_year","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not follow its amount proportions (year FY27)',
  'AC-007 a proportional split with the cent on the wrong year is refused');

-- A category amount override is its entered figures, verbatim.
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"100","FY28":"0"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"60.01","method":"amount_by_year","is_override":true},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"40.00","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Labor":{"method":"amount_by_year","inputs":{"FY27":"60.01","FY28":"40.00"}}}'::jsonb
)$$, 'AC-007 a category amount override saves exactly its entered figures');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000050', 'percent_by_year',
  '{"FY27":"100","FY28":"0"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2028-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"40.00","method":"amount_by_year","is_override":true},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"60.01","method":"amount_by_year","is_override":true}]'::jsonb,
  '{"Labor":{"method":"amount_by_year","inputs":{"FY27":"60.01","FY28":"40.00"}}}'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not match its amount inputs (year FY27)',
  'AC-007 an amount override whose rows swap its entered years is refused');


-- ── Large-value arithmetic: PostgreSQL numeric division must not round the integer quotient. ─────
-- 99,999,999.99 spread by amount proportions 50,000,000.01 / 25,000,000.00 / 25,000,000.00. The exact
-- (S2/Hamilton) answer is 50,000,000.00 / 25,000,000.00 / 24,999,999.99 because the first two years
-- receive the two largest remainders; a rounded before-trunc division hands the first year a cent from
-- the largest-remainder step as well.
insert into budget_versions (id, org_id, project_id, version, name, status, budget_mode)
values ('14732222-0000-0000-0000-000000000060', '14730000-0000-0000-0000-000000000001',
        '14731111-0000-0000-0000-000000000001', 60, 'Large Value Draft', 'Draft', 'whole_project');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount)
values ('14730000-0000-0000-0000-000000000001', '14732222-0000-0000-0000-000000000060', 'Labor', 'Large total', 99999999.99, 0);
select lives_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000060', 'amount_by_year',
  '{"FY27":"50000000.01","FY28":"25000000.00","FY29":"25000000.00"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2029-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"},{"name":"FY29","start":"2029-01-01","end":"2029-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"50000000.00","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"25000000.00","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY29","ordinal":2,"amount":"24999999.99","method":"amount_by_year","is_override":false}]'::jsonb
)$$, 'AC-007 a large proportional split follows the exact Hamilton result, not a rounded quotient');
select throws_ok($$select public.save_budget_distribution(
  '14732222-0000-0000-0000-000000000060', 'amount_by_year',
  '{"FY27":"50000000.01","FY28":"25000000.00","FY29":"25000000.00"}'::jsonb,
  '{"projectStart":"2027-01-01","projectEnd":"2029-12-31","years":[{"name":"FY27","start":"2027-01-01","end":"2027-12-31"},{"name":"FY28","start":"2028-01-01","end":"2028-12-31"},{"name":"FY29","start":"2029-01-01","end":"2029-12-31"}]}'::jsonb,
  '[{"category":"Labor","fiscal_year":"FY27","ordinal":0,"amount":"49999999.99","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY28","ordinal":1,"amount":"25000000.01","method":"amount_by_year","is_override":false},{"category":"Labor","fiscal_year":"FY29","ordinal":2,"amount":"24999999.99","method":"amount_by_year","is_override":false}]'::jsonb
)$$, 'P0001', 'budget distribution for Labor has rows that do not follow its amount proportions (year FY27)',
  'AC-007 a cent moved between large-value years is refused');

reset role;
select * from finish();
rollback;
