-- 1317_stock_free_reserved_read.sql — #2693 (FR-RSV-005/006). A NEW read: get_stock_on_hand is not edited.
-- Per item and location: on hand, reserved, free (never negative), short_by, and the reserving work orders. Quantity only, no cost.
-- Returns an empty list while the organisation has reservations off. Proven by supabase/tests/1315_stock_reservations.test.sql.
-- ── REVERSE: rollback/1317_stock_free_reserved_read_down.sql.
create or replace function public.get_stock_free_reserved(p_warehouse_id uuid default null, p_item_id uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_today date; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not public.stock_reservations_on(v_org) then return '[]'::jsonb; end if;
  v_today := public.rsv_today(v_org);
  with res as (
    select r.id, r.item_id, r.warehouse_id, r.work_order_id, w.wo_number, w.title, r.expires_on,
           r.quantity - r.consumed_qty - r.released_qty as remaining
      from public.stock_reservations r join public.work_orders w on w.id = r.work_order_id
     where r.org_id = v_org and r.status = 'active' and (r.expires_on is null or r.expires_on >= v_today)         -- mut:rsv_org
       and w.status in ('Draft', 'Issued') and r.quantity - r.consumed_qty - r.released_qty > 0
       and (p_warehouse_id is null or r.warehouse_id = p_warehouse_id) and (p_item_id is null or r.item_id = p_item_id)
  ), pairs as (
    select item_id, warehouse_id from res
    union
    select b.item_id, b.warehouse_id from public.stock_balances b
     where b.org_id = v_org and b.qty_on_hand > 0
       and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
  ), fig as (
    select p.item_id, p.warehouse_id,
           coalesce((select b.qty_on_hand from public.stock_balances b where b.item_id = p.item_id and b.warehouse_id = p.warehouse_id and b.org_id = v_org), 0) as on_hand,
           coalesce((select sum(x.remaining) from res x where x.item_id = p.item_id and x.warehouse_id = p.warehouse_id), 0) as reserved
      from pairs p
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name, 'warehouse_kind', w.kind,
                              'qty_on_hand', trim_scale(f.on_hand)::text, 'reserved_qty', trim_scale(f.reserved)::text,
                              'free_qty', trim_scale(greatest(0, f.on_hand - f.reserved))::text,
                              'short_by', trim_scale(greatest(0, f.reserved - f.on_hand))::text,
                              'reservations', coalesce((select jsonb_agg(jsonb_build_object('reservation_id', x.id, 'work_order_id', x.work_order_id,
                                                          'work_order_number', x.wo_number, 'work_order_title', x.title,
                                                          'remaining_qty', trim_scale(x.remaining)::text, 'expires_on', x.expires_on)
                                                          order by x.title, x.id)
                                                  from res x where x.item_id = f.item_id and x.warehouse_id = f.warehouse_id), '[]'::jsonb))
           order by w.code, i.code), '[]'::jsonb)
    into v_rows
    from fig f
    join public.stock_items i on i.id = f.item_id join public.stock_units u on u.id = i.unit_id
    join public.stock_warehouses w on w.id = f.warehouse_id
   where i.org_id = v_org and w.org_id = v_org;
  return v_rows;
end $$;
revoke all on function public.get_stock_free_reserved(uuid, uuid) from public, anon;
grant execute on function public.get_stock_free_reserved(uuid, uuid) to authenticated;
