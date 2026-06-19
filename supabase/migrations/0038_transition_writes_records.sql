-- 0038_transition_writes_records.sql
-- Supersedes the 0022 transition_procurement body — copies it verbatim and appends record upserts;
-- map + SoD + role gate BYTE-PRESERVED (from 0018/0022); column cache writes RETAINED (OQ-2).
--
-- Task 4.0 — procurement_status_events: append-only transition log ([PD-7], FR-PR-025).
-- Task 4.1 — transition_procurement: COPY 0022 body verbatim + APPEND canonical-record upserts
--             + status-event insert.
-- Task 4.2 — FR-PR-027 idempotent backfill: existing pr_number/po_number → purchase_requests/purchase_orders.
--
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).

-- ============================================================================
-- Task 4.0 — procurement_status_events (append-only log; NO write policy; RPC-only)
-- ============================================================================

-- [PD-7] Lightweight per-transition log (ADR-0033 "transition log ∪ record events"; FR-PR-025).
create table procurement_status_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  from_status    procurement_status,
  to_status      procurement_status not null,
  actor_id       uuid references profiles(id),
  notes          text,
  created_at     timestamptz not null default now()
);
create index procurement_status_events_procurement_idx
  on procurement_status_events (procurement_id, created_at);
alter table procurement_status_events enable row level security;
alter table procurement_status_events force row level security;
-- read-in-org; NO direct write policy — only the security-definer RPC inserts (append-only log).
create policy procurement_status_events_read on procurement_status_events
  for select using (org_id = auth_org_id());

-- ============================================================================
-- Task 4.1 — transition_procurement: 0022 body VERBATIM + appended record upserts + event log
-- SECURITY: the legal-transition map + role matrix + SoD-a + SoD-b are BYTE-PRESERVED from 0018/0022.
-- SoD-a/b run OUTSIDE the Admin-skip block (0018 hardening — OD-PROC-8). vendor_invoiced_at stamp
-- retained from 0022. Removing any re-assertion would bypass RLS — they MUST stay.
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

  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- v_from = current status captured BEFORE the status update above (same value SoD/map validation read).
  -- v_org = the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
revoke all     on function transition_procurement(uuid, procurement_status, text) from public;
grant  execute on function transition_procurement(uuid, procurement_status, text) to   authenticated;
revoke execute on function transition_procurement(uuid, procurement_status, text) from anon;

-- ============================================================================
-- Task 4.2 — FR-PR-027 idempotent backfill: existing pr_number/po_number → records.
-- One-shot, idempotent (not exists guard). Reversibility = supabase db reset.
-- org_id taken from parent for clarity (avoids trigger-dependence).
-- ============================================================================

insert into public.purchase_requests (org_id, procurement_id, pr_number, status, date)
select p.org_id, p.id, p.pr_number, 'Submitted', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.pr_number is not null
   and not exists (select 1 from public.purchase_requests pr
                    where pr.procurement_id = p.id and pr.pr_number = p.pr_number);

insert into public.purchase_orders (org_id, procurement_id, po_number, status, date)
select p.org_id, p.id, p.po_number, 'Issued', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.po_number is not null
   and not exists (select 1 from public.purchase_orders po
                    where po.procurement_id = p.id and po.po_number = p.po_number);
