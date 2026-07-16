-- 0107_m365_connection_oid_write_once.sql — TOFU + enforce-on-reconnect (owner design decision,
-- 2026-07-17). The STRUCTURAL enforcement that makes Microsoft-user-identity re-binding impossible
-- at the DB boundary — the same reasoning that made the C1 write-guard (0103) the authority (a
-- callback-only check is TOCTOU-vulnerable; the trigger fires for every role including service_role,
-- RLS bypass does not skip triggers).
--
-- THE GAP THIS CLOSES (Luna round-2 HIGH "Same-tenant OAuth user binding remains incomplete"):
--   callback.ts already asserts the id_token's `tid` equals the configured tenant (that CLOSED
--   cross-tenant consent-phishing). But it never bound the Microsoft USER identity (`oid`). So a PMO
--   Admin could initiate a connect flow, send the authorize URL to a DIFFERENT person in the SAME
--   Entra tenant, and that victim's tokens got stored in the ATTACKER's PMO connection — `tid`
--   matched, so the check passed. The callback now does a TOFU pre-check (reject before encrypt on a
--   mismatched oid), and THIS trigger is the structural backstop: once entra_user_object_id is
--   NON-NULL it is IMMUTABLE.
--
-- THE OWNER DECISION (do not re-open): trust-on-first-use + enforce-on-reconnect.
--   • FIRST connect (no row, OR a row whose entra_user_object_id IS NULL): ACCEPT and PIN the
--     id_token's `oid`. (INSERTs are never blocked here — the first write is TOFU.)
--   • RECONNECT (an existing row with a NON-NULL entra_user_object_id): the new `oid` MUST equal the
--     stored value. On MISMATCH → raise errcode 42501 (identity_rebind_forbidden), propagating
--     through the m365_upsert_connection ON CONFLICT DO UPDATE so the callback surfaces
--     M365_IDENTITY_MISMATCH + a forensic m365.connection.identity_mismatch audit row.
--   Residual risk (documented, not solved): the FIRST connect is still phishable within the tenant;
--   TOFU bounds that exposure to exactly one event and every subsequent reconnect is pinned. SSO-
--   identity binding was explicitly NOT taken (it would break connect for email/password users).
--
-- HOW IT COMPOSES WITH THE LOCK-ORDER DESIGN (binding — DO NOT reintroduce a child→parent lock):
--   The connection-mutation path goes through the security-definer lock-order RPCs (0105/0106),
--   which lock PROFILES → ORG_FEATURES → ms_graph_connections (the single global lock order). This
--   trigger is a BEFORE UPDATE row-level check that inspects ONLY OLD/NEW.entra_user_object_id — it
--   performs NO table reads and acquires NO additional locks. It therefore does not reverse the lock
--   order and cannot form a lock cycle. It composes with the sibling C1 write-guard (0103, also a
--   BEFORE trigger — multiple BEFORE triggers fire in name order; both are independent necessary
--   conditions, so firing order is immaterial). scripts/m365-deadlock-probe.sh + m365-race-probe.sh
--   are re-run green below to prove the lock order is undisturbed.
--
-- errcode 42501 mirrors the sibling write-guard so a (race) rejection maps to the same token-free
-- callback error path. The callback sniffs the 'identity_rebind' message to classify it as
-- M365_IDENTITY_MISMATCH (vs the write-guard's user_not_active / org_not_entitled).
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (exact statements):
--   drop trigger if exists m365_connection_oid_write_once on public.ms_graph_connections;
--   drop function if exists public.m365_connection_oid_write_once();

-- ============================================================================
-- 1. The write-once trigger function. entra_user_object_id is immutable once NON-NULL.
--    `is distinct from` is NULL-safe: it is TRUE iff the values differ (treating NULL as a distinct
--    value), so value→NULL is caught (cannot un-pin the identity — that would allow re-TOFU on the
--    next reconnect). INSERTs are never blocked (TOFU first-write); the OLD reference is NULL on an
--    INSERT, and this function is bound to a BEFORE UPDATE trigger only (TG_OP = 'UPDATE' guard is
--    belt-and-suspenders for clarity).
-- ============================================================================
create or replace function public.m365_connection_oid_write_once() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- WRITE-ONCE matrix for entra_user_object_id (only enforced on UPDATE — the first INSERT is TOFU):
  --   OLD NULL  → NEW value      : ALLOWED  (the first connect PINS the identity — trust-on-first-use)
  --   OLD NULL  → NEW NULL       : ALLOWED  (no change — an update that leaves the identity unset)
  --   OLD value → NEW (same)     : ALLOWED  (reconnect with the SAME Microsoft identity)
  --   OLD value → NEW (diff)     : REJECTED (identity rebind — same-tenant consent-phishing indicator)
  --   OLD value → NEW NULL       : REJECTED (cannot un-pin the identity; would allow re-TOFU)
  if TG_OP = 'UPDATE' and OLD.entra_user_object_id is not null
     and NEW.entra_user_object_id is distinct from OLD.entra_user_object_id then
    raise exception 'identity_rebind_forbidden' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.m365_connection_oid_write_once() from public;

drop trigger if exists m365_connection_oid_write_once on public.ms_graph_connections;
create trigger m365_connection_oid_write_once
  before update on public.ms_graph_connections
  for each row
  execute function public.m365_connection_oid_write_once();
