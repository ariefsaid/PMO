-- Approved equipment-plan purchase submission; rollback: rollback/2571_equipment_plan_purchase_submit_down.sql.
-- drops: transition_procurement adds only plan-provenance submission and interested-submitter refusal to latest 2001;
-- approve_equipment_plan keeps latest 1882, including all reference, field, approval and attribution checks, and records the plan author as requester.
-- Submission identity uses immutable status events (0194); no new write grant or money calculation.
-- Own-actor read only; field accounts are refused, and tenant scope is checked before provenance.
create function public.equipment_plan_purchase_submit_context(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare p public.procurements; v_plan boolean; v_submitted boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into p from public.procurements where id=p_purchase and org_id=public.auth_org_id();
  if p.id is null then return jsonb_build_object('may_submit',false,'is_submitter',false); end if;
  select exists(select 1 from public.equipment_plan_lines l join public.equipment_plans e on e.id=l.plan_id
    where l.procurement_id=p.id and l.org_id=p.org_id and e.org_id=p.org_id and e.status='Approved') into v_plan;
  select v_plan and exists(select 1 from public.procurement_status_events e
    where e.procurement_id=p.id and e.org_id=p.org_id and e.from_status='Draft' and e.to_status='Requested'
      and e.actor_id=auth.uid() and e.actor_id is distinct from p.requested_by_id) into v_submitted;
  return jsonb_build_object('may_submit',p.status='Draft' and v_plan and public.actor_may_order_purchases(),
                           'is_submitter',v_submitted);
end $$;
revoke all on function public.equipment_plan_purchase_submit_context(uuid) from public, anon;
grant execute on function public.equipment_plan_purchase_submit_context(uuid) to authenticated;

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_wo uuid; v_disc uuid;                                                               -- 1580
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
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency, work_order_id, discipline_id   -- 1580
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency, v_wo, v_disc
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;

  if exists(select 1 from public.procurements where id=p_id and record_only) then
    v_gate := public.record_only_step_refusal(p_id,case p_to::text when 'Ordered' then 'purchase-order' when 'Received' then 'goods-receipt' when 'Vendor Invoiced' then 'purchase-invoice' when 'Paid' then 'paid' when 'Cancelled' then 'cancel' else 'unknown' end,null);
    if v_gate is not null then raise exception '%' ,v_gate using errcode='42501'; end if;
  end if;

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

  if public.record_only_step_refusal(p_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  -- 0749 (#1607): an ERP-owned purchase places its order through the connected system, never as a PMO-only row.
  if p_to = 'Ordered' and public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_id), false) then
    raise exception 'This purchase is managed in your connected system. Record the purchase order to place the order there.'
      using errcode = '42501';
  end if;

  if v_from='Requested' and p_to in ('Approved','Rejected')
    and (public.equipment_plan_purchase_submit_context(p_id)->>'is_submitter')::boolean then
    raise exception 'separation of duties: submitter cannot approve own procurement' using errcode='42501';
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
    if v_project is not null then
      -- 1017: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_project::text, 0));
      if v_category is not null then
        perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
      end if;
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
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester or (public.equipment_plan_purchase_submit_context(p_id)->>'may_submit')::boolean then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
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
        -- 1842 roles-that-decide FR-RTD-009/010: a person who fills one of the organisation's ordering job roles orders an
        -- approved purchase; never one that skipped approval. Everyone else meets today's refusal, worded for ordering.
        if p_to = 'Ordered' and public.actor_may_order_purchases() then                              -- mut:order_gate
          if v_from not in ('Approved', 'Quote Selected') then                                        -- mut:order_approved
            raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
              using errcode = '42501';
          end if;
        elsif p_to = 'Ordered' then
          raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
            using errcode = '42501';
        else
          raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
        end if;
      end if;
    end;
  end if;

  -- 0766 (#1986): a purchase request captured while the purchase was still Draft is the request this transition submits.
  if p_to = 'Requested' then
    select r.id, r.pr_number into v_pr_id, v_pr_no from public.purchase_requests r
     where r.procurement_id = p_id and r.status = 'Draft' and r.import_key is null and r.pr_number is not null
       and (select pr_number from public.procurements where id = p_id) is null
     order by r.created_at limit 1 for update;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, v_pr_no, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' and v_pr_id is not null then
    update public.purchase_requests set status = 'Submitted' where id = v_pr_id;
  elsif p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date, work_order_id, discipline_id)   -- 1580: the request carries its cost attribution
    select p_id, p.pr_number, 'Submitted', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date, work_order_id, discipline_id)   -- 1580: the order carries it too
    select p_id, p.po_number, 'Issued', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, public.native_org_today(v_org))
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', public.native_org_today(v_org),
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

