-- 1881_procurement_line_attribution_masked.sql — the masked line view carries the line's work order and discipline (AC-WPL-009).
-- Appends two non-money columns to 1216's view; amount, erp_line_amount and rate stay masked exactly as before.
-- Reverse: rollback/1881_procurement_line_attribution_masked_down.sql (1216's view). Roll back 1882 and 1883 first.
create or replace view public.procurement_items_masked with (security_invoker = true) as
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
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.work_order_id,
  x.discipline_id
from public.procurement_items x;
grant select on public.procurement_items_masked to authenticated;
