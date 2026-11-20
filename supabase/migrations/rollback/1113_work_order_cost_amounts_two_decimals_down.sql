-- Reverses 1113_work_order_cost_amounts_two_decimals.sql (#2519).
drop function if exists public.work_order_cost_amounts(uuid);
alter function public.work_order_cost_amounts_unrounded(uuid) rename to work_order_cost_amounts;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;
