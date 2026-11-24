-- Move management views out of plan entitlements into an organisation setting.
begin;

delete from public.org_features where feature_key = 'management_views';
delete from public.plan_features where feature_key = 'management_views';
delete from public.global_features where feature_key = 'management_views';

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in (
    'incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant',
    'user_views', 'm365_integration', 'revenue', 'feedback_surveys', 'sales_pipeline',
    'procurement_full', 'sales_invoices', 'budget_projection', 'imprest', 'clickup_sync',
    'erp_sync', 'erp_purchases', 'financial_statements', 'management_pack', 'budget_phasing',
    'multi_currency', 'stock', 'api_access', 'sso'
  ));

alter table public.plan_features drop constraint plan_features_feature_key_check;
alter table public.plan_features add constraint plan_features_feature_key_check
  check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
    'feedback_surveys'
  ));

alter table public.global_features drop constraint global_features_feature_key_check;
alter table public.global_features add constraint global_features_feature_key_check
  check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant'
  ));

alter table public.organizations add column management_views_enabled boolean not null default false;
grant update (management_views_enabled) on public.organizations to authenticated;
create trigger organizations_audit_management_views after update on public.organizations
  for each row execute function public.audit_org_setting_change('management_views_enabled');

commit;
