-- 0531_plan_catalogue.sql — the initial plan matrix and global switch state.
-- New plan data is seed data; org_features remains the independent per-org override store.

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in (
    'incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant',
    'user_views', 'm365_integration', 'revenue', 'feedback_surveys', 'sales_pipeline',
    'procurement_full', 'sales_invoices', 'budget_projection', 'imprest', 'clickup_sync',
    'erp_sync', 'erp_purchases', 'financial_statements', 'management_pack', 'budget_phasing',
    'multi_currency', 'stock', 'api_access', 'sso'
  ));

insert into public.plans (id, name, seat_limit, project_limit, ai_monthly_messages) values
  ('starter', 'Starter', 10, 25, 300),
  ('growth', 'Growth', 25, 100, 1500),
  ('pro', 'Pro', 50, null, 5000),
  ('enterprise', 'Enterprise', null, null, null);

with plan_tiers(plan_id, tier) as (
  values ('starter'::text, 1), ('growth'::text, 2), ('pro'::text, 3), ('enterprise'::text, 4)
), feature_tiers(feature_key, minimum_tier) as (
  values
    ('timesheets'::text, 1), ('crm', 1), ('procurement', 1), ('sales_invoices', 1),
    ('incidents', 1), ('import_export', 1), ('agent_assistant', 1), ('feedback_surveys', 1),
    ('sales_pipeline', 2), ('procurement_full', 2), ('revenue', 2), ('budget_projection', 2),
    ('imprest', 2), ('user_views', 2), ('m365_integration', 2), ('clickup_sync', 2),
    ('erp_sync', 3), ('erp_purchases', 3), ('financial_statements', 3), ('management_pack', 3),
    ('budget_phasing', 3), ('multi_currency', 3), ('stock', 3), ('api_access', 3),
    ('sso', 4)
)
insert into public.plan_features (plan_id, feature_key, enabled)
select p.plan_id, f.feature_key, p.tier >= f.minimum_tier
  from plan_tiers p cross join feature_tiers f;

insert into public.global_features (feature_key, enabled) values
  ('timesheets', true), ('crm', true), ('sales_pipeline', true), ('procurement', true),
  ('procurement_full', true), ('sales_invoices', true), ('revenue', true),
  ('budget_projection', true), ('imprest', true), ('user_views', true),
  ('m365_integration', true), ('clickup_sync', true), ('erp_sync', true),
  ('erp_purchases', true), ('financial_statements', true), ('management_pack', true),
  ('budget_phasing', true), ('multi_currency', true), ('stock', true), ('api_access', true),
  ('sso', true), ('incidents', true), ('import_export', true), ('agent_assistant', true);

-- Existing orgs resolve to Enterprise without rewriting any old override rows. Later orgs without
-- an explicit assignment resolve to Enterprise through the resolver fallback in 0532.
insert into public.org_plans (org_id, plan_id)
select o.id, 'enterprise'
  from public.organizations o
on conflict (org_id) do nothing;
