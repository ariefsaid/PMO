-- 0051_procurement_requester_self_stamp.sql
-- RED-3 (HIGH, live prod) — procurement requester mass-assignment → SoD bypass.
--
-- VULNERABILITY (gpt-5.5 red-team): procurements_insert (0002_rls.sql, hardened 0010) only checks
-- org_id; requested_by_id is fully client-supplied. So a PM can INSERT a Purchase Request with
--   requested_by_id = <some OTHER user>,
-- then Approve it via transition_procurement. The transition RPC's SoD guard blocks approver == the
-- procurement's requested_by_id — but the attacker set requested_by_id to a DIFFERENT user, so
-- self-approval passes. Net: the requester != approver separation-of-duties is defeated end-to-end.
--
-- LEGIT-USAGE FINDING (verified before locking down): there is NO on-behalf-of flow. Every caller
-- stamps requested_by_id = the authenticated user's own id:
--   * createProcurement (src/lib/db/procurementCrud.ts) is passed requestedById from
--     useAuth().currentUser.id (pages/Procurement.tsx:439, via userId).
--   * The procurement-cycle import wizard injects the IMPORTING user's own id
--     (procurementDescriptor.ts / commit.ts — "a second arg the spreadsheet cannot supply").
--   No path lets an Admin (or anyone) legitimately file a PR as another user. So we HARD-PIN
--   requested_by_id = auth.uid() on INSERT (no Admin on-behalf-of carve-out needed).
--
-- FIX (defense in depth — three independent controls):
--   1. Column DEFAULT auth.uid() so the server stamps the requester even if the client omits it.
--   2. Restrictive INSERT policy WITH CHECK (requested_by_id = auth.uid()) so a client that SUPPLIES a
--      foreign requested_by_id is REJECTED (42501), not silently accepted. Restrictive AND-combines with
--      the permissive procurements_insert (org guard) => INSERT now requires org AND self-requester.
--   3. Remove requested_by_id from the client-writable UPDATE grant (0010) so it cannot be re-pointed to
--      another user via a direct UPDATE after insert (closing the same bypass on the edit path).
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   drop policy if exists procurements_insert_self_requester on procurements;
--   alter table procurements alter column requested_by_id drop default;
--   (and re-add requested_by_id to the procurements UPDATE grant if reverting the lockdown).

-- 1. Server-stamp the requester by default (client may omit it entirely now).
alter table procurements alter column requested_by_id set default auth.uid();

-- 2. Restrictive INSERT policy: a supplied requested_by_id MUST equal the caller. Combined (AND) with the
--    permissive org-scoped procurements_insert, INSERT now requires org membership AND self-requester.
create policy procurements_insert_self_requester on procurements
  as restrictive
  for insert
  with check (requested_by_id = auth.uid());

-- 3. Close the UPDATE path: requested_by_id was in the 0010 client-writable UPDATE grant, which let a
--    4-role insider re-point it post-insert. Revoke the table-wide UPDATE and re-grant every column that
--    stayed client-writable in 0010 EXCEPT requested_by_id (now RPC/owner-only, like the state columns).
revoke update on procurements from authenticated;
grant  update (id, org_id, code, title, project_id, total_value, vendor_id,
               created_at, updated_at)
  on procurements to authenticated;
