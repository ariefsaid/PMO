-- 0018_authz_hardening.sql — Authorization hardening: procurement Admin-SoD + GR over-grant + Finance
-- timesheet-entry RLS hole. (AC-AUTHZ-001..010; owner decision OD-PROC-8 / LOCKED 2026-06-09.)
--
-- Three independent fixes applied in one migration:
--   (1) transition_procurement: SoD-a (requester≠approver) and SoD-b (approver≠payer) checks moved
--       OUTSIDE the `if not v_is_admin then … end if` block so they run for EVERY actor, including Admin.
--       The role×transition matrix (break-glass skip) stays INSIDE the Admin-skip as before. This matches
--       the timesheet_approval SoD pattern (0007) where SoD is checked BEFORE any role gate.
--   (2) create_procurement_receipt: tightened from the generic 4-role set (Admin/Exec/PM/Finance) to
--       "PM OR the original requester (any role incl. Engineer)", matching the Ordered→Received transition
--       authority in transition_procurement. Admin break-glass preserved (Admin passes the check always).
--   (3) timesheet_entries_write RLS policy (0011): drop + recreate adding
--       `and auth_role() in ('Admin','Executive','Project Manager','Engineer')` to both USING and WITH CHECK.
--       This closes the Finance write-through hole (the FE bars Finance from entry authoring; the DB must
--       too). All existing predicates (org, own-sheet, Draft, parent-project-org) are preserved verbatim.
--
-- ACL discipline mirrors 0006/0007/0017 + ADR-0011/0012: every function does `revoke all from public`,
-- `grant execute to authenticated`, `revoke execute from anon`. All security-definer functions pin
-- search_path = public and RE-ASSERT auth_org_id()/auth_role() internally because definer rights bypass
-- RLS. Table refs inside definer functions are schema-qualified (LOW-BV-1). Calls auth_org_id()/auth_role()
-- from 0002_rls.sql.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive.
-- Manual rollback for (3):
--   drop policy timesheet_entries_write on timesheet_entries;
--   create policy timesheet_entries_write on timesheet_entries for all
--     using (org_id = auth_org_id() and exists (
--       select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
--         and t.user_id = auth.uid() and t.status = 'Draft')
--       and exists (select 1 from public.projects p
--         where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and exists (
--       select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
--         and t.user_id = auth.uid() and t.status = 'Draft')
--       and exists (select 1 from public.projects p
--         where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()));
-- Manual rollback for (1) and (2): restore from 0006_procurement_lifecycle.sql.

-- ============================================================================
-- A1 — transition_procurement: SoD-a and SoD-b moved OUTSIDE the Admin-skip block.
-- The function body is reproduced VERBATIM from 0006 with the single structural change:
-- the two SoD checks are lifted out of `if not v_is_admin then … end if` so they run
-- for ALL actors. The role×transition matrix (v_allowed_roles, the only part that
-- SHOULD be skipped for Admins) remains inside. The timesheet RPC (0007) is the
-- reference pattern: SoD check precedes the role/manager check and cannot be skipped.
-- SECURITY: SoD-a/b MUST stay outside any role-skip — removing them from outside the
-- Admin-skip re-introduces the Admin self-approve/self-pay hole. Do not reorder.
-- ============================================================================
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
  -- The transition map (OD-PROC-6 config seam): legal (from → [allowed to]) superset, as data.
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
  v_allowed_roles text[];  -- per-transition allowed role set (besides Admin)
begin
  v_is_admin := (v_role = 'Admin');

  -- Load + lock the row (serializes concurrent transitions on the SAME procurement). P0002 if absent.
  select status, org_id, requested_by_id, approved_by_id
    into v_from, v_org, v_requester, v_approver
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-PROC-004a, AC-807): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-PROC-001/002): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  -- Ordered BEFORE the role×transition matrix so break-glass can never defeat SoD. Do not reorder.
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  -- Ordered BEFORE the role×transition matrix so break-glass can never defeat SoD. Do not reorder.
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- Role×transition authorization (OD-PROC-1 matrix, as data keyed by transition). Admin = break-glass
  -- (skips the role check, but SoD above already ran and cannot be bypassed).
  --
  -- Two transitions are "requester-or-role" scoped (the requester is permitted regardless of role):
  --   • Draft → Requested  : ANY member (the requester submits their own request)
  --   • Rejected → Draft    : the requester reworks
  --   • Ordered → Received  : the requester OR a Project Manager (OD-PROC-1)
  -- For these, being the requester is sufficient; otherwise the role must be in the listed set.
  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        -- Cancel boundary (OD-PROC-7-B): requester may cancel while in {Draft,Requested}; later only PM/Fin/Exec.
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];  -- requester satisfies below
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'           and p_to = 'Requested'       then array['Executive','Project Manager','Finance','Engineer']  -- any member submits
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end  -- requester reworks
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end  -- requester OR PM
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

  -- Atomic single update: status + minted PR#/PO# (coalesce → immutable once minted) + approver/notes stamps.
  -- The mint and the status write are the SAME statement ⇒ no observable partial state (NFR-PROC-ATOM-001).
  update public.procurements set
    status         = p_to,
    pr_number      = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number      = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    updated_at     = now()
  where id = p_id;
