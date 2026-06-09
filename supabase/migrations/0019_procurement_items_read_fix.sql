-- 0019_procurement_items_read_fix.sql — make procurement line items READABLE to approvers at any status.
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- BUG (Wave-5 C2, AC-IXD-PROC-W5-2): migration 0015 added `procurement_items_draft_only` as a
-- RESTRICTIVE policy `for all` whose USING/WITH CHECK both require the parent PR's status = 'Draft'.
-- Because `for all` INCLUDES the SELECT command and restrictive policies AND-combine with every
-- permissive policy, line items became SELECTable ONLY while the parent PR is Draft. So every
-- approver reading a Requested/Approved/Ordered/... PR sees ZERO line items (verified live: a PM
-- reading PROC-2026-002 returned 0 rows though 3 exist) — gutting evidence-before-decision.
--
-- The INTENT of 0015 was to freeze item WRITES once the PR leaves Draft, NOT to hide item reads.
--
-- FIX (minimal, no behavioral change to writes, no cross-org widening):
--   • Re-scope `procurement_items_draft_only` from `for all` to `for insert, update, delete`, keeping
--     the EXACT same Draft + org/parent-org USING/WITH CHECK conditions. Writes stay frozen post-Draft
--     for every writer (the 4 write-roles AND the requester widening), exactly as before; SELECT is no
--     longer gated by this restrictive policy.
--   • Re-scope the permissive `procurement_items_requester` (0015) from `for all` to
--     `for insert, update, delete` as well. It exists only to ADMIT requester writes; the org-wide
--     SELECT path is already provided by `procurement_items_select` (0002), so its `for all` SELECT
--     reach was redundant. Scoping it to writes keeps the policy intent honest and, AND-gated by the
--     re-scoped Draft restrictive policy above, the requester can still only write WHILE Draft.
--
-- A permissive SELECT path already exists: `procurement_items_select for select using (org_id =
-- auth_org_id())` (0002_rls.sql), mirroring `procurement_quotations_select`. So any in-org user who can
-- read the PR can read its items at ANY status once the restrictive read gate is removed. No new SELECT
-- policy is required, and writes remain Draft-only + org/parent-org guarded. Quotations are unaffected
-- (their select policy was never Draft-gated).
-- ============================================================================

-- (a) Re-scope the Draft-only freeze to WRITES only (was `for all` → caught SELECT).
drop policy if exists procurement_items_draft_only on procurement_items;
create policy procurement_items_draft_only on procurement_items
  as restrictive
  for insert
  with check (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'));

create policy procurement_items_draft_only_mod on procurement_items
  as restrictive
  for update
  using (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'))
  with check (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'));

create policy procurement_items_draft_only_del on procurement_items
  as restrictive
  for delete
  using (exists (
    select 1 from public.procurements p
     where p.id = procurement_items.procurement_id
       and p.org_id = auth_org_id()
       and p.status = 'Draft'));

-- (b) Re-scope the requester widening to WRITES only (was `for all`; org-wide SELECT is redundant with
-- procurement_items_select). org + parent-org guard kept; AND-gated by the Draft restrictive policies
-- above, so the requester can still only write while Draft.
drop policy if exists procurement_items_requester on procurement_items;
create policy procurement_items_requester on procurement_items
  for insert
  with check (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()));

create policy procurement_items_requester_mod on procurement_items
  for update
  using (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()))
  with check (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()));

create policy procurement_items_requester_del on procurement_items
  for delete
  using (org_id = auth_org_id()
    and exists (select 1 from public.procurements p
                 where p.id = procurement_items.procurement_id
                   and p.org_id = auth_org_id()
                   and p.requested_by_id = auth.uid()));
