drop function if exists public.work_order_cost_amounts(uuid);
alter function public.work_order_cost_amounts_pre_labour(uuid) rename to work_order_cost_amounts;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;
