-- 1255_idle_cost_settings.sql — #2673 idle hours turned into cost (docs/specs/idle-hours-cost.spec.md).
-- One switch per organisation, OFF by default (no row = off). It takes effect only while labour cost in money (1250) is
-- also on. Read by every active member of the org; written only through save_idle_cost_setting (Admin, Finance).
-- org_id is stamped by default, never sent by the client. Proven by supabase/tests/1255_idle_cost.test.sql.
-- Reverse: supabase/migrations/rollback/1255_idle_cost_settings_down.sql.
create table public.idle_cost_settings (
  org_id     uuid primary key default public.auth_org_id() references public.organizations(id) on delete cascade,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.idle_cost_settings enable row level security;
alter table public.idle_cost_settings force row level security;
create policy idle_cost_settings_select on public.idle_cost_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.idle_cost_settings from public, anon, authenticated;
grant select on public.idle_cost_settings to authenticated;
grant all on public.idle_cost_settings to service_role;

-- both switches on for an org (internal helper)
create function public.idle_cost_enabled(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.labour_cost_enabled(p_org)
     and coalesce((select s.enabled from public.idle_cost_settings s where s.org_id = p_org), false)
$$;
revoke all on function public.idle_cost_enabled(uuid) from public, anon, authenticated;

create function public.save_idle_cost_setting(p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();   -- active Admin or Finance, else 42501
begin
  perform public.assert_is_active_member();
  if p_enabled is null then raise exception 'enabled is required' using errcode = '22023'; end if;
  insert into public.idle_cost_settings (org_id, enabled, updated_by) values (v_org, p_enabled, auth.uid())
    on conflict (org_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.save_idle_cost_setting(boolean) from public, anon;
grant execute on function public.save_idle_cost_setting(boolean) to authenticated;
