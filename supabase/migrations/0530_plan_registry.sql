-- 0530_plan_registry.sql — private storage for the plan and entitlement matrix.
-- Writes and service reads use narrowly granted RPCs added by 0532; API roles have no table path.

create table public.plans (
  id                    text primary key,
  name                  text not null unique,
  seat_limit            integer,
  project_limit         integer,
  ai_monthly_messages   integer,
  constraint plans_id_check check (id in ('starter', 'growth', 'pro', 'enterprise')),
  constraint plans_seat_limit_nonnegative check (seat_limit is null or seat_limit >= 0),
  constraint plans_project_limit_nonnegative check (project_limit is null or project_limit >= 0),
  constraint plans_ai_monthly_messages_nonnegative check
    (ai_monthly_messages is null or ai_monthly_messages >= 0)
);

create table public.plan_features (
  plan_id     text not null references public.plans(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
    'feedback_surveys'
  )),
  enabled     boolean not null,
  primary key (plan_id, feature_key)
);
create index plan_features_feature_idx on public.plan_features (feature_key);

create table public.org_plans (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  plan_id    text not null references public.plans(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create index org_plans_plan_idx on public.org_plans (plan_id);

create table public.global_features (
  feature_key text primary key check (feature_key in (
    'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
    'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
    'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
    'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
    'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant'
  )),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.plan_features enable row level security;
alter table public.plan_features force row level security;
alter table public.org_plans enable row level security;
alter table public.org_plans force row level security;
alter table public.global_features enable row level security;
alter table public.global_features force row level security;

-- No policies: even service_role uses service_resolved_org_features rather than table grants.
revoke all on table public.plans, public.plan_features, public.org_plans, public.global_features
  from public, anon, authenticated, service_role;
