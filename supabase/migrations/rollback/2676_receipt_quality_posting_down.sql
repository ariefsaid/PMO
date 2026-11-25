-- Reverse 2676: the 2229 body.
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
