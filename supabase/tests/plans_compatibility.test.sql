-- AC-PLN-016 [pgTAP]: the plan registry exists with its documented schema and default-deny posture.
begin;
create extension if not exists pgtap;
select plan(36);

select has_table('public', 'plans', 'plan registry table exists');
select has_column('public', 'plans', 'id', 'plans.id exists');
select has_column('public', 'plans', 'name', 'plans.name exists');
select has_column('public', 'plans', 'seat_limit', 'plans.seat_limit exists');
select has_column('public', 'plans', 'project_limit', 'plans.project_limit exists');
select has_column('public', 'plans', 'ai_monthly_messages', 'plans.ai_monthly_messages exists');

select has_table('public', 'plan_features', 'plan feature table exists');
select has_column('public', 'plan_features', 'plan_id', 'plan_features.plan_id exists');
select has_column('public', 'plan_features', 'feature_key', 'plan_features.feature_key exists');
select has_column('public', 'plan_features', 'enabled', 'plan_features.enabled exists');

select has_table('public', 'org_plans', 'org plan assignment table exists');
select has_column('public', 'org_plans', 'org_id', 'org_plans.org_id exists');
select has_column('public', 'org_plans', 'plan_id', 'org_plans.plan_id exists');

select has_table('public', 'global_features', 'global feature table exists');
select has_column('public', 'global_features', 'feature_key', 'global_features.feature_key exists');
select has_column('public', 'global_features', 'enabled', 'global_features.enabled exists');

select is(
  (select count(*)::int from pg_class
    where oid in (to_regclass('public.plans'), to_regclass('public.plan_features'),
                  to_regclass('public.org_plans'), to_regclass('public.global_features'))
      and relrowsecurity and relforcerowsecurity),
  4,
  'all registry tables have forced row-level security');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('plans', 'plan_features', 'org_plans', 'global_features')),
  0,
  'registry tables have no client policies');
select is(
  (select count(*)::int from pg_constraint
    where conrelid in (to_regclass('public.plans'), to_regclass('public.plan_features'),
                       to_regclass('public.org_plans'), to_regclass('public.global_features'))
      and contype = 'p'),
  4,
  'each registry table has a primary key');
select is(
  (select count(*)::int from pg_constraint
    where conrelid in (to_regclass('public.plans'), to_regclass('public.plan_features'),
                       to_regclass('public.org_plans'), to_regclass('public.global_features'))
      and contype = 'f'),
  5,
  'plan assignments, feature rows and audit actors have explicit foreign keys');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = to_regclass('public.plans') and contype = 'u'),
  1,
  'plan names are unique');
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public'
      and indexname in ('plan_features_feature_idx', 'org_plans_plan_idx')),
  2,
  'plan feature and plan assignment lookup indexes exist');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('plans', 'plan_features', 'org_plans', 'global_features')
      and grantee in ('anon', 'authenticated', 'service_role')),
  0,
  'registry tables expose no direct table privileges to API roles');

-- AC-PLN-016: the catalog is entirely data-driven and matches the tier matrix.
select is((select count(*)::int from public.plans), 4,
  'exactly the four named plans are seeded');
select is((select count(*)::int from public.plan_features), 100,
  'all 25 catalog keys have a row for each of four plans');
select results_eq(
  $$ select plan_id, feature_key, enabled from public.plan_features order by plan_id, feature_key $$,
  $$ select p.plan_id, f.feature_key, (p.tier >= f.min_tier)
       from (values ('starter'::text, 1), ('growth'::text, 2), ('pro'::text, 3), ('enterprise'::text, 4)) p(plan_id, tier)
       cross join (values
         ('timesheets'::text, 1), ('crm', 1), ('procurement', 1), ('sales_invoices', 1),
         ('incidents', 1), ('import_export', 1), ('agent_assistant', 1), ('feedback_surveys', 1),
         ('sales_pipeline', 2), ('procurement_full', 2), ('revenue', 2), ('budget_projection', 2),
         ('imprest', 2), ('user_views', 2), ('m365_integration', 2), ('clickup_sync', 2),
         ('erp_sync', 3), ('erp_purchases', 3), ('financial_statements', 3), ('management_pack', 3),
         ('budget_phasing', 3), ('multi_currency', 3), ('stock', 3), ('api_access', 3), ('sso', 4)
       ) f(feature_key, min_tier)
       order by p.plan_id, f.feature_key $$,
  'the seeded plan matrix matches the tier decisions exactly');
select results_eq(
  $$ select feature_key, enabled from public.global_features order by feature_key $$,
  $$ select feature_key, true from (values
       ('timesheets'::text), ('crm'), ('sales_pipeline'), ('procurement'), ('procurement_full'),
       ('sales_invoices'), ('revenue'), ('budget_projection'), ('imprest'), ('user_views'),
       ('m365_integration'), ('clickup_sync'), ('erp_sync'), ('erp_purchases'),
       ('financial_statements'), ('management_pack'), ('budget_phasing'), ('multi_currency'),
       ('stock'), ('api_access'), ('sso'), ('incidents'), ('import_export'), ('agent_assistant')
     ) expected(feature_key) order by feature_key $$,
  'every global switch starts on except the Admin-owned feedback switch');
