-- 0816_m365_entitlement_resolved.sql — the M365 connection write guard follows the RESOLVED plan
-- switch (#1017 S1). 0186 read the raw org_features override row, so an org whose plan includes
-- M365 but has no override row was refused. The entitlement is now resolve_feature_internal
-- (global switch → per-org override → plan), the same answer the edge gate and setup actions use.
-- An operator override of enabled=false still wins and still purges connections (0109 cascade).
-- Lock order is unchanged (profiles → org_features → connections): the org_features row is still
-- locked FOR UPDATE when one exists.
create or replace function public.m365_connection_write_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  -- Preserve 0114's parent-first lock order for direct writes as well as the 0115 RPC path.
  perform 1 from public.profiles
   where id = NEW.user_id and org_id = NEW.org_id
   for update;
  -- 0180's actor-aware helper checks profiles.status AND auth.users.banned_until. This remains the
  -- authoritative backstop after the callback's best-effort service read.
  if not public.is_active_member(NEW.user_id) then
    raise exception 'user_not_active' using errcode = '42501';
  end if;

  perform 1 from public.org_features
   where org_id = NEW.org_id and feature_key = 'm365_integration'
   for update;
  select r.enabled into v_enabled
    from public.resolve_feature_internal(NEW.org_id, 'm365_integration') r;
  if v_enabled is not true then
    raise exception 'org_not_entitled' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.m365_connection_write_guard() from public;
