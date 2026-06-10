-- 0022_finance_budget_debt.sql — Finance backend/data debt (two items, OD-E / OD-BUDGET-2 / OD-ARCH-1).
-- Forward-only, additive; reversibility = `supabase db reset` (ADR-0006, pre-production).
-- Manual rollback:
--   ITEM 1: alter table procurements drop column vendor_invoiced_at;
--           -- then restore transition_procurement from 0018_authz_hardening.sql (drop the stamp line).
--   ITEM 2: drop function get_finance_budget_review();
--
-- ACL/RLS discipline mirrors 0006/0009/0018/0021: the new column inherits procurements' existing
-- RLS (read-in-org + 4-role write) + org_id seam (no new policy). The new aggregation RPC is
-- `security invoker` (no org_id arg, RLS scopes reads), search_path=public pinned, anon revoked.

-- ============================================================================
-- ITEM 1 — vendor_invoiced_at (FR-FIN-DEBT-001/002/003/005).
-- A1 — nullable column. Inherits procurements RLS (0002/0010) + org_id seam — no new policy.
-- ============================================================================
alter table procurements
  add column vendor_invoiced_at timestamptz;  -- stamped on →'Vendor Invoiced'; null until then

-- A2 — backfill existing 'Vendor Invoiced' rows from updated_at (FR-FIN-DEBT-003).
-- BEST-EFFORT APPROXIMATION: updated_at is the last-transition time, which for a row currently in
-- 'Vendor Invoiced' is the closest available proxy for when it was invoiced. New transitions stamp the
-- real time (A3). Documented as approximate; not authoritative for pre-migration rows.
update procurements
   set vendor_invoiced_at = updated_at
 where status = 'Vendor Invoiced' and vendor_invoiced_at is null;

-- A3 — stamp on the entry transition. transition_procurement is reproduced VERBATIM from
-- 0018_authz_hardening.sql with ONE change: the final UPDATE adds a conditional
-- `vendor_invoiced_at` stamp that fires ONLY when p_to = 'Vendor Invoiced' (FR-FIN-DEBT-002),
-- mirroring the existing approved_by_id/pr_number conditional stamps. All authz, SoD-a/b, the
-- transition map, tenant isolation, and ACL grants are UNCHANGED. SECURITY: the SoD-a/b checks and
-- org re-assertion MUST stay outside any role-skip — do not reorder (OD-PROC-8).
create or replace function transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id
    into v_from, v_org, v_requester, v_approver
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;
end; $$;
revoke all     on function transition_procurement(uuid, procurement_status, text) from public;
grant  execute on function transition_procurement(uuid, procurement_status, text) to   authenticated;
revoke execute on function transition_procurement(uuid, procurement_status, text) from anon;

-- ============================================================================
-- ITEM 2 — get_finance_budget_review() (FR-FIN-DEBT-010/011/012/014; OD-E / OD-BUDGET-2 / OD-ARCH-1).
-- True portfolio-wide variance ranking of ALL budget>0 projects in the caller's org. Replaces the FE
-- re-sort of top_projects (which was LIMIT 5 by contract_value AND read the stored projects.spent).
--
-- spent = OD-BUDGET-2 COMMITTED basis: Σ procurements.total_value WHERE status IN
--   ('Ordered','Received','Vendor Invoiced','Paid') — the SAME basis as on_hand.spent in 0009 and
--   getProjectCommittedSpend (procurements.ts), NOT the stored projects.spent column.
-- variance = spent - budget (positive = over). Ordered variance DESC (most-over first). budget>0 filter
--   applied SERVER-SIDE (mirrors the current honest scope; a no-budget project is not a review subject).
-- Returns ALL ranked rows (no server LIMIT) so the FE owns the top-N slice — keeps the RPC reusable for
--   a future "full budget review" page without a contract change; the set is org-bounded + budget>0 so it
--   is small (single-tenant scale). budget IS the stored projects.budget header (OD-BUDGET-1 authority is
--   a separate concern; N17 has always ranked on the header budget — preserved).
--
-- SECURITY (NFR-FIN-DEBT-014 / ADR-0009): security invoker, NO org_id argument — projects + procurements
-- reads run under the caller's RLS (org_id = auth_org_id()), so every row is org-scoped automatically.
-- DO NOT switch to security definer without re-adding an explicit org_id = auth_org_id() filter on every
-- read. search_path pinned to public; anon execute revoked.
-- ============================================================================
create or replace function get_finance_budget_review()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select coalesce((
    select json_agg(r order by r.variance desc)
    from (
      select
        p.id,
        p.name,
        c.name as client_name,
        p.budget,
        coalesce((select sum(pr.total_value) from procurements pr
                   where pr.project_id = p.id
                     and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0) as spent,
        (coalesce((select sum(pr.total_value) from procurements pr
                    where pr.project_id = p.id
                      and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0)
          - p.budget) as variance
      from projects p
      left join companies c on c.id = p.client_id
      where p.budget > 0
    ) r
  ), '[]'::json);
$$;

revoke all on function get_finance_budget_review() from public;
grant execute on function get_finance_budget_review() to authenticated;
-- Close the unauthenticated heavy-query surface (ADR-0009 Security LOW-1), mirroring 0009.
revoke execute on function get_finance_budget_review() from anon;
