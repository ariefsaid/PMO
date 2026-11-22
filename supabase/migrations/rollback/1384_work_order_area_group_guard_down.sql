-- reverse 1384
drop trigger if exists work_orders_area_group_live on public.work_orders;
drop function if exists public.check_work_order_area_group_live();
drop function if exists public.set_work_order_area_group(uuid, uuid, uuid, boolean, boolean);
