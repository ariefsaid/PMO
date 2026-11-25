-- 2678: the receiving read says which order lines need a quality check, so the receive screen asks for it (D4, #1125).
-- Latest body: read_order_receiving 2227.
-- drops: each line also carries needs_quality_check (false when the line has no stock item); every other line is unchanged.
-- REVERSE: supabase/migrations/rollback/2678_order_receiving_read_quality_down.sql

create or replace function public.read_order_receiving(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_purchaser boolean; v_lines jsonb; v_requests jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po and org_id = v_org;
  if not found then raise exception 'RGO_ORDER_MISSING: Order not found.' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.order_receiving_settings where org_id=v_org and enabled) then return null; end if;
  v_purchaser := public.order_receiving_purchaser();
  if not v_purchaser and not public.actor_holds_job_role('storekeeper') and not exists
    (select 1 from public.stock_warehouse_keepers k where k.org_id=v_org and k.user_id=auth.uid()) then
    raise exception 'RGO_READ_ROLE: Receiving is for warehouse keepers and purchasing users.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'stock_item_id',m.stock_item_id,'stock_name',s.name,'unit',u.code,'needs_quality_check',coalesce(s.needs_quality_check,false))
    || case when v_purchaser then jsonb_build_object('ordered',i.quantity::text,'received',coalesce(rc.q,0)::text,
       'outstanding',greatest(i.quantity-coalesce(rc.q,0),0)::text,
       'status',case when coalesce(rc.q,0)=0 then 'not_received' when rc.q<i.quantity then 'partly_received' else 'fully_received' end) else '{}'::jsonb end order by i.id),'[]') into v_lines
    from public.procurement_items i left join public.order_stock_mappings m on m.item_id=i.id
    left join public.stock_items s on s.id=m.stock_item_id left join public.stock_units u on u.id=s.unit_id
    left join lateral (select sum(rl.quantity) q from public.procurement_receipt_lines rl join public.procurement_receipts r on r.id=rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id=r.id left join public.order_receiving_reversals rev on rev.request_id=req.id
      where rl.item_id=i.id and coalesce(r.erp_docstatus,1)<>2 and r.erp_cancelled_at is null and rev.request_id is null) rc on true
    where i.procurement_id=v_po.procurement_id and i.org_id=v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'receiver_id',r.receiver_id,'warehouse_id',r.warehouse_id,'date',r.receipt_date,
    'lines',r.counted_lines,'approved',public.order_receiving_approval_current(r.id),'document_id',r.stock_document_id,'reversed',rev.request_id is not null)
    order by r.created_at),'[]') into v_requests from public.order_receiving_requests r
    left join public.order_receiving_reversals rev on rev.request_id=r.id
    where r.po_id=p_po and r.org_id=v_org and (v_purchaser or r.receiver_id=auth.uid());
  return jsonb_build_object('purchaser',v_purchaser,'lines',v_lines,'requests',v_requests);
end $$;
