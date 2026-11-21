-- reverse 1383 (reverse 1384 first)
alter table public.work_orders drop constraint if exists work_orders_area_same_org, drop constraint if exists work_orders_group_same_org;
drop index if exists public.work_orders_area_idx;
drop index if exists public.work_orders_group_idx;
alter table public.work_orders drop column if exists area_id, drop column if exists group_id;
