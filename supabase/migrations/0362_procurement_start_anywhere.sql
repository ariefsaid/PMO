-- 0362 procurement start-anywhere: derived status, gates on records, transition skips, SoD on every Paid path.
-- Spec procurement-flexible-entry (FR-PFE-001..017); ADR-0093. Rollback: rollback/0362_procurement_start_anywhere_down.sql
-- Derivation and record gates run for USER writes (auth.uid() set) and the ERP MIRROR (service_role JWT) only — never for
-- direct SQL (seed, migrations, fixtures), so existing data is never re-derived (NFR-PFE-010).

-- M1: lock the purchase row before the record row's FK check takes its share lock. Two concurrent records on one
-- purchase would otherwise both hold the share lock and deadlock upgrading it in advance_procurement_status.
create function public.lock_procurement_for_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform 1 from public.procurements where id = new.procurement_id for update;
  return new;
end $$;
revoke all on function public.lock_procurement_for_record() from public, anon, authenticated;
create trigger a0_purchase_orders_lock_procurement before insert on public.purchase_orders
  for each row execute function public.lock_procurement_for_record();
create trigger a0_procurement_receipts_lock_procurement before insert on public.procurement_receipts
  for each row execute function public.lock_procurement_for_record();
create trigger a0_procurement_invoices_lock_procurement before insert on public.procurement_invoices
  for each row execute function public.lock_procurement_for_record();
create trigger a0_payments_lock_procurement before insert on public.payments
  for each row execute function public.lock_procurement_for_record();

-- 0360's advance_procurement_status plus the `0362` lines: a purchase awaiting approval (Requested — including one a
-- quote above its approved amount sent back) never derives, so recording a document cannot skip the approval.
-- A user write is refused; the ERP mirror's write is kept and audited as derive_skipped (advance_procurement_on_record).
create or replace function public.advance_procurement_status(p_procurement_id uuid, p_note text)
returns public.procurement_status language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_from public.procurement_status; v_org uuid; v_to public.procurement_status;
begin
  select status, org_id into v_from, v_org from public.procurements where id = p_procurement_id for update;
  if not found or v_from::text in ('Cancelled','Rejected') then return v_from; end if;
  v_to := public.procurement_evidenced_step(p_procurement_id);
  if v_from = 'Requested' and v_to is not null then                                                      -- 0362
    raise exception 'This purchase is awaiting approval. Record its documents after it is approved.'    -- 0362
      using errcode = '23514', detail = 'awaiting_approval';                                              -- 0362
  end if;                                                                                                 -- 0362
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

create function public.guard_procurement_record_gate() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_reason text;
begin
  if auth.uid() is null then return new; end if;   -- the ERP dispatch checked the gate before the ERP write (slice G)
  v_reason := public.procurement_gate_violation(new.procurement_id, tg_argv[0]::public.procurement_status);
  if v_reason is not null then
    raise exception '%', public.procurement_gate_message(v_reason) using errcode = '23514', detail = v_reason;
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_record_gate() from public, anon, authenticated;

create function public.advance_procurement_on_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is not null then
    perform public.advance_procurement_status(new.procurement_id, 'Derived: ' || tg_argv[0] || ' recorded');
  elsif coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    begin
      perform public.advance_procurement_status(new.procurement_id, 'Derived: ' || tg_argv[0] || ' recorded');
    exception when others then
      perform public.log_audit('procurement.derive_skipped', new.org_id, null, new.procurement_id,
        jsonb_build_object('record', tg_argv[0], 'reason', sqlerrm));
    end;
  end if;
  return null;
end $$;
revoke all on function public.advance_procurement_on_record() from public, anon, authenticated;

create trigger zz_purchase_orders_gate before insert on public.purchase_orders
  for each row execute function public.guard_procurement_record_gate('Ordered');
create trigger zz_procurement_receipts_gate before insert on public.procurement_receipts
  for each row execute function public.guard_procurement_record_gate('Received');
create trigger zz_procurement_invoices_gate before insert on public.procurement_invoices
  for each row execute function public.guard_procurement_record_gate('Vendor Invoiced');
create trigger zz_purchase_orders_advance after insert on public.purchase_orders
  for each row execute function public.advance_procurement_on_record('order');
create trigger zz_procurement_receipts_advance after insert on public.procurement_receipts
  for each row execute function public.advance_procurement_on_record('receipt');
create trigger zz_procurement_invoices_advance after insert on public.procurement_invoices
  for each row execute function public.advance_procurement_on_record('vendor invoice');
create trigger zz_payments_advance after insert or update of status on public.payments
  for each row when (new.status = 'Paid') execute function public.advance_procurement_on_record('payment');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the procurement update guard: 0349 §3 body plus the `0362` lines (FR-PFE-016/017).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    -- 0362 FR-PFE-016: approver ≠ payer on EVERY path to Paid (transition, a Paid payment, a linked Payment Entry).
    if auth.uid() is not null and (auth.uid() = old.approved_by_id or auth.uid() = old.amount_approved_by_id) then
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    -- 0362 FR-PFE-017: Paid without an approved amount only for a purchase that never entered approval (no approver,
    -- no request number, no Requested/Approved event — so a pending or re-opened approval cannot be skipped) and only
    -- with approval_before_payment OFF. Status is changed only by definers, so the event read is not RLS-narrowed.
    if old.approved_total_value is null then
      if old.approved_by_id is not null or old.pr_number is not null
         or exists (select 1 from public.procurement_status_events e
                     where e.procurement_id = old.id
                       and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status))
         or public.procurement_gate(old.org_id, 'approval_before_payment') then
        raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
      end if;
    elsif not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — transition_procurement: 0284 body plus the lines marked `0362` (forward skips, idempotent held step, gates).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null and v_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
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
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
