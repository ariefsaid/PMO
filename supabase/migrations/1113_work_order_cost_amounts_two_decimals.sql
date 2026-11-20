-- 1113_work_order_cost_amounts_two_decimals.sql — return currency read values at exact two-decimal scale (#2519).
-- The hire-cost allocation stores exact cent values with an expanded numeric scale; the UI money parser requires
-- currency text with at most two fractional digits. Preserve the existing scoped read and normalize its amounts.
-- Reverse: rollback/1113_work_order_cost_amounts_two_decimals_down.sql.
alter function public.work_order_cost_amounts(uuid) rename to work_order_cost_amounts_unrounded;
revoke all on function public.work_order_cost_amounts_unrounded(uuid) from public, anon, authenticated;

create function public.work_order_cost_amounts(p_project_id uuid)
returns table(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date,
              reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.source, r.record_id, r.project_id, r.work_order_id, r.discipline_id, r.occurred_on,
         r.reference, r.currency,
         case when r.amount is null then null else round(r.amount::numeric, 2)::text end,
         r.reason, r.quantity, r.quantity_unit, r.person_id
    from public.work_order_cost_amounts_unrounded(p_project_id) r
$$;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;
