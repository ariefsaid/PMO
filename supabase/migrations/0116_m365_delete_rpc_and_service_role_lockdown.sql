-- 0114_m365_delete_rpc_and_service_role_lockdown.sql — Luna round-4 fixes (MED-2 + the delete-side
-- companion to MED-1's identity binding).
--
-- WHAT THIS MIGRATION DOES
--   • MED-2 (Luna round-4): service_role RETAINS direct INSERT/UPDATE/DELETE on ms_graph_connections
--     (auto-granted by 0080's ALTER DEFAULT PRIVILEGES when 0106 created the table). Every edge-fn
--     connection mutation already routes through the 0115 lock-order RPCs EXCEPT revoke.ts, which
--     does a direct `.delete()`. A direct child-first DELETE does not by itself form the
--     child→parent deadlock cycle (the write-guard is INSERT/UPDATE-scoped, so no BEFORE trigger
--     reaches the parents on a DELETE), BUT any FUTURE or stray direct service-role INSERT/UPDATE
--     WOULD reproduce the old child→parent cycle Luna reproduced. This migration closes that seam:
--       (a) adds a parent-first `m365_delete_connection` RPC (same PROFILES → ORG_FEATURES →
--           connection lock order + the same (org_id,user_id) IDENTITY BINDING as the round-4 MED-1
--           fix on the refresh/status RPCs) and switches revoke.ts to it; and
--       (b) REVOKEs insert, update, delete on public.ms_graph_connections from service_role so the
--           0115/0116 RPCs are the ONLY mutation path a service-role caller can take. Reads (SELECT)
--           are untouched — the edge fn selects connection rows (proxy.ts / revoke.ts load).
--     SECURITY DEFINER functions (the 0115/0116 RPCs, _m365_disconnect_cascade_core, the write-guard
--     trigger) execute as their OWNER (postgres) and bypass service_role's table grants, so they keep
--     working after the REVOKE. The lifecycle cascade (offboard/disentitle) is therefore unaffected.
--
-- GLOBAL LOCK ORDER (binding — unchanged from 0115):
--     PROFILES  →  ORG_FEATURES  →  ms_graph_connections
-- m365_delete_connection obeys it as a subsequence, like every other connection-mutation RPC.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (exact statements):
--   drop function if exists public.m365_delete_connection(uuid,uuid,uuid);
--   grant insert, update, delete on public.ms_graph_connections to service_role;
--   (re-grant is required ONLY if you want to restore the pre-round-4 direct-DML seam; a fresh
--    `supabase db reset` restores it automatically via 0080's default privileges on a recreate.)

-- ============================================================================
-- 1. m365_delete_connection — revoke.ts's connection delete (AC-M365-120). Parent-first lock order
--    + identity binding (Luna round-4 MED-1/MED-2). Returns the deleted id, or NULL if the row was
--    already gone (a just-fired lifecycle cascade) OR a mismatched (org,user,connection) was passed.
--    revoke.ts treats null|error as failure (NOT_CONNECTED / INTERNAL_ERROR) — mirrors H6 + the 0115
--    null|error = failure contract. The caller audits; this RPC does not (same as the 0115 RPCs).
--    No BEFORE trigger fires on DELETE (the write-guard is INSERT/UPDATE-scoped), so this is a plain
--    identity-bound DELETE — but the parent locks are still taken FIRST to hold the single global
--    lock order for the enclosing transaction (defense-in-depth against a future trigger addition).
-- ============================================================================
create or replace function public.m365_delete_connection(
  p_org_id        uuid,
  p_user_id       uuid,
  p_connection_id uuid
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- GLOBAL LOCK ORDER: PROFILES → ORG_FEATURES → ms_graph_connections (see 0115 file header).
  perform 1 from public.profiles
    where id = p_user_id and org_id = p_org_id
    for update;
  perform 1 from public.org_features
    where org_id = p_org_id and feature_key = 'm365_integration'
    for update;

  -- Luna round-4 (MED-1 identity binding, applied to the delete path): the DELETE is bound to the
  -- same (org_id, user_id) whose parents were locked. A mismatched caller matches ZERO rows → returns
  -- NULL (no mutation, no audit) → revoke.ts treats it as NOT_CONNECTED. A matching call deletes the
  -- one row and returns its id.
  delete from public.ms_graph_connections
   where id = p_connection_id
     and org_id = p_org_id
     and user_id = p_user_id
   returning id into v_id;
  return v_id;
end $$;

revoke all on function public.m365_delete_connection(uuid,uuid,uuid) from public;
grant execute on function public.m365_delete_connection(uuid,uuid,uuid) to service_role;

-- ============================================================================
-- 2. MED-2 (Luna round-4): service_role may NO LONGER directly INSERT/UPDATE/DELETE
--    ms_graph_connections. The SECURITY-DEFINER RPCs (0115 §1/§2/§3 + 0116 §1) are the only mutation
--    path; the lifecycle cascade (_m365_disconnect_cascade_core) and the write-guard trigger run as
--    their postgres owner and are unaffected. SELECT is retained (the edge fn loads connection rows).
--    This revokes whatever 0080's ALTER DEFAULT PRIVILEGES auto-granted when 0106 created the table;
--    no later migration re-grants it (verified), so the revoke persists across `supabase db reset`.
-- ============================================================================
revoke insert, update, delete on public.ms_graph_connections from service_role;
