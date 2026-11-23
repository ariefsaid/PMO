-- Reverse 1881: restore 1216's masked line view (no work_order_id / discipline_id).
drop view if exists public.procurement_items_masked;
create view public.procurement_items_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.description,
  x.erp_docstatus,
  case when (select public.actor_may_see_prices_now()) then x.erp_line_amount end as erp_line_amount,
  x.erp_modified,
  x.id,
  x.name,
  x.org_id,
  x.procurement_id,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate
from public.procurement_items x;
grant select on public.procurement_items_masked to authenticated;
