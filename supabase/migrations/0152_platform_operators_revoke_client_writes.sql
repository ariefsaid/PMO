-- 0152_platform_operators_revoke_client_writes.sql
-- Live security audit 2026-07-24, LOW-B3. `public.platform_operators` is the authorization
-- AUTHORITY for the M365 Operator gate (ADR-0058 §3 amendment: authorizeOperatorEntitled reads it
-- service-side to decide who may connect Microsoft 365) — and, per ADR-0049, for every Operator RPC.
-- Migration 0075 granted `authenticated` (and `anon`) DELETE/INSERT/UPDATE on it. Those writes are
-- denied TODAY only because the table is `force row level security` with a SELECT policy and NO
-- write policy — but that is one permissive policy (or one SECURITY DEFINER helper that touches the
-- table) away from instant self-elevation to Operator. Least-privilege: a client role has no reason
-- to write this table; only service_role / seed provisioning does. Revoke the base grant so even a
-- future misconfigured policy cannot mint an Operator row without ALSO re-granting here.
--
-- SELECT is retained (RLS still scopes it to the caller's own row — no Operator enumeration).
-- TRUNCATE was never granted to authenticated (unlike org_features, Luna H4) — nothing to revoke.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (do NOT — this re-opens the hole):
--   grant insert, update, delete on public.platform_operators to authenticated;

revoke insert, update, delete on public.platform_operators from authenticated;
revoke insert, update, delete on public.platform_operators from anon;
