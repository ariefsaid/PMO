-- 0109_m365_cascade_triggers.sql — Triggers wiring m365_disconnect_cascade to offboard/disentitlement paths.
-- Implements: AC-M365-121 (FR-M365-151, NFR-M365-107) trigger wiring + LOW-2 reason allowlist in public RPC.
-- Called by:
--   • AFTER UPDATE on profiles (status active→disabled) → offboard single user.
--   • AFTER UPDATE on org_features (m365_integration enabled→false) → disentitle org (all users).
--   • AFTER DELETE on org_features (m365_integration row removed while enabled) → disentitle org.
--   • LOW-2: public.m365_disconnect_cascade p_reason allowlist enforced at RPC entry.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop trigger if exists m365_offboard_trigger on public.profiles;
--   drop function if exists public.m365_offboard_trigger();
--   drop trigger if exists m365_disentitle_update_trigger on public.org_features;
--   drop trigger if exists m365_disentitle_delete_trigger on public.org_features;
--   drop function if exists public.m365_disentitle_trigger();
--   drop function if exists public._m365_disconnect_cascade_core(uuid, uuid, text, uuid);
--   drop function if exists public.m365_disconnect_cascade(uuid, uuid, text);

-- ============================================================================
-- 1. INTERNAL CORE — pure delete + audit, NO authz guard, trigger-safe.
--    Called by: public m365_disconnect_cascade (after its guard), profiles trigger, org_features trigger.
--    Grants: NONE (internal only; postgres owner retains implicit EXECUTE).
--    Signature: p_org_id, p_user_id (null = all users in org), p_reason (allowlisted),
--               p_actor_id (the acting user, for audit_events.actor_id).
-- ============================================================================
create or replace function public._m365_disconnect_cascade_core(
  p_org_id   uuid,
  p_user_id  uuid,      -- null = all users in org (operator disentitlement / org disable)
  p_reason   text,      -- allowlisted: 'disentitled' | 'offboard' | 'org_disabled' | 'admin_disconnect'
  p_actor_id uuid       -- the actor performing the action (auth.uid() from caller context)
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_conn_id uuid;
  v_user_id uuid;
  v_detail  jsonb;
  v_allowed_reasons constant text[] := array['disentitled','offboard','org_disabled','admin_disconnect'];
begin
  -- Reason allowlist (LOW-2): enforce in core so ALL call paths are guarded.
  if p_reason is null or p_reason <> all(v_allowed_reasons) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  if p_user_id is not null then
    -- Single user (offboard / admin_disconnect path).
    delete from public.ms_graph_connections
     where org_id = p_org_id and user_id = p_user_id
     returning id into v_conn_id;
    if found then
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', p_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, p_actor_id, v_conn_id, v_detail);
    end if;
  else
    -- All users in org (disentitled / org_disabled path).
    -- Iterate to audit each connection individually with its user_id.
    for v_conn_id, v_user_id in
      select id, user_id from public.ms_graph_connections where org_id = p_org_id
    loop
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', v_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, p_actor_id, v_conn_id, v_detail);
    end loop;
    delete from public.ms_graph_connections where org_id = p_org_id;
    -- quality #8: dead 'get diagnostics v_deleted = row_count' removed (was unread).
  end if;

  -- No exception if zero rows deleted (idempotent).
end $$;

revoke all on function public._m365_disconnect_cascade_core(uuid, uuid, text, uuid) from public;
-- Deliberately NO grant to authenticated/anon: internal only, called by SD RPCs/triggers owned by postgres.

-- ============================================================================
-- 2. PUBLIC RPC — keeps its Operator-or-Admin-in-org guard, delegates to _core.
--    Signature unchanged (p_org_id, p_user_id, p_reason) → backward compatible.
--    Adds LOW-2 reason allowlist at entry (defense-in-depth; core also enforces).
-- ============================================================================
create or replace function public.m365_disconnect_cascade(
  p_org_id   uuid,
  p_user_id  uuid,      -- null = all users in org (operator disentitlement)
  p_reason   text       -- 'disentitled' | 'offboard' | 'org_disabled' | 'admin_disconnect'
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_caller_org  uuid := public.auth_org_id();
  v_caller_role user_role := public.auth_role();
  v_allowed_reasons constant text[] := array['disentitled','offboard','org_disabled','admin_disconnect'];
begin
  -- Entry guard: only Operator (cross-org) or Admin-in-org may invoke directly.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;

  if not (
    (public.is_operator() and p_org_id is not null)  -- Operator: must specify target org
    or (v_caller_org = p_org_id and v_caller_role = 'Admin')  -- Admin: own org only
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- If p_user_id provided, validate it belongs to p_org_id (defense-in-depth).
  if p_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_user_id and org_id = p_org_id) then
      raise exception 'user_not_in_org' using errcode = '42501';
    end if;
  end if;

  -- LOW-2: reason allowlist also here for direct RPC callers (defense-in-depth).
  if p_reason is null or p_reason <> all(v_allowed_reasons) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  -- Delegate to the trigger-safe internal core.
  perform public._m365_disconnect_cascade_core(p_org_id, p_user_id, p_reason, auth.uid());
end $$;

revoke all on function public.m365_disconnect_cascade(uuid, uuid, text) from public;
grant execute on function public.m365_disconnect_cascade(uuid, uuid, text) to authenticated;

-- ============================================================================
-- 3. OFFBOARD TRIGGER — profiles status active→disabled.
--    AFTER UPDATE, FOR EACH ROW, WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'disabled')
--    Calls _core with reason='offboard', actor=auth.uid().
--    SECURITY DEFINER so it bypasses RLS and can call _core (also SECURITY DEFINER).
--    The WHEN clause ensures we only fire on the exact transition we care about.
-- ============================================================================
create or replace function public.m365_offboard_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- NEW.status = 'disabled' guaranteed by the trigger WHEN clause.
  perform public._m365_disconnect_cascade_core(NEW.org_id, NEW.id, 'offboard', auth.uid());
  return new;
end $$;

drop trigger if exists m365_offboard_trigger on public.profiles;
create trigger m365_offboard_trigger
  after update on public.profiles
  for each row
  when (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'disabled')
  execute function public.m365_offboard_trigger();

-- ============================================================================
-- 4. DISENTITLEMENT TRIGGER — org_features UPDATE/DELETE for m365_integration.
--    Single trigger function handles both TG_OP = 'UPDATE' and 'DELETE'.
--    AFTER so the row state is already committed; we read OLD/NEW correctly per event.
--    p_user_id = NULL → cascade deletes ALL connections in the org.
--    No recursion risk: deleting ms_graph_connections does not touch profiles or org_features.
-- ============================================================================
create or replace function public.m365_disentitle_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  if TG_OP = 'UPDATE' then
    -- Only fire when m365_integration toggles true → false.
    if NEW.feature_key <> 'm365_integration' then
      return new;
    end if;
    if not (OLD.enabled = true and NEW.enabled = false) then
      return new;
    end if;
    v_org_id := NEW.org_id;
    perform public._m365_disconnect_cascade_core(v_org_id, NULL, 'disentitled', auth.uid());
    return new;

  elsif TG_OP = 'DELETE' then
    -- Only fire when the deleted row was m365_integration and enabled=true.
    if OLD.feature_key <> 'm365_integration' then
      return old;
    end if;
    if not OLD.enabled then
      return old;
    end if;
    v_org_id := OLD.org_id;
    perform public._m365_disconnect_cascade_core(v_org_id, NULL, 'disentitled', auth.uid());
    return old;

  else
    return null; -- safety
  end if;
end $$;

drop trigger if exists m365_disentitle_update_trigger on public.org_features;
create trigger m365_disentitle_update_trigger
  after update on public.org_features
  for each row
  execute function public.m365_disentitle_trigger();

drop trigger if exists m365_disentitle_delete_trigger on public.org_features;
create trigger m365_disentitle_delete_trigger
  after delete on public.org_features
  for each row
  execute function public.m365_disentitle_trigger();