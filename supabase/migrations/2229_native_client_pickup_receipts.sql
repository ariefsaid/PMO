-- Client-material pickup remains a server-valued native receipt alongside purchase-order receiving.
-- Latest bodies: stock_apply_receive 2221; csr_record_pickup 2091, including its field-account guard.
-- drops: csr_record_pickup composes the existing private stock primitives instead of the generic creator, and records its private pickup witness before posting; stock_apply_receive extends its order-witness predicate with that private client witness. Quantity, reservation, tenancy and zero-cost rules are retained.
create or replace function public.stock_apply_receive(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record;
begin
  if exists(select 1 from public.order_receiving_settings s where s.org_id=p_doc.org_id and s.enabled)
     and not exists(select 1 from public.order_receiving_requests r where r.stock_document_id=p_doc.id and r.org_id=p_doc.org_id)
     and not exists (
       select 1 from public.client_requisition_pickups p
       join public.client_requisition_lines c on c.id=p.line_id and c.org_id=p.org_id
       join public.client_requisitions q on q.id=p.requisition_id and q.id=c.requisition_id and q.org_id=p.org_id
       join public.stock_document_lines sl on sl.document_id=p.stock_document_id and sl.org_id=p.org_id
       join public.stock_items si on si.id=sl.item_id and si.id=c.stock_item_id and si.org_id=p.org_id
       join public.stock_tags t on t.id=si.tag_id and t.org_id=p.org_id and t.zero_cost
       where p.stock_document_id = p_doc.id and p.org_id=p_doc.org_id
         and p.warehouse_id=p_doc.warehouse_id and p.recorded_by=p_doc.created_by
         and p.picked_up_on=p_doc.occurred_on and p_doc.procurement_id is null
         and q.work_order_id=p_doc.work_order_id and q.status='open'
         and sl.quantity=p.quantity and sl.unit_cost=0
         and (select count(*) from public.stock_document_lines all_lines where all_lines.document_id=p_doc.id)=1
     ) then
    raise exception 'RGO_USE_ORDER: Receive these goods against their purchase order.' using errcode='23514';
  end if;
  if p_doc.procurement_id is not null
     and not exists (select 1 from public.procurements pr where pr.id = p_doc.procurement_id and pr.org_id = p_doc.org_id) then
    raise exception 'STK_NOT_FOUND: the procurement case is not in your organisation' using errcode = 'P0001';       -- AC-STK-029
  end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, l.quantity, round(l.quantity * l.unit_cost, 2), null, null, null);
  end loop;                                        -- the procurement case itself is never touched (OQ-STK-9, AC-STK-029)
end $$;

create or replace function public.csr_record_pickup(p_line_id uuid, p_quantity numeric, p_warehouse_id uuid, p_picked_up_on date default null,
    p_collector text default null, p_paper_reference text default null, p_client_request_id uuid default null) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); l public.client_requisition_lines; r public.client_requisitions; f record;
  v_zero boolean; v_whole boolean; v_on date; v_doc uuid; v_pickup uuid; v_still numeric; v_collector text; v_paper text;
  v_header jsonb; v_lines jsonb; v_stock public.stock_documents; v_override boolean;
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_client_request_id is not null then                                                                      -- FR-CSR-015: a replay returns the original
    select p.id into v_pickup from public.client_requisition_pickups p
     where p.org_id = v_org and p.recorded_by = v_uid and p.client_request_id = p_client_request_id;
    if v_pickup is not null then return v_pickup; end if;
  end if;
  perform public.stock_assert_standalone(v_org);                                                               -- FR-CSR-016: before any row
  l := public.csr_lock_line(v_org, p_line_id);
  select * into r from public.client_requisitions x where x.id = l.requisition_id;
  select coalesce(t.zero_cost, false), u.whole_only into v_zero, v_whole
    from public.stock_items i join public.stock_units u on u.id = i.unit_id left join public.stock_tags t on t.id = i.tag_id
   where i.id = l.stock_item_id;
  if not coalesce(v_zero, false) then                                                                          -- mut:zero_cost_tag
    raise exception 'CSR_NOT_CLIENT_SUPPLIED: This item is not client-supplied' using errcode = 'P0001'; end if;
  if not public.csr_valid_quantity(p_quantity, coalesce(v_whole, false)) then
    raise exception 'CSR_INVALID: a pickup needs a quantity above 0 (3 decimals at most, whole units where the unit demands it)' using errcode = 'P0001'; end if;
  v_collector := nullif(btrim(p_collector), '');
  v_paper := nullif(btrim(p_paper_reference), '');
  if length(coalesce(v_collector, '')) > 200 or length(coalesce(v_paper, '')) > 200 then
    raise exception 'CSR_INVALID: the collector and the delivery paper reference are 200 characters at most' using errcode = 'P0001'; end if;
  select * into f from public.csr_line_figures(l.id);
  v_still := f.reserved - f.collected;
  if p_quantity > v_still then                                                                                 -- mut:still_to_collect
    raise exception 'CSR_OVER_COLLECT: only % is still to collect', trim_scale(greatest(v_still, 0))::text using errcode = 'P0001'; end if;
  v_on := coalesce(p_picked_up_on, public.stock_org_today(v_org));
  -- The receipt uses the shared stock validation, keeper, date, line and posting primitives (0413/0534).
  -- Unit cost is 0 by construction (spec FR-CSR-012); the payload carries no client cost.
  v_header := jsonb_build_object('kind', 'receive', 'warehouse_id', p_warehouse_id, 'occurred_on', v_on,
                       'note', left(concat_ws(' · ', r.number, v_paper, v_collector), 500));
  v_lines := jsonb_build_array(jsonb_build_object('item_id', l.stock_item_id, 'quantity', p_quantity, 'unit_cost', 0));
  perform public.stock_validate_payload(v_org, 'receive', v_header, v_lines);
  v_override := public.stock_assert_keeper(v_org, p_warehouse_id, v_uid);
  perform public.stock_assert_dates(v_org, v_on);
  insert into public.stock_documents(org_id,number,kind,warehouse_id,occurred_on,note,created_by)
    values(v_org,public.next_procurement_doc_number(v_org,public.stock_doc_prefix('receive')),
           'receive',p_warehouse_id,v_on,v_header->>'note',v_uid) returning * into v_stock;
  v_doc := v_stock.id;
  perform public.stock_insert_lines(v_stock, v_lines);
  if v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc,
      jsonb_build_object('kind','receive','warehouse_id',p_warehouse_id,'number',v_stock.number));
  end if;
  -- Check 1161's rule trigger: the receiving location's project must be the work order's.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  insert into public.client_requisition_pickups (org_id, requisition_id, line_id, quantity, picked_up_on, collector, paper_reference,
                                                 warehouse_id, stock_document_id, client_request_id, recorded_by)
  values (v_org, r.id, l.id, p_quantity, v_on, v_collector, v_paper, p_warehouse_id, v_doc, p_client_request_id, v_uid)
  returning id into v_pickup;
  -- The private pickup witness and its zero-cost line exist before the stock engine posts; one transaction owns both.
  perform public.post_stock_document(v_doc);
  perform public.csr_log(v_org, r.id, l.id, 'pickup', p_quantity, null, v_on, null, v_pickup, p_client_request_id);
  return v_pickup;
end $$;
