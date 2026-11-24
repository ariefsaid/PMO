-- 2284: default the 24 November management-view additions off per organisation.
-- Existing views stay available; the new portfolio and unaccepted-progress surfaces require this switch.
-- Reverse: rollback/2284_management_views_feature_down.sql.
begin;
drop trigger organizations_audit_management_views on public.organizations;
revoke update (management_views_enabled) on public.organizations from authenticated;
alter table public.organizations drop column management_views_enabled;

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in (
    'incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant',
    'user_views', 'm365_integration', 'revenue', 'feedback_surveys', 'sales_pipeline',
    'procurement_full', 'sales_invoices', 'budget_projection', 'imprest', 'clickup_sync',
    'erp_sync', 'erp_purchases', 'financial_statements', 'management_pack', 'budget_phasing',
    'multi_currency', 'stock', 'api_access', 'sso', 'management_views'
  ));

alter table public.plan_features drop constraint plan_features_feature_key_check;
alter table public.plan_features add constraint plan_features_feature_key_check
  check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
    'feedback_surveys', 'management_views'
  ));

alter table public.global_features drop constraint global_features_feature_key_check;
alter table public.global_features add constraint global_features_feature_key_check
  check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
    'management_views'
  ));

insert into public.plan_features (plan_id, feature_key, enabled) values
  ('starter', 'management_views', false),
  ('growth', 'management_views', false),
  ('pro', 'management_views', false),
  ('enterprise', 'management_views', false)
on conflict (plan_id, feature_key) do nothing;

-- Keep the platform-wide gate open so an Operator can enable selected organisations.
insert into public.global_features (feature_key, enabled)
values ('management_views', true)
on conflict (feature_key) do nothing;

commit;
