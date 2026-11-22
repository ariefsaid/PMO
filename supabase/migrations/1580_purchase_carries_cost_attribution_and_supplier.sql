-- 1580_purchase_carries_cost_attribution_and_supplier.sql
-- drops: check_cost_attribution, create_procurement_with_items and transition_procurement rewrite single lines to carry the purchase's work order and discipline; no rule is removed.
-- Fix lane walk-purchasing (cost attribution, order supplier).
--   * procurements gain work_order_id / discipline_id: a purchase says where its cost goes when it is raised; its
--     request and order records are stamped with it (the receipt and bill forms start from it on the screen).
--   * check_cost_attribution (1296's body) gains the 'procurements' case, so the header's work order must be on the
--     purchase's own project, the same rule as every other cost record.
--   * create_procurement_with_items accepts the two keys and transition_procurement stamps the request and order records.
--     Both are restated from their newest definition: the 1351 / 1017 bodies with the 1461 light-account guard line
--     (`perform public.assert_not_light();`, first statement of the outer block) kept.
--   * An order recorded by a signed-in person always names a supplier: a before-insert gate on purchase_orders raises
--     ORDER_NEEDS_SUPPLIER (23514) for every path (the transition, create_purchase_order, a direct insert). It does not
--     apply without a signed-in person (the accounting-system mirror runs as service role), to a purchase that predates the
--     connected system, or to origin = 'erp_link'. It runs after the record gate, so each existing refusal keeps its message.
-- Reverse: rollback/1580_purchase_carries_cost_attribution_and_supplier_down.sql.

alter table public.procurements
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
create index procurements_work_order_idx on public.procurements (work_order_id) where work_order_id is not null;

create or replace function public.check_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if tg_table_name = 'expense_claims' then
    -- Nested, never `and`: plpgsql does not short-circuit, and only this table has a `kind` field on every row type here.
    if new.kind = 'advance' and (new.work_order_id is not null or new.discipline_id is not null) then
      raise exception 'COST_ADVANCE: a cash advance is not a cost; name the work order on the claim that settles it' using errcode = '23514';
    end if;
  end if;
  if new.work_order_id is not null then
    case tg_table_name
      when 'timesheet_entries', 'equipment_usage_entries', 'expense_claims', 'procurements' then   -- 1580: a purchase's own header
        v_project := new.project_id;
      when 'stock_documents' then
        if new.kind in ('issue', 'return') then
          v_project := new.project_id;
        elsif new.kind = 'transfer' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        elsif new.kind = 'receive' then                                                       -- mut:receive_branch
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');   -- mut:receive_central
        end if;
      else
        select p.project_id into v_project from public.procurements p
         where p.id = new.procurement_id and p.org_id = new.org_id;
    end case;
    if v_project is null then
      raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514';
    end if;
    select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status
      from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then   -- mut:receive_project
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
    end if;
    -- A cancelled work order takes no NEW costs; a row already on it keeps it (it was valid when written).
    if v_wo_status = 'Cancelled' and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
      raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
    end if;
  end if;
  if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id) then
    if not exists (select 1 from public.cost_disciplines d
                    where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
      raise exception 'COST_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_cost_attribution() from public, anon, authenticated;

create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id
  on public.procurements for each row execute function public.check_cost_attribution();

create function public.guard_purchase_order_supplier() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_vendor uuid; v_origin text;
begin
  if auth.uid() is null then return new; end if;   -- the accounting-system mirror runs as service role
  select p.vendor_id, p.origin into v_vendor, v_origin from public.procurements p where p.id = new.procurement_id;
  if v_vendor is null and v_origin is distinct from 'erp_link'
     and not coalesce(public.pre_cutover_procurement(new.procurement_id), false) then
    raise exception 'ORDER_NEEDS_SUPPLIER: choose the supplier before the order is recorded' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_supplier() from public, anon, authenticated;
create trigger zz_purchase_orders_supplier before insert on public.purchase_orders
  for each row execute function public.guard_purchase_order_supplier();

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
    select p_id, p.pr_number, 'Submitted', current_date,
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date, work_order_id, discipline_id)   -- 1580: the order carries it too
    select p_id, p.po_number, 'Issued', current_date,
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
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

create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
  v_subcontract boolean;                                                                          -- 0449
  v_ptype uuid; v_rfrom date; v_rto date; v_ext uuid;                                              -- 1351
  v_wo uuid; v_disc uuid;                                                                          -- 1580
