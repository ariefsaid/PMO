-- 1217 (#2699): masked stock views, and the stock cost permission follows the same rule. Each view is the base table with the price columns NULL unless actor_may_see_prices() (1215).
-- security_invoker: the base table's RLS still decides which rows. These are the read path for the request screens.
-- Rollback: rollback/1217_hide_prices_stock_views_down.sql

create view public.stock_document_lines_masked with (security_invoker = true) as
select
  x.boq_item_id,
  x.counted_quantity,
  x.direction,
  x.document_id,
  x.expected_quantity,
  x.id,
  x.item_id,
  x.line_no,
  x.org_id,
  x.quantity,
  x.source_line_id,
  case when (select public.actor_may_see_prices_now()) then x.unit_cost end as unit_cost
from public.stock_document_lines x;
grant select on public.stock_document_lines_masked to authenticated;

create view public.stock_ledger_masked with (security_invoker = true) as
select
  x.boq_item_id,
  x.document_id,
  x.id,
  x.item_id,
  x.kind,
  x.line_id,
  x.occurred_on,
  x.org_id,
  x.posted_at,
  x.posted_by,
  x.project_id,
  x.qty_after,
  x.qty_delta,
  x.seq,
  x.source_line_id,
  case when (select public.actor_may_see_prices_now()) then x.value_after end as value_after,
  case when (select public.actor_may_see_prices_now()) then x.value_delta end as value_delta,
  x.warehouse_id
from public.stock_ledger x;
grant select on public.stock_ledger_masked to authenticated;

create view public.stock_balances_masked with (security_invoker = true) as
select
  x.item_id,
  x.org_id,
  x.qty_on_hand,
  x.updated_at,
  case when (select public.actor_may_see_prices_now()) then x.value_on_hand end as value_on_hand,
  x.warehouse_id
from public.stock_balances x;
grant select on public.stock_balances_masked to authenticated;

-- The stock report RPCs (get_stock_on_hand, get_stock_ledger, get_project_consumption, work-order stock balance, ERP value tie) return
-- amounts only when stock_can_see_cost(); it now also requires actor_may_see_prices(), so one seam covers every stock report.
create or replace function public.stock_can_see_cost() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(public.role_rank(public.auth_role()) >= 20, false) and (select public.actor_may_see_prices_now())
$$;
