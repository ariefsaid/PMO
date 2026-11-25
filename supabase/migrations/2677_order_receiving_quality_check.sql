-- 2677: order receiving carries the receiver's quality check to the stock line; reversal takes back only what entered stock (D4, #1125).
-- Latest bodies: receive_order_goods 2227; reverse_order_receiving 2222.
-- drops: receive_order_goods allows two more line fields (rejected, reject_note), builds the stock line with them, and records only the passed quantity on the procurement receipt; reverse_order_receiving reverses received minus rejected. Every other line is unchanged.
-- REVERSE: supabase/migrations/rollback/2677_order_receiving_quality_check_down.sql

create or replace function public.receive_order_goods(p_po uuid, p_warehouse uuid, p_date date, p_lines jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_po public.purchase_orders; v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_r public.order_receiving_requests; v_doc public.stock_documents; v_proc public.procurements;
  e jsonb; v_item public.procurement_items; v_stock uuid; v_qty numeric; v_received numeric;
  v_excess boolean := false; v_fx numeric; v_fx_date date; v_currency text; v_lines jsonb := '[]'; v_receipt uuid;
  v_check jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_po := public.receiving_lock_order(p_po);
  perform public.stock_assert_keeper(v_org, p_warehouse, v_uid);
  perform public.stock_assert_dates(v_org, p_date);
  if p_request is null or p_date is null or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'RGO_COUNTS: Enter counted quantities for at least one order line.' using errcode = '22023';
  end if;
  select * into v_r from public.order_receiving_requests where id = p_request;
  if found then
    if v_r.org_id <> v_org or v_r.receiver_id <> v_uid or v_r.po_id <> p_po or v_r.warehouse_id <> p_warehouse
       or v_r.receipt_date <> p_date or v_r.counted_lines <> p_lines then
      raise exception 'RGO_REFERENCE: This receipt reference already belongs to another count.' using errcode = '23505';
    end if;
    if v_r.stock_document_id is not null then return jsonb_build_object('id', p_request, 'status', 'posted', 'document_id', v_r.stock_document_id); end if;
  end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id;
  select default_currency into v_currency from public.organizations where id = v_org;
  if v_proc.currency = v_currency then v_fx := 1; v_fx_date := p_date;
  else select rate, rate_date into v_fx, v_fx_date from public.fx_rate_on(v_proc.currency, v_currency, p_date); end if;
  if v_fx is null then
    raise exception 'RGO_FX_MISSING: No exchange rate for %/% on %.', v_proc.currency, v_currency, p_date using errcode = '23514', detail=jsonb_build_object('base',v_proc.currency,'quote',v_currency,'date',p_date::text)::text;
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x group by x->>'item_id' having count(*) > 1) then
    raise exception 'RGO_DUPLICATE: Count each order line once.' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('item_id','quantity','rejected','reject_note')) then
      raise exception 'RGO_FIELDS: Enter only the order line and counted quantity.' using errcode = '22023';
    end if;
    v_qty := (e->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or v_qty <> round(v_qty,3) then
      raise exception 'RGO_QUANTITY: Enter a positive counted quantity with at most three decimals.' using errcode = '22023';
    end if;
    select * into v_item from public.procurement_items i where i.id = (e->>'item_id')::uuid and i.procurement_id = v_proc.id and i.org_id = v_org;
    if not found then raise exception 'RGO_NOT_FOUND: Order line not found.' using errcode = 'P0002'; end if;
    select m.stock_item_id into v_stock from public.order_stock_mappings m where m.item_id = v_item.id and m.org_id = v_org;
    if v_stock is null then raise exception 'RGO_UNMAPPED: This line follows the service or direct-use receiving path.' using errcode = '23514'; end if;
    select coalesce(sum(rl.quantity),0) into v_received from public.procurement_receipt_lines rl
      join public.procurement_receipts r on r.id = rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id = r.id
      left join public.order_receiving_reversals rev on rev.request_id = req.id
      where rl.item_id = v_item.id and coalesce(r.erp_docstatus,1) <> 2 and r.erp_cancelled_at is null and rev.request_id is null;
    v_excess := v_excess or v_qty > greatest(v_item.quantity - v_received,0); -- mut:rgo_excess
    v_check := case when e ? 'rejected' then jsonb_build_object('rejected',e->'rejected','reject_note',e->'reject_note') else '{}'::jsonb end;   -- 2677: the receiver's quality check travels to the stock line
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id',v_stock,'quantity',v_qty,'unit_cost',round(v_item.rate * v_fx,4)) || v_check); -- mut:rgo_cost
  end loop;
  if v_r.id is null then
    insert into public.order_receiving_requests(id,org_id,po_id,receiver_id,warehouse_id,receipt_date,counted_lines)
      values(p_request,v_org,p_po,v_uid,p_warehouse,p_date,p_lines) returning * into v_r;
  end if;
  if v_excess and not public.order_receiving_approval_current(p_request) then
    return jsonb_build_object('id',p_request,'status','awaiting_approval');
  end if;
  perform public.stock_validate_payload(v_org,'receive',jsonb_build_object('warehouse_id',p_warehouse),v_lines);
  insert into public.stock_documents(org_id,number,kind,warehouse_id,procurement_id,occurred_on,created_by)
    values(v_org,public.next_procurement_doc_number(v_org,'GR'),'receive',p_warehouse,v_proc.id,p_date,v_uid) returning * into v_doc;
  update public.order_receiving_requests set stock_document_id = v_doc.id, fx_rate = v_fx, fx_date = v_fx_date,
    source_currency = v_proc.currency, stock_currency = v_currency where id = p_request;
  perform public.stock_insert_lines(v_doc,v_lines);
  perform public.stock_post_core(v_doc.id);
  insert into public.procurement_receipts(org_id,procurement_id,po_id,gr_number,receipt_date,status)
    values(v_org,v_proc.id,p_po,v_doc.number,p_date,'Partial') returning id into v_receipt;
  insert into public.procurement_receipt_lines(receipt_id,item_id,org_id,quantity,recorded_by)
    select v_receipt,(x->>'item_id')::uuid,v_org,(x->>'quantity')::numeric - coalesce(nullif(x->>'rejected','')::numeric,0),v_uid from jsonb_array_elements(p_lines) x
     where (x->>'quantity')::numeric - coalesce(nullif(x->>'rejected','')::numeric,0) > 0;   -- 2677: only the passed part counts as received against the order
  update public.order_receiving_requests set receipt_id = v_receipt where id = p_request;
  perform public.log_audit('order.receive',v_org,v_uid,p_request,jsonb_build_object('stock_document_id',v_doc.id,'receipt_id',v_receipt));
  return jsonb_build_object('id',p_request,'status','posted','document_id',v_doc.id);
end $$;

create or replace function public.reverse_order_receiving(p_request uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.order_receiving_requests; source public.stock_documents; d public.stock_documents; ls jsonb;
begin
  perform public.assert_not_light(); perform public.assert_is_active_member();
  select * into r from public.order_receiving_requests where id=p_request and org_id=public.auth_org_id();
  if not found then raise exception 'RGO_RECEIPT_MISSING: Receipt not found.' using errcode='P0002'; end if;
  perform public.receiving_lock_order(r.po_id);
  select * into r from public.order_receiving_requests where id=p_request for update;
  if not public.order_receiving_purchaser() or r.receiver_id=auth.uid() then
    raise exception 'RGO_REVERSE_ROLE: A different purchasing user must reverse this receipt.' using errcode='42501';
  end if;
  if r.stock_document_id is null then raise exception 'RGO_NOT_POSTED: This receipt has not posted.' using errcode='23514'; end if;
  select stock_document_id into d.id from public.order_receiving_reversals where request_id=r.id;
  if found then return d.id; end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'RGO_REVERSE_REASON: Give a reason for reversing this receipt.' using errcode='22023'; end if;
  select * into source from public.stock_documents where id=r.stock_document_id;
  select jsonb_agg(jsonb_build_object('item_id',item_id,'quantity',quantity-coalesce(qty_rejected,0),'direction','out') order by line_no) into ls
    from public.stock_document_lines where document_id=source.id and quantity-coalesce(qty_rejected,0)>0;   -- 2677: only what entered stock goes back out
  if ls is null then raise exception 'RGO_NOTHING_TO_REVERSE: Nothing from this receipt entered stock.' using errcode='23514'; end if;
  perform public.stock_validate_payload(r.org_id,'adjustment',jsonb_build_object('warehouse_id',r.warehouse_id,'reason',p_reason),ls);
  -- The receiver authored the count being corrected; the purchasing caller posts its correction under the existing two-person stock rule.
  insert into public.stock_documents(org_id,number,kind,warehouse_id,occurred_on,reason,created_by)
    values(r.org_id,public.next_procurement_doc_number(r.org_id,'ADJ'),'adjustment',r.warehouse_id,public.stock_org_today(r.org_id),p_reason,r.receiver_id) returning * into d;
  perform public.stock_insert_lines(d,ls);
  perform public.stock_post_core(d.id);
  insert into public.order_receiving_reversals(request_id,org_id,stock_document_id,reason,reversed_by) values(r.id,r.org_id,d.id,p_reason,auth.uid());
  perform public.log_audit('order.receive_reverse',r.org_id,auth.uid(),r.id,jsonb_build_object('stock_document_id',d.id,'reason',p_reason));
  return d.id;
end $$;
