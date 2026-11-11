-- Rollback for 0417_stock_allowance_consumption.sql (#1512 S5). Reverse dependency order.
drop function if exists public.get_project_consumption(uuid, date, date);
drop table if exists public.boq_material_allowances;
drop function if exists public.touch_boq_material_allowance();
drop function if exists public.boq_allowance_ok(uuid, uuid);
