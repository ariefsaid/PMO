-- 1891_get_imprest_estimate.sql — cash-advance-estimate: the site cash estimate by month, purpose and work order, and the
-- advance needed for a period. Spec docs/specs/cash-advance-estimate.spec.md (FR-CAE-004..006).
-- Proven by supabase/tests/1891_imprest_estimate.test.sql. Reads only: nothing here routes, approves or posts.
-- SECURITY INVOKER (as get_imprest_position): a float the caller cannot see yields no rows. Reverse: rollback/1891_*_down.sql.
-- Which plan counts for a month: Approved, else Submitted, else the newest Draft (plan_status says which; 'none' = no plan).
-- A month that has ended adds nothing to still_to_spend. Row still_to_spend = max(planned - drawn, 0); totals sum the rows.

create or replace function public.get_imprest_estimate(p_float uuid, p_from date, p_to date)
returns table (month date, plan_status text, budget_category public.budget_category, work_order_id uuid,
               planned numeric, drawn numeric, still_to_spend numeric)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_from date; v_to date; v_today date;
begin
  if p_from is null or p_to is null then
    raise exception 'ICE_PERIOD: choose the first and the last month of the estimate' using errcode = 'P0001';
  end if;
  v_from := date_trunc('month', p_from)::date;
  v_to   := date_trunc('month', p_to)::date;
  if v_to < v_from or v_to > (v_from + interval '11 months')::date then
    raise exception 'ICE_PERIOD: an estimate covers 1 to 12 months, the last month not before the first' using errcode = 'P0001';
  end if;
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date into v_today
    from public.imprest_floats f join public.organizations o on o.id = f.org_id where f.id = p_float;
  if v_today is null then
    return;   -- a float the caller cannot see: no rows (AC-CAE-006)
  end if;
  return query
  with months as (
    select g::date as m from generate_series(v_from, v_to, interval '1 month') g
  ), pick as (
    select distinct on (mo.m) mo.m, p.id as plan_id, p.status as plan_status
      from months mo
      left join public.imprest_plans p on p.float_id = p_float and p.month = mo.m and p.status in ('Approved', 'Submitted', 'Draft')
     order by mo.m, case p.status when 'Approved' then 1 when 'Submitted' then 2 when 'Draft' then 3 end, p.created_at desc
  ), ln as (
    select pk.m, pk.plan_status, l.id as line_id, l.budget_category as cat, l.planned_amount
      from pick pk join public.imprest_plan_lines l on l.plan_id = pk.plan_id
  ), wo as (
    select ln.m, ln.plan_status, ln.line_id, ln.cat, s.work_order_id as wid, s.amount as samt,
           coalesce((select sum(c.amount) from public.expense_claims c
                      where c.imprest_float_id = p_float and c.imprest_month = ln.m and c.budget_category = ln.cat
                        and c.work_order_id = s.work_order_id and c.kind = 'claim' and c.status in ('Approved', 'Paid')), 0) as wdrawn
      from ln join public.imprest_plan_line_splits s on s.line_id = ln.line_id
  ), rows_ as (
    select pk.m, 'none'::text as plan_status, null::public.budget_category as cat, null::uuid as wid, 0::numeric as planned, 0::numeric as drawn
      from pick pk where pk.plan_id is null
    union all
    select wo.m, wo.plan_status, wo.cat, wo.wid, wo.samt, wo.wdrawn from wo
    union all
    select ln.m, ln.plan_status, ln.cat, null::uuid,
           ln.planned_amount - coalesce((select sum(w.samt) from wo w where w.line_id = ln.line_id), 0),
           greatest(public.imprest_drawn(p_float, ln.m, ln.cat) - coalesce((select sum(w.wdrawn) from wo w where w.line_id = ln.line_id), 0), 0)
      from ln
  )
  select r.m, r.plan_status, r.cat, r.wid, r.planned::numeric(14,2), r.drawn::numeric(14,2),
         (case when (r.m + interval '1 month')::date > v_today then greatest(r.planned - r.drawn, 0) else 0 end)::numeric(14,2)
    from rows_ r
   where r.plan_status = 'none' or r.wid is not null or r.planned > 0 or r.drawn > 0
   order by r.m, r.cat, r.wid nulls last;
end; $$;

create or replace function public.get_imprest_estimate_total(p_float uuid, p_from date, p_to date)
returns table (planned numeric, drawn numeric, still_to_spend numeric, cash_book numeric, in_flight numeric, advance_needed numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with e as (select coalesce(sum(x.planned), 0) as planned, coalesce(sum(x.drawn), 0) as drawn,
                    coalesce(sum(x.still_to_spend), 0) as still
               from public.get_imprest_estimate(p_float, p_from, p_to) x),
       f as (select public.imprest_cash_book(p_float) as cb,
                    coalesce((select sum(r.amount) from public.imprest_replenishments r
                               where r.float_id = p_float and r.status in ('Requested', 'Approved')), 0) as fl)
  select e.planned::numeric(14,2), e.drawn::numeric(14,2), e.still::numeric(14,2), f.cb::numeric(14,2), f.fl::numeric(14,2),
         greatest(e.still - f.cb - f.fl, 0)::numeric(14,2)
    from e, f
   where exists (select 1 from public.imprest_floats fl where fl.id = p_float)
$$;
revoke all on function public.get_imprest_estimate(uuid, date, date), public.get_imprest_estimate_total(uuid, date, date) from public, anon;
grant execute on function public.get_imprest_estimate(uuid, date, date), public.get_imprest_estimate_total(uuid, date, date) to authenticated;
