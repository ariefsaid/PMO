-- 2162_org_setup_workflow_settings.sql — per-organisation opt-in for the new setup screens and import.
-- An absent row is off; every existing organisation stays off until an Admin opts in.
-- Reverse: supabase/migrations/rollback/2162_org_setup_workflow_settings_down.sql.

create table public.org_setup_workflow_settings (
  org_id uuid primary key default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  enabled boolean not null default false
);

alter table public.org_setup_workflow_settings enable row level security;
alter table public.org_setup_workflow_settings force row level security;

create policy org_setup_workflow_settings_select on public.org_setup_workflow_settings
  for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy org_setup_workflow_settings_insert on public.org_setup_workflow_settings
  for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

create policy org_setup_workflow_settings_update on public.org_setup_workflow_settings
  for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

revoke all on public.org_setup_workflow_settings from public, anon, authenticated;
grant select on public.org_setup_workflow_settings to authenticated;
grant insert (enabled), update (enabled) on public.org_setup_workflow_settings to authenticated;

comment on table public.org_setup_workflow_settings is
  'An Admin-controlled, default-off organisation switch for the work-order import and opening-balances overview.';
