-- 0475_subcontract_erp_guards.sql — #1513 S5: connected-mode and ERP-origin guards for subcontract purchases.
-- A queued subcontract purchase-invoice that carries no BoQ lines is refused at claim time (FR-SCA-022, PQ-9); an
-- ERP-origin bill that is not attributed to BoQ lines, or a linked ERP Purchase Invoice, is a reconciliation exception
-- that blocks PMO payment (OQ-10, PQ-10); the purchase-order.revise push is refused when it would cancel a billed PO
-- (AC-SCA-012, DB half).
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S5.
-- Proven by supabase/tests/subcontract_erp_guards.test.sql, the shipped callers (procurement_payment_allowed,
-- procurement_queue_gate) and the 0178 allow-list.
-- ── REVERSE (also rollback/0475_subcontract_erp_guards_down.sql) ──
--   restore procurement_payment_allowed from 0368 §1, procurement_create_refusal and guard_procurement_approved_total
--   from 0474; drop attribute_subcontract_bill_lines(uuid,jsonb), subcontract_cap_exceptions(uuid),
--   po_revision_push_refusal(uuid,uuid,integer,boolean); Attributed bill lines already written stay (rollback 0472 refuses).

-- §1 OQ-10 reconciliation exceptions: ONE invoker read serving both callers. The UI sees what the caller's RLS allows
-- (an Engineer sees no bill rows, D6); procurement_payment_allowed (a definer) sees every row. A mirrored bill carries no
-- BoQ lines, and a linked ERP Purchase Invoice is not a PMO bill row at all, so neither can be checked against the cap.
create or replace function public.subcontract_cap_exceptions(p_procurement_id uuid)
  returns table (invoice_id uuid, erp_purchase_document_id uuid, number text, amount numeric, reason text)
  language sql stable security invoker set search_path = public as $$
  select i.id, null::uuid, i.vi_number, i.amount, 'no_lines'
    from public.procurements p
    join public.procurement_invoices i on i.procurement_id = p.id
   where p.id = p_procurement_id and p.is_subcontract
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = p.id)
     and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
     and not exists (select 1 from public.procurement_invoice_lines l where l.invoice_id = i.id)
  union all
  select null::uuid, d.id, d.erp_name, d.grand_total, 'erp_linked_unattributed'
    from public.procurements p
    join public.procurement_erp_links k on k.procurement_id = p.id
    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
   where p.id = p_procurement_id and p.is_subcontract
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = p.id)
     and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned
$$;
revoke all on function public.subcontract_cap_exceptions(uuid) from public, anon;
grant execute on function public.subcontract_cap_exceptions(uuid) to authenticated;

-- §2 0368 §1 verbatim plus the OQ-10 refusal before the final return (line marked 0475). The Paid update guard, the ERP
-- payment dispatch and the outbox claim all ask this one function, so all three refuse together.
create or replace function public.procurement_payment_allowed(p_procurement_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  if v_row.status is null or v_row.status::text in ('Cancelled','Rejected') then return 'purchase_closed'; end if;
  -- Awaiting approval, including a purchase a quote above its approved amount sent back.
  if v_row.status = 'Requested' then return 'awaiting_approval'; end if;
  -- 0362 FR-PFE-017: without an approved amount, only a purchase that never entered approval (no approver, no request
  -- number, no Requested/Approved event) and only with approval_before_payment OFF.
  if v_row.approved_total_value is null then
    if v_row.approved_by_id is not null or v_row.pr_number is not null
       or exists (select 1 from public.procurement_status_events e
                   where e.procurement_id = v_row.id
                     and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status)) then
      return 'approval_missing';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_payment') then
      return 'gate_approval_before_payment';
    end if;
  end if;
  if exists (select 1 from public.subcontract_cap_exceptions(v_row.id)) then return 'subcontract_cap_exception'; end if; -- 0475
  return null;
end $$;

