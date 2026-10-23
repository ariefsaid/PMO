-- Reverses 0362: drops derivation/gate/lock triggers; restores 0360's advance_procurement_status, 0349's guard and
-- 0284's transition_procurement.
drop trigger if exists zz_payments_advance on public.payments;
drop trigger if exists zz_procurement_invoices_advance on public.procurement_invoices;
drop trigger if exists zz_procurement_receipts_advance on public.procurement_receipts;
drop trigger if exists zz_purchase_orders_advance on public.purchase_orders;
drop trigger if exists zz_procurement_invoices_gate on public.procurement_invoices;
drop trigger if exists zz_procurement_receipts_gate on public.procurement_receipts;
drop trigger if exists zz_purchase_orders_gate on public.purchase_orders;
drop function if exists public.advance_procurement_on_record();
drop function if exists public.guard_procurement_record_gate();
drop trigger if exists a0_payments_lock_procurement on public.payments;
drop trigger if exists a0_procurement_invoices_lock_procurement on public.procurement_invoices;
drop trigger if exists a0_procurement_receipts_lock_procurement on public.procurement_receipts;
drop trigger if exists a0_purchase_orders_lock_procurement on public.purchase_orders;
drop function if exists public.lock_procurement_for_record();

-- 0360 advance_procurement_status, verbatim (supabase/migrations/0360_procurement_flexible_foundation.sql lines 258-276;
-- `create` -> `create or replace`).
create or replace function public.advance_procurement_status(p_procurement_id uuid, p_note text)
returns public.procurement_status language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_from public.procurement_status; v_org uuid; v_to public.procurement_status;
begin
  select status, org_id into v_from, v_org from public.procurements where id = p_procurement_id for update;
  if not found or v_from::text in ('Cancelled','Rejected') then return v_from; end if;
  v_to := public.procurement_evidenced_step(p_procurement_id);
  if v_to is null or public.procurement_step_rank(v_to) <= public.procurement_step_rank(v_from) then
    return v_from;
  end if;
  update public.procurements
     set status = v_to,
         vendor_invoiced_at = case when v_to::text in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,
         updated_at = now()
   where id = p_procurement_id;
  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_procurement_id, v_org, v_from, v_to, auth.uid(), p_note);
  return v_to;
end $$;

-- 0349 §3 guard_procurement_approved_total, verbatim (supabase/migrations/0349_procurement_integrity_guards.sql lines 101-143).
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and (new.approved_total_value is distinct from old.approved_total_value
          or new.amount_approved_by_id is distinct from old.amount_approved_by_id) then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    -- The actor whose quote selection returned the request for approval may not approve it.
    -- Enforced here (not in an RPC branch) so no path and no role, Admin included, skips it.
    if auth.uid() is not null and auth.uid() = (
      select e.actor_id from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status
       order by e.created_at desc, e.id desc limit 1
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    -- The selected quote is retained, but the old decision is invalid. The normal
    -- Requested -> Approved transition re-runs spend_approval_route on this amount.
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.status is distinct from 'Paid' then
    if old.approved_total_value is null then
      raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
    end if;
    -- Whoever approved a raised amount may not also pay it (the approver-is-not-payer rule).
    if auth.uid() is not null and auth.uid() = old.amount_approved_by_id then
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    if not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- 0284 transition_procurement, verbatim (supabase/migrations/0284_procurement_money_consistency.sql lines 73-267).
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_project     uuid;                    -- 0243
  v_category    public.budget_category;  -- 0243
  v_currency    text;                    -- 0243
  v_amount      numeric;                 -- 0243
  v_route       record;                  -- 0243
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
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
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id,
         project_id, budget_category, currency                       -- 0243
    into v_from, v_org, v_requester, v_approver,
         v_project, v_category, v_currency                           -- 0243
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
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

  -- 0243 (#803, FR-APR-010…019): approval routing by budget. Narrows who may decide; never widens.
  -- The line lock serializes concurrent approvals on one (project, category) so two cannot both spend
  -- the same headroom (FR-APR-018). The classify statement below runs AFTER the lock is held, so its
  -- snapshot sees any approval that committed while we waited (READ COMMITTED, volatile caller).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') then                         -- 0243
    if v_project is not null and v_category is not null then                               -- 0243
      perform pg_advisory_xact_lock(                                                       -- 0243
        hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0)); -- 0243
    end if;                                                                                -- 0243
    v_amount := public.procurement_request_amount(p_id);                                   -- 0243
    select * into v_route                                                                  -- 0243
      from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester, -- 0243
             v_uid, public.procurement_submitted_at(p_id));                                -- 0243
    -- coalesce: a NULL here must refuse, never pass (an `if` on NULL does not fire). A NULL route is  -- 0243
    -- treated as the senior route (DD-APR-5): only a named approver or an Admin passes.  -- 0243
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin                      -- 0243
       and not coalesce(v_uid = any (v_route.approver_ids), false) then                    -- 0243
      if v_route.route = 'admin' then                                                      -- 0243
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', -- 0243
          v_route.reason using errcode = '42501';                                          -- 0243
      end if;                                                                              -- 0243
      raise exception 'approval routing: % requires a named approver',                    -- 0243
        coalesce(v_route.reason, 'unknown') using errcode = '42501';                       -- 0243
    end if;                                                                                -- 0243
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,             -- 0243
      jsonb_build_object(                                                                  -- 0243
        'to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,                -- 0243
        'request_amount', v_amount, 'line_budget', v_route.line_budget,                    -- 0243
        'line_used', v_route.line_used, 'budget_category', v_category::text,               -- 0243
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin         -- 0243
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));    -- 0243
  end if;                                                                                  -- 0243

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
          -- 0268 (OD-PROC-1): submit is the requester's act; Admin keeps break-glass via the skip above.
          when v_from = 'Draft'           and p_to = 'Requested'       then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
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
    -- A previously-recorded Scheduled payment is the settlement evidence; settle it in place.
    update public.payments
       set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';

    -- Otherwise record one payment for the invoice payable. The amount field is the captured
    -- vendor bill basis; exclusive VAT is added, inclusive VAT is already in amount, and
    -- stated withholding is deducted. With no bill, retain the legacy header fallback.
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(
             sum(i.amount
                 + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                 - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null),
             p.total_value
           ),
           p.currency
      from public.procurements p
      left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- v_from = current status captured BEFORE the status update above (same value SoD/map validation read).
  -- v_org = the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
