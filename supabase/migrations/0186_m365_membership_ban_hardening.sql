-- 0186_m365_membership_ban_hardening.sql — close the raw-ban gap on M365 callback writes and
-- classify membership states without weakening profiles_select.
--
-- The caller-JWT profiles read is intentionally hidden for disabled/banned users by 0063. The
-- service-only membership RPC supplies the verified actor's state to the edge function; the same
-- actor-aware active-member helper is used by the connection write guard. A direct auth.users ban
-- also purges transient PKCE credentials and stored connections, just like offboarding.
-- Reversibility: supabase db reset. Manual reverse is dropping the new functions/triggers and
-- restoring the 0114 write-guard body.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Service-side state classifier (no authenticated/anon execute grant).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.m365_membership_state(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_org_id uuid;
  v_role text;
  v_status text;
  v_banned_until timestamptz;
begin
  select p.org_id, p.role::text, p.status::text, u.banned_until
    into v_org_id, v_role, v_status, v_banned_until
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = p_user_id;

  if not found then
    return jsonb_build_object('state', 'missing', 'org_id', null, 'role', null);
  end if;
  if v_banned_until is not null and v_banned_until > now() then
    return jsonb_build_object('state', 'banned', 'org_id', v_org_id, 'role', v_role);
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('state', 'disabled', 'org_id', v_org_id, 'role', v_role);
  end if;
  return jsonb_build_object('state', 'active', 'org_id', v_org_id, 'role', v_role);
end;
$$;

revoke all on function public.m365_membership_state(uuid) from public, anon, authenticated;
grant execute on function public.m365_membership_state(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The write guard must enforce the complete active-member rule, including raw bans.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A direct auth.users ban is a lifecycle transition for M365 credentials too.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.m365_auth_ban_trigger() returns trigger
  language plpgsql security definer set search_path = public, auth as $$
begin
  -- Ban (including a repeated write to a future timestamp) is self-repairing; unban never deletes
  -- anything because the connection must be re-established explicitly.
  if NEW.banned_until is not null and NEW.banned_until > now()
     and (OLD.banned_until is distinct from NEW.banned_until) then
    perform public._m365_disconnect_cascade_core(null, NEW.id, 'offboard', auth.uid());
  end if;
  return new;
end $$;

revoke all on function public.m365_auth_ban_trigger() from public;
drop trigger if exists m365_auth_ban_trigger on auth.users;
create trigger m365_auth_ban_trigger
after update of banned_until on auth.users
for each row
execute function public.m365_auth_ban_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bound outstanding abandoned OAuth states per user. The advisory lock makes the count + insert
--    decision serializable for concurrent initiate_connect calls; requestRateGuard is the first
--    line and this trigger is the durable cap when that availability guard fails open.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.m365_pkce_state_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_outstanding int;
begin
  perform pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 365185));
  delete from public.m365_pkce_states
   where user_id = NEW.user_id and expires_at < now();
  select count(*)::int into v_outstanding
    from public.m365_pkce_states
   where user_id = NEW.user_id;
  if v_outstanding >= 5 then
    raise exception 'm365_pkce_state_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.m365_pkce_state_cap() from public;
drop trigger if exists m365_pkce_state_cap_trigger on public.m365_pkce_states;
create trigger m365_pkce_state_cap_trigger
before insert on public.m365_pkce_states
for each row
execute function public.m365_pkce_state_cap();
