-- 0070_org_features.sql — org_features (FR-ENT-001..004, ops-admin-surface S6, ADR-0049).
-- PK (org_id, feature_key); CHECK registry of gatable feature keys; core-never-gated guard at
-- insert. RLS: read = every member of the org (entitlements are not intra-org secrets → useFeature
-- reads directly, AC-ENT-001 FLIPS the 2026-06-15 admin-write note); write = Operator-only via
-- operator_toggle_feature (no UPDATE/DELETE for anyone → append-only-by-omission for everyone else).
-- org_has_feature() ships as the FUTURE server-enforcement hook ONLY (unused by FE; unused by
-- gated-table RLS — UI-first bypass accepted v1, ADR-0049). operator_toggle_feature writes it.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.operator_toggle_feature(uuid,text,boolean);
--   drop function if exists public.org_has_feature(uuid,text);
--   drop policy if exists org_features_select on public.org_features;
--   drop policy if exists org_features_write on public.org_features;
--   drop table if exists public.org_features;

create table public.org_features (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  primary key (org_id, feature_key),
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views'))   -- gated candidates (FR-ENT-001); core set excluded
);
create index org_features_org_idx on public.org_features (org_id);

alter table public.org_features enable row level security;
alter table public.org_features force  row level security;

-- READ: every member of the org (entitlements are not intra-org secrets → useFeature reads directly).
create policy org_features_select on public.org_features for select
  using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: Operator-only (the flip). No UPDATE-via-Admin, no DELETE for anyone — the RPC is the
-- sole write path. The table is `force row level security`, so the table OWNER (which runs the
-- security-definer operator_toggle_feature) is ITSELF subject to RLS — this FOR ALL policy is what
-- permits the RPC's INSERT/UPDATE (without it, the owner-bypassed-by-force-RLS would deny the
-- write). A non-Operator caller is denied both here and inside the RPC (defense-in-depth).
-- NB: no `org_id in (organizations)` subquery here — that subquery runs UNDER RLS, so the
-- Operator would only "see" their home org and the cross-org write path would break. The FK on
-- org_id already rejects a nonexistent-org insert, and operator_toggle_feature re-validates org
-- existence (security-definer).
create policy org_features_write on public.org_features for all
  using (public.is_operator() and public.is_active_member())
  with check (public.is_operator() and public.is_active_member());

-- org_has_feature: core keys always true; else the row's enabled (absence = included = true).
-- FUTURE server-enforcement hook ONLY (not used by FE, not yet used by gated-table RLS).
-- Guards (security review L1 / code review I2): the fn is security-definer + granted to
-- `authenticated`, so it must re-assert org membership + active status itself — relying on the
-- table's RLS would (a) make p_org_id a lie (the inner SELECT is silently scoped to auth_org_id())
-- and (b) leak entitlement state to any caller probing another org. Mirrors org_credit_balance.
create or replace function public.org_has_feature(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if p_org_id is null or p_org_id <> public.auth_org_id() then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  return case when p_key in ('projects','dashboard','approvals','administration') then true
              else coalesce((select enabled from public.org_features
                              where org_id = p_org_id and feature_key = p_key), true)
             end;
end $$;

-- operator_toggle_feature: upsert a row; reject core keys; assert Operator + org exists.
-- is_active_member() entry guard (security review M1): see org_credit_balance / 0067.
create or replace function public.operator_toggle_feature(
  p_org_id uuid, p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  if p_key in ('projects','dashboard','approvals','administration') then
    raise exception 'core_not_gatable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'unknown_org' using errcode = '23503';
  end if;
  insert into public.org_features (org_id, feature_key, enabled, updated_by)
    values (p_org_id, p_key, p_enabled, auth.uid())
  on conflict (org_id, feature_key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function public.org_has_feature(uuid,text) from public;
grant execute on function public.org_has_feature(uuid,text) to authenticated;
revoke all on function public.operator_toggle_feature(uuid,text,boolean) from public;
grant execute on function public.operator_toggle_feature(uuid,text,boolean) to authenticated;
