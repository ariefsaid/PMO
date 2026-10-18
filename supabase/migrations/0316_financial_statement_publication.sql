-- 0316 — immutable financial-statement publication rows and direct-read privacy contract.
-- Rollback: rollback/0316_financial_statement_publication_down.sql
create table public.erp_financial_statement_snapshot (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references public.organizations(id) on delete cascade,
  company text not null check (btrim(company) <> ''),
  snapshot_id uuid not null,
  source_generation uuid not null,
  statement text not null check (statement in ('trial_balance', 'profit_and_loss', 'balance_sheet')),
  scope_kind text not null check (scope_kind in ('company', 'project', 'unassigned')),
  project_id uuid references public.projects(id) on delete cascade,
  view_kind text not null check (view_kind in ('account_breakdown', 'project_totals')),
  period_kind text not null check (period_kind in ('month', 'quarter', 'fiscal_year')),
  current_start date not null,
  current_end date not null,
  prior_start date not null,
  prior_end date not null,
  currency text not null check (currency = 'IDR'),
  as_of timestamptz not null,
  source_report text,
  report_version text,
  filters jsonb,
  settings jsonb,
  payload jsonb not null,
  has_activity boolean not null,
  display_precision integer not null check (display_precision between 0 and 9),
  display_rounding_method text not null check (
    display_rounding_method in (
      'Banker''s Rounding',
      'Banker''s Rounding (legacy)',
      'Commercial Rounding'
    )
  ),
  constraint erp_financial_statement_snapshot_period_range_check
    check (current_start <= current_end and prior_start <= prior_end),
  constraint erp_financial_statement_snapshot_project_scope_check
    check ((scope_kind = 'project') = (project_id is not null)),
  constraint erp_financial_statement_snapshot_scope_view_check
    check (
      (scope_kind = 'company' and view_kind = 'account_breakdown')
      or (scope_kind = 'unassigned' and statement = 'profit_and_loss' and view_kind = 'account_breakdown')
      or (scope_kind = 'project' and statement = 'profit_and_loss'
          and view_kind in ('account_breakdown', 'project_totals'))
    ),
  constraint erp_financial_statement_snapshot_detail_payload_check
    check (
      case
        when view_kind <> 'account_breakdown' then true
        when jsonb_typeof(payload) is distinct from 'object' then false
        when not (payload ? 'rows') then false
        when (payload - array['rows']) <> '{}'::jsonb then false
        when jsonb_typeof(payload->'rows') is distinct from 'array' then false
        else true
      end is true
    ),
  constraint erp_financial_statement_snapshot_totals_payload_check
    check (
      case
        when view_kind <> 'project_totals' then true
        when jsonb_typeof(payload) is distinct from 'object' then false
        when not (payload ?& array['current', 'prior']) then false
        when (payload - array['current', 'prior']) <> '{}'::jsonb then false
        when jsonb_typeof(payload->'current') is distinct from 'object' then false
        when not ((payload->'current') ?& array['income', 'expense', 'net']) then false
        when ((payload->'current') - array['income', 'expense', 'net']) <> '{}'::jsonb then false
        when jsonb_typeof(payload->'prior') is distinct from 'object' then false
        when not ((payload->'prior') ?& array['income', 'expense', 'net']) then false
        when ((payload->'prior') - array['income', 'expense', 'net']) <> '{}'::jsonb then false
        when jsonb_typeof(payload->'current'->'income') is distinct from 'string' then false
        when jsonb_typeof(payload->'current'->'expense') is distinct from 'string' then false
        when jsonb_typeof(payload->'current'->'net') is distinct from 'string' then false
        when jsonb_typeof(payload->'prior'->'income') is distinct from 'string' then false
        when jsonb_typeof(payload->'prior'->'expense') is distinct from 'string' then false
        when jsonb_typeof(payload->'prior'->'net') is distinct from 'string' then false
        when (payload->'current'->>'income') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when (payload->'current'->>'expense') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when (payload->'current'->>'net') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when (payload->'prior'->>'income') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when (payload->'prior'->>'expense') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        when (payload->'prior'->>'net') !~ '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' then false
        else source_report is null and report_version is null and filters is null and settings is null
      end is true
    ),
  constraint erp_financial_statement_snapshot_scope_period_unique
    unique nulls not distinct
      (org_id, company, statement, scope_kind, project_id, view_kind,
       period_kind, current_start, current_end, prior_start, prior_end)
);

create index erp_financial_statement_snapshot_lookup_idx
  on public.erp_financial_statement_snapshot
    (org_id, company, period_kind, current_start, statement, view_kind, project_id);

create trigger erp_financial_statement_snapshot_stamp_org_id
  before insert on public.erp_financial_statement_snapshot
  for each row execute function public.stamp_org_id();

alter table public.erp_financial_statement_snapshot enable row level security;
alter table public.erp_financial_statement_snapshot force row level security;

create policy erp_financial_statement_snapshot_select
  on public.erp_financial_statement_snapshot
  for select to authenticated
  using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and (
      public.auth_role() in ('Admin', 'Finance', 'Executive')
      or (
        public.auth_role() in ('Project Manager', 'Engineer')
        and scope_kind = 'project'
        and view_kind = 'project_totals'
        and exists (
          select 1
            from public.projects p
           where p.id = erp_financial_statement_snapshot.project_id
             and p.org_id = public.auth_org_id()
        )
      )
    )
  );

revoke all on public.erp_financial_statement_snapshot from public, anon, authenticated, service_role;
grant select on public.erp_financial_statement_snapshot to authenticated;
grant select, insert, update, delete on public.erp_financial_statement_snapshot to service_role;