-- §3 0474's Paid guard verbatim, with the new reason named in the refusal message (line marked 0475). Without it the
-- generic "no recorded approved amount" text would explain the wrong thing.
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare v_reason text;                                                                                   -- 0368
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
    if auth.uid() is not null and public.procurement_amount_approver(old.id, auth.uid()) then                -- 0474
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    -- 0368: the payment rule (§1) — closed, awaiting approval, or 0362 FR-PFE-017's "never entered approval and
    -- approval_before_payment OFF" when no approved amount is recorded. This is a BEFORE trigger, so §1 reads the
    -- row as it stands before this update (the old values).
    v_reason := public.procurement_payment_allowed(old.id);                                              -- 0368
    if v_reason is not null then                                                                         -- 0368
      raise exception '%', case v_reason                                                                 -- 0368
          when 'awaiting_approval' then public.procurement_gate_message('awaiting_approval')            -- 0368
          when 'purchase_closed' then 'This purchase is closed.'                                         -- 0368
          when 'subcontract_cap_exception' then case                                                      -- 0475 one remedy per cause
            when exists (select 1 from public.subcontract_cap_exceptions(old.id) x where x.reason = 'no_lines')
              then 'A subcontract bill is not attributed to BoQ lines; attribute its lines or have it cancelled in the ERP before payment.'
            else 'A linked ERP Purchase Invoice cannot be attributed to BoQ lines; cancel or unlink it in the ERP before payment.' end
          else 'Cannot pay without a recorded approved amount.' end                                      -- 0368
        using errcode = '23514', detail = v_reason;                                                      -- 0368
    elsif old.approved_total_value is not null                                                          -- 0368
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

-- §4 0474's refusal verbatim plus the PQ-9 branch (lines marked 0475). Same signature, so claim_outbox_for_commit (0373)
-- and the edge function's reissue check pick it up with no code change. Grants are kept by `create or replace`.
create or replace function public.procurement_create_refusal(
  p_org_id uuid, p_procurement_id uuid, p_erp_doc_kind text, p_actor_user_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_step public.procurement_status;
  v_proc public.procurements;
  v_refusal text;
begin
  v_step := case p_erp_doc_kind
    when 'purchase-order'   then 'Ordered'::public.procurement_status
    when 'goods-receipt'    then 'Received'::public.procurement_status
    when 'purchase-invoice' then 'Vendor Invoiced'::public.procurement_status
    when 'payment'          then 'Paid'::public.procurement_status
  end;
  -- The foreground gate asks nothing of other kinds; neither does this.
  if v_step is null then return null; end if;
  if p_procurement_id is not null then
    select * into v_proc from public.procurements
     where id = p_procurement_id and org_id = p_org_id for update;
  end if;
  if v_proc.id is null then return 'purchase_not_found'; end if;
  if p_erp_doc_kind = 'purchase-invoice' and v_proc.is_subcontract                                       -- 0475
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = v_proc.id) then -- 0475
    return 'subcontract_bill_lines_required';  -- PQ-9: #1505 replaces this with the cap over the payload  -- 0475
  end if;                                                                                                 -- 0475
  -- A payment: 0368's payment rule first (closed / awaiting approval / approval missing), then the order-step rules.
  if p_erp_doc_kind = 'payment' then
    v_refusal := public.procurement_payment_allowed(v_proc.id);
  end if;
  if v_refusal is null then
    v_refusal := public.procurement_gate_violation(v_proc.id, v_step);
  end if;
  if v_refusal is null and p_erp_doc_kind = 'payment' then
    if p_actor_user_id is null then
      v_refusal := 'actor_missing';
    elsif public.procurement_amount_approver(v_proc.id, p_actor_user_id) then                                 -- 0474
      v_refusal := 'separation_of_duties';
    elsif (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
      v_refusal := 'exceeds_approved_amount';
    end if;
  end if;
  return v_refusal;
end $$;

-- §5 PQ-10 (a): Admin / Finance attributes BoQ line quantities to a mirrored bill; the SAME cap (D3) decides. Order (D5):
-- procurements row FOR UPDATE, then the PO lock. The caller's authority is checked BEFORE any lookup, and a bill outside
-- the caller's org answers exactly like a missing one.
create or replace function public.attribute_subcontract_bill_lines(p_invoice_id uuid, p_lines jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_inv public.procurement_invoices; v_proc public.procurements; v_po uuid;
        v_rev integer; v_v jsonb; v_net numeric; v_lines_net numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_inv from public.procurement_invoices where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id and org_id = v_org for update;   -- D5 row first
  select * into v_inv from public.procurement_invoices where id = p_invoice_id;                                   -- re-read under the lock
  if v_proc.status::text in ('Cancelled','Rejected') then                                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  select r.po_id into v_po from public.purchase_order_revisions r where r.procurement_id = v_proc.id and r.revision = 1;
  if not v_proc.is_subcontract or v_po is null then
    raise exception 'this purchase has no issued BoQ lines; there is nothing to attribute the bill to' using errcode = 'SC002';
  end if;
  perform public.subcontract_po_lock(v_po);                                                                        -- D5 then the PO
  if not public.subcontract_bill_is_live(v_inv.erp_docstatus, v_inv.erp_cancelled_at) then
    raise exception 'this bill is cancelled' using errcode = '23514'; end if;
  if exists (select 1 from public.procurement_invoice_lines where invoice_id = p_invoice_id)
     or (v_inv.po_id is not null and v_inv.po_id <> v_po) then
    raise exception 'this bill already states its BoQ lines' using errcode = '23514'; end if;
  v_rev := public.po_effective_revision(v_po);
  v_v := public.subcontract_bill_cap_violation(v_po, p_lines, p_invoice_id);                                       -- D3, NFR-SCA-004: fail closed
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be billed: verified %, PO %, billed %, this bill %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    if v_v->>'reason' = 'line_not_on_po' then
      raise exception 'line % is not on this purchase order; the bill is refused', coalesce(v_v->>'item_code', v_v->>'boq_item_id')
        using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); the bill is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric)
              left join public.purchase_order_lines pl on pl.po_id = v_po and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null or x.rate is null or x.rate > pl.rate or x.rate <> round(x.rate, 2)
                 or x.quantity is null or x.quantity <= 0 or x.quantity <> round(x.quantity, 3))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each bill line must be a distinct BoQ line of this PO at no more than the PO rate' using errcode = '23514'; -- FR-SCA-023
  end if;
  select coalesce(sum(round(x.quantity * x.rate, 2)), 0) into v_lines_net
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  v_net := case when btrim(v_inv.tax_treatment) = 'inclusive' then v_inv.amount - v_inv.tax_amount else v_inv.amount end;
  if v_net is distinct from v_lines_net then
    raise exception 'the bill''s pre-tax amount % must equal its lines %', v_net, v_lines_net using errcode = '23514';
  end if;
  perform set_config('pmo.subcontract_capture', 'on', true);
  insert into public.procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate, attributed_by)
  select p_invoice_id, x.boq_item_id, x.quantity, x.rate, auth.uid()
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  perform set_config('pmo.subcontract_capture', '', true);
  update public.procurement_invoices set po_id = v_po where id = p_invoice_id;
  perform public.log_audit('procurement_invoice.attribute_lines', v_proc.org_id, auth.uid(), p_invoice_id,
    jsonb_build_object('po_id', v_po, 'revision', v_rev, 'lines', (
      select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'quantity', x.quantity, 'rate', x.rate)
                                order by x.boq_item_id), '[]'::jsonb)
        from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric))));   -- normalised, never the raw client JSON