select results_eq(
  $$ select id, seat_limit, project_limit, ai_monthly_messages from public.plans order by id $$,
  $$ values ('enterprise'::text, null::integer, null::integer, null::integer),
            ('growth'::text, 25, 100, 1500),
            ('pro'::text, 50, null, 5000),
            ('starter'::text, 10, 25, 300) $$,
  'the four plan limits match their starting values');
select is((select count(*)::int from public.plan_features
  where feature_key = 'feedback_surveys' and enabled), 4,
  'the matrix retains the Admin-owned feedback key on for every tier');
select is((select count(*)::int from public.plan_features
  where feature_key in ('projects', 'dashboard', 'approvals', 'administration')),
  0, 'core keys are not switch rows');
select lives_ok($$ insert into public.organizations (id, name)
    values ('05310000-0000-0000-0000-000000000001', 'Plans Compatibility Fixture') $$,
  'compatibility fixture organization is available');
select lives_ok($$ insert into public.org_features (org_id, feature_key, enabled)
    values ('05310000-0000-0000-0000-000000000001', 'stock', true) $$,
  'AC-PLN-004 the override table accepts newly catalogued keys');

-- The Director ruling uses an inline 0070 reference expression instead of an upgrade harness.
insert into public.organizations (id, name) values
  ('05310000-0000-0000-0000-000000000002', 'Plans Compatibility Explicit On'),
  ('05310000-0000-0000-0000-000000000003', 'Plans Compatibility ERP Absent'),
  ('05310000-0000-0000-0000-000000000004', 'Plans Compatibility ERP Override'),
  ('05310000-0000-0000-0000-000000000005', 'Plans Compatibility Native Off');
insert into public.org_features (org_id, feature_key, enabled) values
  ('05310000-0000-0000-0000-000000000002', 'crm', true),
  ('05310000-0000-0000-0000-000000000003', 'crm', false),
  ('05310000-0000-0000-0000-000000000004', 'revenue', true),
  ('05310000-0000-0000-0000-000000000005', 'revenue', false);
insert into public.external_domain_ownership (org_id, external_tier, domain) values
  ('05310000-0000-0000-0000-000000000003', 'erpnext', 'revenue'),
  ('05310000-0000-0000-0000-000000000004', 'erpnext', 'revenue');

select is((
  with cases(org_id, feature_key) as (values
    ('05310000-0000-0000-0000-000000000001'::uuid, 'crm'::text),
    ('05310000-0000-0000-0000-000000000002'::uuid, 'crm'::text),
    ('05310000-0000-0000-0000-000000000003'::uuid, 'crm'::text)
  )
  select count(*)::int
    from cases c
    cross join lateral public.resolve_feature_internal(c.org_id, c.feature_key) r
   where r.enabled is distinct from case
     when c.feature_key in ('projects', 'dashboard', 'approvals', 'administration') then true
     else coalesce((select f.enabled from public.org_features f
                     where f.org_id = c.org_id and f.feature_key = c.feature_key), true)
   end
), 0, 'AC-PLN-016 the new entitlement value matches 0070 CASE for absent, explicit-on and explicit-off rows');
select is((
  with cases(org_id, feature_key) as (values
    ('05310000-0000-0000-0000-000000000003'::uuid, 'revenue'::text),
    ('05310000-0000-0000-0000-000000000004'::uuid, 'revenue'::text),
    ('05310000-0000-0000-0000-000000000005'::uuid, 'revenue'::text),
    ('05310000-0000-0000-0000-000000000001'::uuid, 'revenue'::text)
  )
  select count(*)::int
    from cases c
    cross join lateral public.resolve_feature_internal(c.org_id, c.feature_key) r
   where r.display_enabled is distinct from case
     when exists (select 1 from public.org_features f
                   where f.org_id = c.org_id and f.feature_key = c.feature_key)
       then (select f.enabled from public.org_features f
              where f.org_id = c.org_id and f.feature_key = c.feature_key)
     else not exists (select 1 from public.external_domain_ownership d
                       where d.org_id = c.org_id and d.domain = 'revenue')
   end
), 0, 'AC-PLN-016 revenue display matches the prior FE ownership default and explicit row rule');
select is((select enabled from public.resolve_feature_internal(
    '05310000-0000-0000-0000-000000000003', 'revenue')),
  true, 'AC-PLN-016 ERP ownership changes revenue display only, not policy entitlement');
select is((select count(*)::int from public.org_features
  where (org_id, feature_key, enabled) in (
    ('05310000-0000-0000-0000-000000000001'::uuid, 'stock', true),
    ('05310000-0000-0000-0000-000000000002'::uuid, 'crm', true),
    ('05310000-0000-0000-0000-000000000003'::uuid, 'crm', false),
    ('05310000-0000-0000-0000-000000000004'::uuid, 'revenue', true),
    ('05310000-0000-0000-0000-000000000005'::uuid, 'revenue', false)
  )), 5, 'AC-PLN-016 the resolver leaves explicit fixture overrides intact');

select * from finish();
rollback;
