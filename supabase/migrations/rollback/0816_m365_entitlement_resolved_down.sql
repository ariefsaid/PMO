-- Rollback 0816: restore the 0186 write guard (raw org_features override row decides).
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

  select enabled into v_enabled
    from public.org_features
   where org_id = NEW.org_id and feature_key = 'm365_integration'
   for update;
  if not found or v_enabled is not true then
    raise exception 'org_not_entitled' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.m365_connection_write_guard() from public;
