-- 2676: receiving posts only the passed quantity and refuses a flagged item that carries no check (D4, #1125).
-- Latest body: stock_apply_receive 2229. Every path that writes a receive document (the Receive stock form, order receiving, a client-material pickup) ends here.
-- drops: the ledger write inside the loop uses the passed quantity (received minus rejected) instead of the received quantity; every other line is unchanged.
-- REVERSE: supabase/migrations/rollback/2676_receipt_quality_posting_down.sql (the 2229 body)

create or replace function public.stock_apply_receive(p_doc public.stock_documents, p_post boolean) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare l record;
  v_pass numeric;
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
  -- 2676 (D4): an item flagged for a quality check is received only with its check on the line (how many passed, how many rejected).
  if exists (select 1 from public.stock_document_lines sl join public.stock_items i on i.id = sl.item_id
              where sl.document_id = p_doc.id and i.needs_quality_check and sl.qty_rejected is null) then                -- mut:quality_gate
    raise exception 'STK_QUALITY_RECEIPT: this item needs a quality check: record how many passed and how many were rejected' using errcode = 'P0001';
  end if;
  if not p_post then return; end if;
  perform public.stock_lock_for_document(p_doc);
  for l in select * from public.stock_document_lines where document_id = p_doc.id order by line_no loop
    v_pass := l.quantity - coalesce(l.qty_rejected, 0);                                                                  -- mut:passed_only
    if v_pass > 0 then   -- a wholly rejected line stays on the receipt and never reaches the ledger
      perform public.stock_write_entry(p_doc, l.id, l.item_id, p_doc.warehouse_id, v_pass, round(v_pass * l.unit_cost, 2), null, null, null);
    end if;
  end loop;                                        -- the procurement case itself is never touched (OQ-STK-9, AC-STK-029)
end $$;
