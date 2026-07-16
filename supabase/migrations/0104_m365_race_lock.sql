-- 0104_m365_race_lock.sql — closes the C1-RACE MVCC TOCTOU (Luna re-verify round 2, BLOCK) +
-- makes the lifecycle cleanup idempotent/self-repairing + supporting hardening (Luna Med/Low).
--
-- The deterministic fixes from round 1 (0103) all landed, but the BEFORE INSERT OR UPDATE write-guard
-- on ms_graph_connections read profiles.status and the org_features entitlement WITHOUT a lock, so a
-- concurrent callback/lifecycle pair could leave a live encrypted refresh token for a disabled user /
-- disentitled org (NFR-M365-107). This migration is the concurrency closure + the residual Med/Low.
--
-- Proven by scripts/m365-race-probe.sh: the probe FALSIFIES the unlocked (0103) guard (a callback-first
-- interleaving leaves 1 surviving connection for a disabled/disentitled target) and PASSES after this
-- migration (0 surviving). pgTAP cannot express a two-session race (single-txn), hence the probe.
--
--   • C1-RACE(a): m365_connection_write_guard now takes PROFILES then ORG_FEATURES row locks
--                 (FOR UPDATE) so the callback INSERT and the lifecycle UPDATE SERIALIZE. Lock
--                 ordering is documented in the function; each lifecycle writer touches a single one
--                 of those tables → no lock cycle → no deadlock.
--   • C1-RACE(b): the lifecycle cleanup is now idempotent/self-repairing on the FINAL state, so a
--                 stale row from any past race (or legacy data) is cleaned the next time the state is
--                 re-written —
--                 - profiles offboard trigger fires whenever NEW.status = 'disabled' (not only on the
--                   active→disabled transition): re-saving a disabled profile repairs a leftover.
--                 - org_features disentitle UPDATE branch fires whenever the final state is
--                   m365_integration + enabled=false (true→false AND false→false): re-saving false
--                   repairs a leftover. Enable never cascades.
--   • Med (unindexed user-scoped deletes): the _core now deletes by user_id alone, but the existing
--     indexes lead with org_id → add ms_graph_connections(user_id) and m365_pkce_states(user_id).
--   • Low (unbatched sweep): m365_pkce_sweep_tick now deletes in chunked batches (FOR UPDATE SKIP
--     LOCKED) so a large backlog cannot hold a long lock.
--   • Low (least-privilege): revoke public EXECUTE on the trigger functions (Postgres rejects direct
--     scalar invocation of trigger fns anyway — this is hygiene).
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (exact statements):
--   -- restore the unlocked write-guard (0103 form):
--   create or replace function public.m365_connection_write_guard() returns trigger
--     language plpgsql security definer set search_path = public as $$
--     declare v_status public.profile_status;
--     begin
--       select status into v_status from public.profiles where id = NEW.user_id and org_id = NEW.org_id;
--       if not found or v_status <> 'active' then raise exception 'user_not_active' using errcode = '42501'; end if;
--       if not exists (select 1 from public.org_features where org_id = NEW.org_id and feature_key = 'm365_integration' and enabled)
--         then raise exception 'org_not_entitled' using errcode = '42501'; end if;
--       return new;
--     end $$;
--   -- restore the transition-only offboard trigger:
--   drop trigger if exists m365_offboard_trigger on public.profiles;
--   create trigger m365_offboard_trigger after update on public.profiles for each row
--     when (OLD.status is distinct from NEW.status and NEW.status = 'disabled')
--     execute function public.m365_offboard_trigger();
--   -- restore the true→false-only disentitle UPDATE branch (0103 form) by recreating its function;
--   -- restore the unbatched sweep (0102 form):
--   create or replace function public.m365_pkce_sweep_tick() returns void language plpgsql security definer set search_path = public as $$ begin delete from public.m365_pkce_states where expires_at < now(); end; $$;
--   drop index if exists public.ms_graph_connections_user_idx;
--   drop index if exists public.m365_pkce_states_user_idx;

-- ============================================================================
-- 1. C1-RACE(a): write-guard with serializing row locks (PROFILES then ORG_FEATURES).
-- ============================================================================
create or replace function public.m365_connection_write_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_status  public.profile_status;
  v_enabled boolean;
begin
  -- C1-RACE (Luna re-verify round 2): the two reads below take ROW LOCKS so a concurrent lifecycle
  -- writer (admin_set_user_status / operator_toggle_feature) SERIALIZES against this write, closing
  -- the MVCC TOCTOU where a callback INSERT passed on stale (active/entitled) state and committed
  -- AFTER the lifecycle cascade — which could not see the callback's uncommitted row — leaving a
  -- live encrypted refresh token for a disabled user / disentitled org (NFR-M365-107).
  --
  -- LOCK ORDERING (binding — DO NOT add any path that locks org_features before profiles):
  --    this guard locks   PROFILES first, then ORG_FEATURES.
  -- Each lifecycle writer touches a SINGLE one of those tables (admin_set_user_status → only
  -- profiles; operator_toggle_feature → only org_features), so each holds exactly one of the two
  -- locks this guard takes — there is NO lock cycle with the guard's order, hence NO deadlock. (Two
  -- concurrent callbacks for the same org both lock the same org_features row in this same order →
  -- serialized, not deadlocked.)
  --
  -- Why it closes the race (either interleaving is safe):
  --   • callback-first: the guard holds the profile/entitlement row locks for the whole callback
  --     transaction → the lifecycle UPDATE blocks until the callback COMMITS → the lifecycle's
  --     AFTER-trigger cascade then SEES the committed connection and deletes it.
  --   • lifecycle-first: the guard's locking read blocks, then re-reads the COMMITTED
  --     disabled/disentitled state and raises 42501.
  -- FOR UPDATE row locks are held until the end of the enclosing transaction (the callback's INSERT
  -- txn), so the serialization spans the whole callback write.
  select status into v_status
    from public.profiles
   where id = NEW.user_id and org_id = NEW.org_id
   for update;
  if not found or v_status <> 'active' then
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