end; $$;
revoke all     on function transition_procurement(uuid, procurement_status, text) from public;
grant  execute on function transition_procurement(uuid, procurement_status, text) to   authenticated;
revoke execute on function transition_procurement(uuid, procurement_status, text) from anon;

-- ============================================================================
-- A2 — create_procurement_receipt: tighten GR-creation to PM OR the original requester.
-- The original 0006 gate was `auth_role() not in ('Admin','Executive','Project Manager','Finance')`,
-- but the Ordered→Received transition is requester-OR-PM only (OD-PROC-1). Executive and Finance
-- do not appear in that transition's allowed-roles set; allowing them to create GRs was an over-grant.
-- New gate: the caller must be (a) the original requester (any role, incl. Engineer), OR (b) a PM,
-- OR (c) an Admin (break-glass). Executive and Finance are no longer in the role set.
-- SECURITY: the parent-org guard MUST stay — it prevents a same-org member from grafting a GR onto
-- another org's procurement. The role + requester re-assertions MUST stay — definer bypasses RLS.
-- ============================================================================
create or replace function create_procurement_receipt(
  p_procurement_id uuid, p_status procurement_receipt_status, p_receipt_date date)
  returns procurement_receipts language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid;
  v_requester   uuid;
  v_row         public.procurement_receipts;
begin
  select org_id, requested_by_id into v_org, v_requester
    from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;

  -- Tenant isolation + role/requester gate (mirrors Ordered→Received in transition_procurement).
  -- Allowed: Admin (break-glass) OR Project Manager OR the original requester (any role).
  -- SECURITY: both checks MUST stay — removing either leaks cross-org or over-permissive GR creation.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (auth_role() = 'Admin'
          or auth_role() = 'Project Manager'
          or (auth.uid() is not null and auth.uid() = v_requester))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.procurement_receipts (procurement_id, status, receipt_date, gr_number)
    values (p_procurement_id, p_status, p_receipt_date,
            next_procurement_doc_number(v_org, 'GR'))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_procurement_receipt(uuid, procurement_receipt_status, date) from public;
grant  execute on function create_procurement_receipt(uuid, procurement_receipt_status, date) to   authenticated;
revoke execute on function create_procurement_receipt(uuid, procurement_receipt_status, date) from anon;

-- ============================================================================
-- A3 — timesheet_entries_write: add role gate to close the Finance write-through hole.
-- 0011's policy had no role constraint, so any user with an own-Draft sheet (incl. Finance,
-- which the FE bars) could INSERT/UPDATE entries via direct PostgREST. This adds
-- `and auth_role() in ('Admin','Executive','Project Manager','Engineer')` to BOTH USING and
-- WITH CHECK. Finance is excluded (matching the FE's entry-authoring gate). All existing
-- predicates (org, own-sheet, Draft, parent-project-org) are preserved verbatim from 0011.
-- SECURITY: the `auth_role()` in-set check MUST appear in BOTH USING and WITH CHECK — USING
-- gates the pre-image (existing row) and WITH CHECK gates the post-image (inserted/updated row).
-- ============================================================================
drop policy timesheet_entries_write on timesheet_entries;
create policy timesheet_entries_write on timesheet_entries for all
  using (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Engineer')
    and exists (
      select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
        and t.user_id = auth.uid() and t.status = 'Draft')
    and exists (select 1 from public.projects p
      where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Engineer')
    and exists (
      select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
        and t.user_id = auth.uid() and t.status = 'Draft')
    and exists (select 1 from public.projects p
      where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()));