create or replace function public.approve_equipment_plan(p_id uuid) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype; v_type uuid; v_line record;
  v_pid uuid; v_name text; v_note text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_plan from public.equipment_plans where id = p_id and org_id = v_org for update;
  if not found then raise exception 'EQP_NOT_FOUND: the plan is not available' using errcode = '23503'; end if;
  if v_plan.created_by = auth.uid() and not coalesce((select allow_self_approval from public.org_equipment_plan_settings where org_id = v_org), false) then
    raise exception 'EQP_SELF_APPROVAL: you cannot approve your own plan' using errcode = '42501';
  end if;
  if not public.equipment_plan_approver_ok(p_id) then
    raise exception 'EQP_NOT_APPROVER: you cannot approve or reject this plan' using errcode = '42501';
  end if;
  if v_plan.status = 'Approved' then return v_plan; end if;
  if v_plan.status <> 'Submitted' then raise exception 'EQP_STATE: only a submitted plan can be approved' using errcode = '55000'; end if;
  v_type := public.equipment_plan_rental_type(v_org);
  if v_type is null then
    raise exception 'EQP_NO_RENTAL_TYPE: purchase types must be on with an active rental type' using errcode = '55000';
  end if;
  -- Every line's reference is checked before anything is created: a reference held by someone else is refused as such.
  for v_line in
    select l.id from public.equipment_plan_lines l where l.plan_id = p_id and l.procurement_id is null
  loop
    v_pid := md5('eqplan:' || v_line.id::text)::uuid;
    if exists (select 1 from public.procurements p where p.id = v_pid and p.requested_by_id is distinct from auth.uid()) then
      raise exception 'EQP_PID_TAKEN: one of this plan''s purchase references is already in use; save the line again in the Draft plan to pick a new one'
        using errcode = '42501';
    end if;
  end loop;
  for v_line in
    select l.*, w.wo_number, w.title as wo_title, a.name as asset_name, k.name as category_name
      from public.equipment_plan_lines l
      left join public.work_orders w on w.id = l.work_order_id
      left join public.equipment_assets a on a.id = l.equipment_asset_id
      left join public.equipment_plan_categories k on k.id = l.category_id
     where l.plan_id = p_id order by l.date_from, l.id
  loop
    if v_line.procurement_id is not null then continue; end if;
    v_pid := md5('eqplan:' || v_line.id::text)::uuid;
    v_name := left(coalesce(v_line.description, v_line.asset_name), 200);
    v_note := concat_ws(' · ', 'Monthly plan ' || to_char(v_plan.plan_month, 'YYYY-MM'),
                        v_line.category_name);
    perform public.create_procurement_with_items(
      v_pid,
      jsonb_build_object('title', left(v_name, 150) || ' (' || to_char(v_line.date_from, 'YYYY-MM-DD') || ' – ' || to_char(v_line.date_to, 'YYYY-MM-DD') || ')',
                         'project_id', v_plan.project_id, 'vendor_id', v_line.vendor_id, 'purchase_type_id', v_type,
                         'rental_from', v_line.date_from, 'rental_to', v_line.date_to),
      jsonb_build_array(jsonb_build_object('id', md5('eqplanitem:' || v_line.id::text)::uuid, 'name', v_name,
                         'description', v_note, 'quantity', v_line.quantity, 'rate', v_line.rate)));
    -- The equipment-plan author is the requester; the independent Buyer submits it later.
    update public.procurements set requested_by_id=v_plan.created_by where id=v_pid;
    -- 1882: the work order is the purchase line's own column now (it was text in the description), so cost follows it.
    if v_line.work_order_id is not null then
      perform public.set_cost_attribution('procurement_item', array[md5('eqplanitem:' || v_line.id::text)::uuid], v_line.work_order_id, null);
    end if;
    update public.equipment_plan_lines set procurement_id = v_pid where id = v_line.id;
  end loop;
  update public.equipment_plans set status = 'Approved', approved_by = auth.uid(), approved_at = now() where id = p_id returning * into v_plan;
  return v_plan;
end $$;
-- Every request-approval and amount-approval write meets the interested-submitter rule, Admin included.
create function public.guard_equipment_plan_purchase_submitter() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is not null
    and ((new.status='Approved' and old.status is distinct from 'Approved')
         or (new.amount_approved_by_id is distinct from old.amount_approved_by_id and new.amount_approved_by_id=auth.uid()))
    and (public.equipment_plan_purchase_submit_context(old.id)->>'is_submitter')::boolean then
    raise exception 'separation of duties: submitter cannot approve own procurement' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_equipment_plan_purchase_submitter() from public,anon,authenticated;
create trigger procurements_guard_plan_submitter before update on public.procurements
for each row execute function public.guard_equipment_plan_purchase_submitter();

-- Only still-Draft generated purchases change requester; submitted historical purchases keep their record.
update public.procurements p set requested_by_id=e.created_by
from public.equipment_plan_lines l join public.equipment_plans e on e.id=l.plan_id
where l.procurement_id=p.id and e.org_id=p.org_id and l.org_id=p.org_id and e.status='Approved'
  and p.status='Draft' and p.requested_by_id is distinct from e.created_by;