-- ============================================================================
-- 2. C1-RACE(b): idempotent / self-repairing OFFBOARD trigger.
--    Fire whenever the FINAL state is 'disabled' (not only on the active→disabled transition), so
--    re-saving an already-disabled profile cleans any leftover connection from a past race / legacy
--    data. The body is unchanged (delegates to _core, reason='offboard'); _core is idempotent (a
--    no-op when nothing remains to delete), so the extra fire is cheap.
-- ============================================================================
create or replace function public.m365_offboard_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- NEW.status = 'disabled' guaranteed by the trigger WHEN clause.
  perform public._m365_disconnect_cascade_core(NEW.org_id, NEW.id, 'offboard', auth.uid());
  return new;
end $$;

revoke all on function public.m365_offboard_trigger() from public;

drop trigger if exists m365_offboard_trigger on public.profiles;
create trigger m365_offboard_trigger
  after update on public.profiles
  for each row
  when (NEW.status = 'disabled')   -- FINAL state 'disabled' (was: OLD<>NEW AND 'disabled') → self-repair
  execute function public.m365_offboard_trigger();

-- ============================================================================
-- 3. C1-RACE(b): idempotent / self-repairing DISENTITLE trigger (UPDATE branch).
--    Cascade whenever the FINAL state is m365_integration + enabled=false (true→false AND false→false),
--    so re-saving false cleans any leftover connection. Enable (enabled=true) NEVER cascades. The
--    INSERT (absent-row toggle-OFF) and DELETE (broadened) branches are unchanged from 0103.
-- ============================================================================
create or replace function public.m365_disentitle_trigger() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    -- H2: an absent-row toggle-OFF lands here as INSERT enabled=false.
    if NEW.feature_key <> 'm365_integration' or NEW.enabled then
      return new;  -- non-m365, or an enable — never cascades
    end if;
    perform public._m365_disconnect_cascade_core(NEW.org_id, null, 'disentitled', auth.uid());
    return new;

  elsif TG_OP = 'UPDATE' then
    -- Luna: cascade whenever the FINAL state is m365_integration + enabled=false (true→false AND
    -- false→false) so re-saving a disabled entitlement repairs a leftover stale row. Enable never
    -- cascades. Idempotent: _core is a no-op when nothing remains to delete.
    if NEW.feature_key <> 'm365_integration' then
      return new;
    end if;
    if NEW.enabled is distinct from false then
      return new;
    end if;
    perform public._m365_disconnect_cascade_core(NEW.org_id, null, 'disentitled', auth.uid());
    return new;

  elsif TG_OP = 'DELETE' then
    -- H2 (broadened): cascade on deletion of ANY m365_integration row.
    if OLD.feature_key <> 'm365_integration' then
      return old;
    end if;
    perform public._m365_disconnect_cascade_core(OLD.org_id, null, 'disentitled', auth.uid());
    return old;

  else
    return null; -- safety
  end if;
end $$;

revoke all on function public.m365_disentitle_trigger() from public;

-- ============================================================================
-- 4. Med (Luna): index the user-scoped cascade deletes.
--    _core's single-user branch deletes by user_id ALONE (H5i), but the existing indexes lead with
--    org_id → those deletes seq-scan on a populated table. Add a user_id-leading index on each.
-- ============================================================================
create index if not exists ms_graph_connections_user_idx on public.ms_graph_connections (user_id);
create index if not exists m365_pkce_states_user_idx       on public.m365_pkce_states (user_id);

-- ============================================================================
-- 5. Low (Luna): batched PKCE sweep so a large backlog cannot hold a long lock.
-- ============================================================================
create or replace function public.m365_pkce_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 1;
begin
  -- Delete in fixed-size chunks (FOR UPDATE SKIP LOCKED so a concurrent sweep never contends on the
  -- same rows) until no expired rows remain. Each chunk is a short statement; the loop terminates
  -- because v_deleted reaches 0 once the backlog is drained.
  while v_deleted > 0 loop
    delete from public.m365_pkce_states
     where id in (
       select id from public.m365_pkce_states
        where expires_at < now()
        limit 1000
        for update skip locked
     );
    get diagnostics v_deleted = row_count;
  end loop;
end;
$$;

revoke all on function public.m365_pkce_sweep_tick() from public;

-- ============================================================================
-- 6. Low (Luna, least-privilege hygiene): revoke public EXECUTE on the trigger functions.
--    PostgreSQL rejects direct scalar invocation of trigger functions, so this is hygiene only;
--    postgres (the owner) retains implicit EXECUTE and the triggers keep working.
-- ============================================================================
revoke execute on function public.m365_connection_write_guard() from public;
revoke execute on function public.m365_offboard_trigger()        from public;
revoke execute on function public.m365_disentitle_trigger()      from public;
revoke execute on function public.m365_org_features_immutable()  from public;
