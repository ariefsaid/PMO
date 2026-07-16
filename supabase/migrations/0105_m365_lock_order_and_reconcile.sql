-- 0105_m365_lock_order_and_reconcile.sql — Luna round-3 fixes: the refresh/lifecycle DEADLOCK
-- closure + the one-time scrub of already-stale connections.
--
-- WHAT THIS MIGRATION DOES
--   • DEADLOCK (Luna round-3 MED): every edge-fn connection mutation now goes through a security-
--     definer RPC that locks PROFILES → ORG_FEATURES for update BEFORE touching the connection row,
--     establishing ONE global lock order. The write-guard (0103/0104) stays as the authoritative
--     rejection backstop; its parent FOR UPDATE reads become no-op re-locks inside the RPC's
--     transaction (the RPC already holds them). The lifecycle cascade takes the SAME direction
--     (parent → connection), so no mutating path takes locks child→parent → no lock cycle → no
--     deadlock. Proven by scripts/m365-deadlock-probe.sh (FAILS/deadlocks for the legacy direct-
--     UPDATE order, PASSES for the RPC order).
--   • STALE-ROW SCRUB (Luna round-3 MED): a one-time transactional reconciliation deletes
--     connections whose user is NOT active OR whose org lacks an enabled m365_integration
--     entitlement, emitting a m365.connection.revoked audit row (reason='reconciled') per deleted
--     connection (0103 §1 allowlist was widened with 'reconciled'). Idempotent — a no-op on a
--     clean/fresh DB.
--
-- GLOBAL LOCK ORDER (binding — DO NOT add any ms_graph_connections mutation that locks the
-- connection tuple before the parent rows):
--     PROFILES  →  ORG_FEATURES  →  ms_graph_connections
-- The lifecycle paths obey this as a subsequence:
--   • admin_set_user_status   → UPDATE profiles (locks P) → AFTER offboard cascade DELETE (locks C)  ⇒ P → C
--   • operator_toggle_feature → UPDATE org_features (locks F) → AFTER disentitle cascade (locks C)   ⇒ F → C
-- and every connection-mutation RPC below locks P → F → C. No path reverses the order.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (exact statements):
--   drop function if exists public.m365_upsert_connection(uuid,uuid,text,text,text[],bytea,bytea,timestamptz,text,timestamptz,timestamptz);
--   drop function if exists public.m365_refresh_connection(uuid,uuid,uuid,bytea,bytea,timestamptz,timestamptz);
--   drop function if exists public.m365_set_connection_status(uuid,uuid,uuid,text,timestamptz);
--   (the scrub is a one-time DO block — nothing to reverse; re-populate via a fresh OAuth connect.)