end $$;
revoke all on function public.attribute_subcontract_bill_lines(uuid, jsonb) from public, anon;
grant execute on function public.attribute_subcontract_bill_lines(uuid, jsonb) to authenticated;

-- §6 AC-SCA-012 (DB half): may the effective lines of this PMO revision be pushed to the ERP? Asked by the edge function
-- before any ERP write. Service role only. Anything it cannot answer is a refusal. A revise that cancels the ERP order
-- (ERPNext amend) is refused when a non-cancelled bill exists on the purchase, whether a PMO bill row or a linked ERP
-- Purchase Invoice; an unknown revise kind (null) is treated as cancelling.
create or replace function public.po_revision_push_refusal(p_org uuid, p_po_id uuid, p_revision integer, p_revise_cancels boolean)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_proc uuid;
begin
  select o.procurement_id into v_proc from public.purchase_orders o where o.id = p_po_id and o.org_id = p_org;
  if v_proc is null then return 'po_not_found'; end if;
  if p_revision is null or not exists (select 1 from public.purchase_order_revisions r
                                        where r.po_id = p_po_id and r.revision = p_revision and r.status = 'Issued') then
    return 'revision_not_issued';
  end if;
  if coalesce(p_revise_cancels, true) and (
       exists (select 1 from public.procurement_invoices i
                where i.procurement_id = v_proc and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at))
       or exists (select 1 from public.procurement_erp_links k
                    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
                   where k.procurement_id = v_proc and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned)) then
    return 'po_has_submitted_bill';
  end if;
  return null;
end $$;
revoke all on function public.po_revision_push_refusal(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.po_revision_push_refusal(uuid, uuid, integer, boolean) to service_role;

-- Closing self-assertion: no anon execute anywhere, the push refusal is not client-executable, the attribution is.
do $$
begin
  if has_function_privilege('anon', 'public.attribute_subcontract_bill_lines(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.subcontract_cap_exceptions(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.po_revision_push_refusal(uuid,uuid,integer,boolean)', 'EXECUTE') then
    raise exception '0475: a subcontract ERP guard is anon-executable';
  end if;
  if has_function_privilege('authenticated', 'public.po_revision_push_refusal(uuid,uuid,integer,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.procurement_payment_allowed(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.procurement_create_refusal(uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception '0475: an internal guard is client-executable';
  end if;
end $$;