begin
  perform public.assert_not_light();
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category','is_subcontract','purchase_type_id','rental_from','rental_to','extends_procurement_id','work_order_id','discipline_id'))   -- 0449, 1351, 1580
     or exists (select 1 from unnest(array['purchase_type_id','rental_from','rental_to','extends_procurement_id']) k
          where p_header ? k and jsonb_typeof(p_header->k) not in ('string','null'))                                                   -- 1351
     or exists (select 1 from unnest(array['work_order_id','discipline_id']) k
          where p_header ? k and jsonb_typeof(p_header->k) not in ('string','null'))                                                   -- 1580
     or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')                                      -- 0449
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate'))
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))) then
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
  v_subcontract := coalesce((p_header->>'is_subcontract')::boolean, false);                       -- 0449
  v_ptype := (p_header->>'purchase_type_id')::uuid; v_rfrom := (p_header->>'rental_from')::date;     -- 1351
  v_rto := (p_header->>'rental_to')::date; v_ext := (p_header->>'extends_procurement_id')::uuid;      -- 1351
  v_wo := (p_header->>'work_order_id')::uuid; v_disc := (p_header->>'discipline_id')::uuid;           -- 1580
  if (v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org))
     or (v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org)) then
    raise exception 'Reference is not available' using errcode = '23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x group by (x->>'id')::uuid having count(*) > 1) then
    raise exception 'Duplicate line ID' using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_intent from public.procurement_create_intents where procurement_id=p_id;
  if found and (v_intent.org_id is distinct from v_org or v_intent.actor_id is distinct from v_uid
      or v_intent.header is distinct from p_header or v_intent.items is distinct from p_items) then
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category,is_subcontract,purchase_type_id,rental_from,rental_to,extends_procurement_id,work_order_id,discipline_id)   -- 0449, 1351, 1580
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category,v_subcontract,v_ptype,v_rfrom,v_rto,v_ext,v_wo,v_disc)                  -- 0449, 1351, 1580
  on conflict (id) do nothing;
  select * into v_parent from public.procurements where id=p_id for update;
  if v_parent.org_id is distinct from v_org or v_parent.requested_by_id is distinct from v_uid
     or v_parent.status <> 'Draft' then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if v_parent.title is distinct from p_header->>'title' or v_parent.project_id is distinct from v_project
     or v_parent.vendor_id is distinct from v_vendor or v_parent.budget_category is distinct from v_category
     or v_parent.is_subcontract is distinct from v_subcontract                                                          -- 0449
     or v_parent.purchase_type_id is distinct from v_ptype or v_parent.rental_from is distinct from v_rfrom
     or v_parent.rental_to is distinct from v_rto or v_parent.extends_procurement_id is distinct from v_ext
     or v_parent.work_order_id is distinct from v_wo or v_parent.discipline_id is distinct from v_disc then   -- 1351, 1580
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  for v_item in select * from jsonb_to_recordset(p_items) as x(id uuid,name text,description text,quantity numeric,rate numeric) loop
    insert into public.procurement_items (id,org_id,procurement_id,name,description,quantity,rate)
    values (v_item.id,v_org,p_id,v_item.name,v_item.description,v_item.quantity,v_item.rate)
    on conflict (id) do nothing;
    select * into v_existing from public.procurement_items where id=v_item.id;
    if v_existing.org_id is distinct from v_org or v_existing.procurement_id is distinct from p_id
       or v_existing.name is distinct from v_item.name or v_existing.description is distinct from v_item.description
       or v_existing.quantity is distinct from round(v_item.quantity,2) or v_existing.rate is distinct from round(v_item.rate,2) then
      raise exception 'Saved procurement line differs from request' using errcode = '23505';
    end if;
  end loop;
  if exists (select 1 from public.procurement_items i where i.procurement_id=p_id and i.org_id=v_org
       and not exists (select 1 from jsonb_array_elements(p_items) x where (x->>'id')::uuid=i.id)) then
    raise exception 'Saved procurement lines differ from request' using errcode = '23505';
  end if;
  insert into public.procurement_create_intents (procurement_id,org_id,actor_id,header,items)
  values (p_id,v_org,v_uid,p_header,p_items) on conflict (procurement_id) do nothing;
  return v_parent;
end $$;
revoke all on function public.create_procurement_with_items(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_procurement_with_items(uuid,jsonb,jsonb) to authenticated;
