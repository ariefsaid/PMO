-- 1346_procurement_line_planning_down.sql — reverses 1346 (line categories and needed-by dates are lost).
drop function if exists public.set_procurement_line_planning(uuid, uuid, date);
drop trigger if exists procurement_items_zz_planning_guard on public.procurement_items;
drop function if exists public.procurement_items_planning_guard();
alter table public.procurement_items drop constraint if exists procurement_items_category_fk;
drop index if exists public.procurement_items_category_idx;
alter table public.procurement_items drop column if exists category_id, drop column if exists needed_by;
