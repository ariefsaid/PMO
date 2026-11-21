-- 1290 — approval amount tiers: the setting and the tier amount (#2695).
-- Spec: docs/specs/approval-amount-tiers.spec.md · Plan: docs/plans/2026-11-21-approval-amount-tiers.md
-- Proven by supabase/tests/spend_approval_tiers.test.sql. Rollback: rollback/1290_approval_tiers_settings_down.sql.
--
-- §1 spend_approval_settings: one row per organisation, `tiers_enabled` default false (no row = off). Admin-only writes by
--    RLS and column grants; the audit trigger records every change.
-- §2 spend_approvers.min_amount: the tier an approver sits in (NULL = base tier). Insert-only like the rest of the table.
-- §3 the spend_approver.add audit row carries min_amount.

create table public.spend_approval_settings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null unique references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  tiers_enabled boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) default auth.uid()
);

create trigger spend_approval_settings_stamp_org_id
  before insert on public.spend_approval_settings
  for each row execute function public.stamp_org_id();

create function public.touch_spend_approval_settings() returns trigger
  language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;
revoke all on function public.touch_spend_approval_settings() from public, anon, authenticated;
create trigger spend_approval_settings_touch
  before update on public.spend_approval_settings
  for each row execute function public.touch_spend_approval_settings();

alter table public.spend_approval_settings enable row level security;
alter table public.spend_approval_settings force  row level security;

create policy spend_approval_settings_select on public.spend_approval_settings for select
  using (org_id = (select auth_org_id()) and (select public.is_active_member()));
create policy spend_approval_settings_insert on public.spend_approval_settings for insert
  with check (org_id = (select auth_org_id()) and (select public.is_active_member()) and (select auth_role()) = 'Admin');
create policy spend_approval_settings_update on public.spend_approval_settings for update
  using      (org_id = (select auth_org_id()) and (select public.is_active_member()) and (select auth_role()) = 'Admin')
  with check (org_id = (select auth_org_id()) and (select public.is_active_member()) and (select auth_role()) = 'Admin');

revoke all on public.spend_approval_settings from anon, authenticated;
grant select on public.spend_approval_settings to authenticated;
grant insert (tiers_enabled) on public.spend_approval_settings to authenticated;
grant update (tiers_enabled) on public.spend_approval_settings to authenticated;

create function public.audit_spend_approval_settings_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('spend_approval_tiers.change', new.org_id, auth.uid(), new.id,
    jsonb_build_object('from', case when tg_op = 'UPDATE' then old.tiers_enabled else false end,
                       'to', new.tiers_enabled));
  return new;
end; $$;
revoke all on function public.audit_spend_approval_settings_change() from public, anon, authenticated;
create trigger spend_approval_settings_audit
  after insert or update on public.spend_approval_settings
  for each row execute function public.audit_spend_approval_settings_change();

comment on table public.spend_approval_settings is
  'Approval settings per organisation (#2695). tiers_enabled (default false): narrow each approver list to the tier of the request amount. No row = off.';

-- §2
alter table public.spend_approvers
  add column min_amount numeric constraint spend_approvers_min_amount_nonneg check (min_amount >= 0);
comment on column public.spend_approvers.min_amount is
  'The tier this approver sits in: the request amount from which they decide. NULL = the base tier (0). Ignored while spend_approval_settings.tiers_enabled is false.';
grant insert (project_id, profile_id, min_amount) on public.spend_approvers to authenticated;

-- §3 (0243's trigger function, one more key in the add row)
create or replace function public.audit_spend_approver_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('spend_approver.add', new.org_id, auth.uid(), new.id,
      jsonb_build_object('project_id', new.project_id, 'profile_id', new.profile_id, 'min_amount', new.min_amount));
    return new;
  end if;
  perform public.log_audit('spend_approver.remove', old.org_id, auth.uid(), old.id,
    jsonb_build_object('project_id', old.project_id, 'profile_id', old.profile_id));
  return old;
end; $$;
revoke all on function public.audit_spend_approver_change() from public, anon, authenticated;
