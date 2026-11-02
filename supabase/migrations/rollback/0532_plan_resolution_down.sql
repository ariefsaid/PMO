-- Reverse 0532_plan_resolution.sql. No feature rows are deleted; 0531 owns the new catalog data.
drop trigger if exists org_features_plan_audit on public.org_features;

-- Restore the pre-0532 readers before dropping the private shared resolver.
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
revoke all on function public.org_has_feature(uuid, text) from public, anon, service_role;
grant execute on function public.org_has_feature(uuid, text) to authenticated;

create or replace function public.org_feature_enabled(p_org_id uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org_id is null
     or p_org_id is distinct from public.auth_org_id()
     or not public.is_active_member() then
    return false;
  end if;
  return case when p_key in ('projects','dashboard','approvals','administration') then true
              else coalesce((select enabled from public.org_features
                              where org_id = p_org_id and feature_key = p_key), true)
             end;
end $$;
revoke all on function public.org_feature_enabled(uuid, text) from public, anon, service_role;
grant execute on function public.org_feature_enabled(uuid, text) to authenticated;

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
revoke all on function public.operator_toggle_feature(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.operator_toggle_feature(uuid, text, boolean) to authenticated;

-- Drop API projections and writers before their private dependencies.
drop function if exists public.service_resolved_org_features(uuid);
drop function if exists public.operator_resolved_org_features(uuid);
drop function if exists public.resolved_org_features();
drop function if exists public.operator_set_org_plan(uuid, text);
drop function if exists public.operator_set_global_feature(text, boolean);
drop function if exists public.operator_clear_feature_override(uuid, text);
drop function if exists public.operator_set_plan_feature(text, text, boolean);
drop function if exists public.operator_set_plan_limits(text, integer, integer, integer);
drop function if exists public.resolve_feature_internal(uuid, text);
drop function if exists public.assert_switchable_feature_key(text);
drop function if exists public.assert_active_operator();
drop function if exists public.audit_org_feature_change();

-- Restore the pre-0532 Operator table policy and the captured 0075 grants.
drop policy if exists org_features_write on public.org_features;
create policy org_features_write on public.org_features for all
  using (public.is_operator() and public.is_active_member())
  with check (public.is_operator() and public.is_active_member());

grant insert, update, delete, truncate on public.org_features to service_role;
grant truncate on public.org_features to anon, authenticated;

notify pgrst, 'reload schema';