-- ============================================================================
-- 1. m365_upsert_connection — the callback's connection write (AC-M365-103).
--    Locks parents FIRST, then the INSERT … ON CONFLICT upsert. Returns the connection id, or NULL
--    if the write affected no row. The BEFORE write-guard (0103) still fires authoritatively on the
--    INSERT/UPDATE; if it rejects (user_not_active / org_not_entitled, 42501) the exception
--    propagates as the RPC's error (the caller treats error|null as failure — never success).
-- ============================================================================
create or replace function public.m365_upsert_connection(
  p_org_id                   uuid,
  p_user_id                  uuid,
  p_entra_tenant_id          text,
  p_entra_user_object_id     text,
  p_scopes                   text[],
  p_refresh_token_ciphertext bytea,
  p_access_token_ciphertext  bytea,
  p_access_token_expires_at  timestamptz,
  p_key_id                   text,
  p_connected_at             timestamptz,
  p_last_refresh_at          timestamptz
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- GLOBAL LOCK ORDER: PROFILES → ORG_FEATURES → ms_graph_connections (see file header).
  -- Taking the parent locks here, in this order, BEFORE the connection write is what closes the
  -- deadlock: the whole mutation locks in one direction, matching the lifecycle cascade.
  perform 1 from public.profiles
    where id = p_user_id and org_id = p_org_id
    for update;
  perform 1 from public.org_features
    where org_id = p_org_id and feature_key = 'm365_integration'
    for update;

  insert into public.ms_graph_connections (
      org_id, user_id, entra_tenant_id, entra_user_object_id, scopes,
      refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at,
      key_id, status, connected_at, last_refresh_at
    )
    values (
      p_org_id, p_user_id, p_entra_tenant_id, p_entra_user_object_id, p_scopes,
      p_refresh_token_ciphertext, p_access_token_ciphertext, p_access_token_expires_at,
      p_key_id, 'active', p_connected_at, p_last_refresh_at
    )
    on conflict (org_id, user_id) do update set
      entra_tenant_id          = excluded.entra_tenant_id,
      entra_user_object_id     = excluded.entra_user_object_id,
      scopes                   = excluded.scopes,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      access_token_ciphertext  = excluded.access_token_ciphertext,
      access_token_expires_at  = excluded.access_token_expires_at,
      key_id                   = excluded.key_id,
      status                   = 'active',
      connected_at             = excluded.connected_at,
      last_refresh_at          = excluded.last_refresh_at
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.m365_upsert_connection(uuid,uuid,text,text,text[],bytea,bytea,timestamptz,text,timestamptz,timestamptz) from public;
grant execute on function public.m365_upsert_connection(uuid,uuid,text,text,text[],bytea,bytea,timestamptz,text,timestamptz,timestamptz) to service_role;

-- ============================================================================
-- 2. m365_refresh_connection — refresh.ts success-path token persistence (AC-M365-111).
--    Locks parents FIRST, then UPDATEs the rotated pair + resets status active. Returns the id, or
--    NULL if the row was deleted under us (a just-fired lifecycle cascade). The caller treats
--    null|error as failure (no success audit) — mirrors the H6 / Luna-Med contract in refresh.ts.
-- ============================================================================
create or replace function public.m365_refresh_connection(
  p_org_id                   uuid,
  p_user_id                  uuid,
  p_connection_id            uuid,
  p_access_token_ciphertext  bytea,
  p_refresh_token_ciphertext bytea,
  p_access_token_expires_at  timestamptz,
  p_last_refresh_at          timestamptz
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- GLOBAL LOCK ORDER: PROFILES → ORG_FEATURES → ms_graph_connections (see file header).
  perform 1 from public.profiles
    where id = p_user_id and org_id = p_org_id
    for update;
  perform 1 from public.org_features
    where org_id = p_org_id and feature_key = 'm365_integration'
    for update;

  update public.ms_graph_connections
     set access_token_ciphertext  = p_access_token_ciphertext,
         refresh_token_ciphertext = p_refresh_token_ciphertext,
         access_token_expires_at  = p_access_token_expires_at,
         last_refresh_at          = p_last_refresh_at,
         status                   = 'active',
         updated_at               = p_last_refresh_at
   where id = p_connection_id
   returning id into v_id;
  return v_id;
end $$;

revoke all on function public.m365_refresh_connection(uuid,uuid,uuid,bytea,bytea,timestamptz,timestamptz) from public;
grant execute on function public.m365_refresh_connection(uuid,uuid,uuid,bytea,bytea,timestamptz,timestamptz) to service_role;

-- ============================================================================
-- 3. m365_set_connection_status — refresh.ts failure-path status writes (stale / revoked)
--    (AC-M365-112/113). Locks parents FIRST, then sets status. Returns the id, or NULL if the row
--    was deleted under us. Same null|error = failure contract as §2.
-- ============================================================================
create or replace function public.m365_set_connection_status(
  p_org_id        uuid,
  p_user_id       uuid,
  p_connection_id uuid,
  p_status        text,
  p_updated_at    timestamptz
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- GLOBAL LOCK ORDER: PROFILES → ORG_FEATURES → ms_graph_connections (see file header).
  perform 1 from public.profiles
    where id = p_user_id and org_id = p_org_id
    for update;
  perform 1 from public.org_features
    where org_id = p_org_id and feature_key = 'm365_integration'
    for update;

  update public.ms_graph_connections
     set status = p_status, updated_at = p_updated_at
   where id = p_connection_id
   returning id into v_id;
  return v_id;
end $$;

revoke all on function public.m365_set_connection_status(uuid,uuid,uuid,text,timestamptz) from public;
grant execute on function public.m365_set_connection_status(uuid,uuid,uuid,text,timestamptz) to service_role;

-- ============================================================================
-- 4. ONE-TIME RECONCILIATION SCRUB (Luna round-3 MED): delete already-stale connections.
--    The idempotent self-repairing triggers (0104) only repair when a profiles/org_features row is
--    SUBSEQUENTLY written; a token for an ALREADY-disabled user / ALREADY-disentitled org can persist
--    indefinitely with no later lifecycle write to trigger cleanup. This migration scrubs them once,
--    transactionally, emitting a m365.connection.revoked audit row per deleted connection
--    (reason='reconciled' — allowlisted in 0103 §1) so the irreversible ciphertext delete leaves a
--    durable trail. Idempotent (a no-op on a clean/fresh DB). The composite FK (0103 §5b) guarantees
--    every surviving connection's (user_id, org_id) matches a profile, so the user-inactive check is
--    a plain status read; the org-not-entitled check covers both a disabled and an absent row.
-- ============================================================================
do $$
declare
  v_id      uuid;
  v_org     uuid;
  v_user    uuid;
  v_deleted int := 0;
begin
  for v_id, v_org, v_user in
    delete from public.ms_graph_connections c
     where exists (
             select 1 from public.profiles p
              where p.id = c.user_id and p.org_id = c.org_id and p.status <> 'active'
           )
        or not exists (
             select 1 from public.org_features f
              where f.org_id = c.org_id and f.feature_key = 'm365_integration' and f.enabled
           )
    returning c.id, c.org_id, c.user_id
  loop
    perform public.log_audit('m365.connection.revoked', v_org, null, v_id,
      jsonb_build_object('reason','reconciled','source','scrub_inactive_or_disentitled','user_id',v_user));
    v_deleted := v_deleted + 1;
  end loop;
  raise log 'm365 reconcile scrub: deleted % stale connection(s)', v_deleted;
end $$;
