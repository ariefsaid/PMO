-- 0053_user_views_owner_org_gate.sql — SEC-HIGH-1: org-gate the user_views SELECT owner branch.
--
-- WHY: 0045's user_views_select policy was
--   using (user_id = auth.uid() or (scope = 'shared_org' and org_id = auth_org_id()))
-- The owner OR-branch (`user_id = auth.uid()`) carries NO org_id predicate, so a row a user owns is
-- readable regardless of the row's org. On an org-move (or any mis-stamped / future-B2B row) a user
-- could read their own view that lives in a DIFFERENT org than their JWT — org_id was not the wall on
-- the owner path. RLS is the enforcement authority (NFR-UV-SEC-001); a policy that a valid JWT can use
-- to reach across the org seam is a real leak even in single-tenant, and a certain one at B2B scale.
--
-- FIX: wrap the whole predicate in the org gate — org_id must match the caller's org FIRST, then either
-- the owner OR the shared_org scope grants the read. Behaviour within a single org is byte-identical to
-- 0045 (every own/shared row a caller could see is same-org in practice today); the ONLY change is that
-- a cross-org own/shared row is now correctly invisible. PgTAP: AC-UV-004 (0089_user_views_tenancy).
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback = restore the 0045 body:
--   drop policy if exists user_views_select on user_views;
--   create policy user_views_select on user_views for select
--     using (user_id = auth.uid() or (scope = 'shared_org' and org_id = auth_org_id()));

drop policy if exists user_views_select on user_views;

-- SELECT: org_id is the wall on EVERY branch — org must match first, THEN owner OR shared_org. A private
-- (or shared_roles) row owned by another user is still invisible to same-org members and Admin (owner
-- asymmetry, OD-1/OD-2, preserved). A cross-org row of ANY scope/owner is now 0 rows (SEC-HIGH-1).
create policy user_views_select on user_views for select
  using (org_id = auth_org_id() and (user_id = auth.uid() or scope = 'shared_org'));
