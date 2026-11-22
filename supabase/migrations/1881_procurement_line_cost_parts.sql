-- 1881_procurement_line_cost_parts.sql — the one helper every purchase cost read uses to resolve a purchase's lines to work
-- orders (spec FR-WPL-002, FR-WPL-005, FR-WPL-007), and the masked line view carries the new column (AC-WPL-009).
-- procurement_line_parts(org, purchase, default work order, default discipline): one row per work order the purchase's lines
-- resolve to. A line's OWN work order wins; a line with none takes the default (the record-level chain the caller resolved:
-- bill, PO, receipt, request). A line with its own work order takes no discipline; a defaulted line keeps the default's.
-- share_amount = the lines' value (quantity x rate) on that work order; total_amount = all lines' value; lined = at least one
-- line names its own work order and the lines have value. When it is not lined the single row IS the default, so a purchase
-- whose lines name nothing resolves exactly as it did before 1880. Reads no money other than the line value.
-- Proven by supabase/tests/1882_work_order_cost_line_split.test.sql.
-- Reverse: rollback/1881_procurement_line_cost_parts_down.sql (rolls back 1882 first).

create function public.procurement_line_parts(p_org uuid, p_procurement uuid, p_default_wo uuid, p_default_discipline uuid)
returns table(work_order_id uuid, discipline_id uuid, share_amount numeric, total_amount numeric, lined boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  with l as (
    select i.work_order_id as own, i.amount from public.procurement_items i
     where i.org_id = p_org and i.procurement_id = p_procurement
  ), g as (
    select coalesce(l.own, p_default_wo) as wo,
           case when l.own is not null then null::uuid else p_default_discipline end as disc,
           sum(l.amount) as amt
      from l group by 1, 2
  ), t as (
    select coalesce(sum(l.amount), 0) as total, bool_or(l.own is not null) as any_own from l
  )
  select g.wo, g.disc, g.amt, t.total, true
    from g cross join t where coalesce(t.any_own, false) and t.total > 0
  union all
  select p_default_wo, p_default_discipline, 0::numeric, 0::numeric, false
    from t where not (coalesce(t.any_own, false) and t.total > 0)
$$;
revoke all on function public.procurement_line_parts(uuid, uuid, uuid, uuid) from public, anon, authenticated;

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
  x.work_order_id
from public.procurement_items x;
grant select on public.procurement_items_masked to authenticated;
