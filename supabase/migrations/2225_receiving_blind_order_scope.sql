-- Preserve the keeper's own draft request authoring; blind quantities begin once an order is sent.
create function public.order_receiving_line_blind(p_procurement uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.order_receiving_blind() and exists
    (select 1 from public.purchase_orders po where po.procurement_id=p_procurement and po.org_id=public.auth_org_id()
       and po.status in ('Issued','Acknowledged','Closed'))
$$;
revoke all on function public.order_receiving_line_blind(uuid) from public,anon;
grant execute on function public.order_receiving_line_blind(uuid) to authenticated;
alter policy receiving_blind_lines on public.procurement_items
  using (not (select public.order_receiving_line_blind(procurement_id)));
