-- drops: wrp_writable_work_order admits PCM and Planner target writers; wo_revenue_plan_vs_actual admits Planner only here. Existing org, membership, status, feature and field-account checks retained. Latest explicit bodies: 2046 and 1277 plus 1480 field guard.
CREATE OR REPLACE FUNCTION public.wrp_writable_work_order(p_work_order uuid)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare w public.work_orders;
begin
  if not public.is_active_member() then
    raise exception 'WRP_ROLE: not authorized' using errcode = '42501';
  end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not (public.dsr_may_write_revenue(w.project_id)
          or public.actor_holds_job_role('project_control_manager')
          or public.actor_holds_job_role('planner')) then -- mut:sr_target_writer
    raise exception 'WRP_ROLE: you cannot change the revenue plan on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(w.org_id) then
    raise exception 'WRP_OFF: the revenue plan is not switched on for this organisation' using errcode = '55000';
  end if;
  if w.status in ('Cancelled', 'Closed') then
    raise exception 'WRP_FROZEN: the plan of a % work order is frozen', lower(w.status::text) using errcode = '23514';
  end if;
  return w;
end $function$;

create or replace function public.wo_revenue_plan_vs_actual(p_work_order uuid, p_as_of date default null, p_from date default null, p_to date default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders; v_as_of date; v_from date; v_to date; f record; v_series jsonb;
begin
  perform public.assert_not_light();
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not (public.dsr_may_see_revenue(w.project_id)
          or public.actor_holds_job_role('planner')) then -- mut:sr_plan_read
    raise exception 'WRP_ROLE: you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(w.org_id) then return null; end if;
  v_as_of := coalesce(p_as_of, public.wrp_org_today(w.org_id));
  select * into f from public.wrp_figures(w.id, v_as_of);
  v_from := coalesce(p_from, least(v_as_of,
      (select min(p.plan_date) from public.work_order_revenue_plan p where p.work_order_id = w.id),
      (select min(d.work_date) from public.daily_site_reports d where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null and d.archived_at is null)));
  v_to := coalesce(p_to, greatest(v_as_of, (select max(p.plan_date) from public.work_order_revenue_plan p where p.work_order_id = w.id)));
  if v_to < v_from or v_to - v_from > 731 then
    raise exception 'WRP_RANGE: choose a range of at most two years' using errcode = '22023';
  end if;
  with days as (select d::date as day from generate_series(v_from, v_to, interval '1 day') d),
  per_day as (
    select days.day,
      coalesce((select p.amount from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date = days.day), 0) as plan,
      coalesce((select sum(l.frozen_amount) from public.dsr_progress_lines l join public.daily_site_reports d on d.id = l.report_id
                 where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
                   and d.work_date = days.day), 0) as actual
      from days),
  -- Cumulative from the start of ALL history, not of the window, so a narrowed window still agrees with plan_to_date.
  base as (
    select
      coalesce((select sum(p.amount) from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date < v_from), 0) as plan0,
      coalesce((select sum(l.frozen_amount) from public.dsr_progress_lines l join public.daily_site_reports d on d.id = l.report_id
                 where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
                   and d.work_date < v_from), 0) as actual0)
  , cum as (
    select pd.day, pd.plan, pd.actual,
           base.plan0 + sum(pd.plan) over (order by pd.day) as cum_plan,
           base.actual0 + sum(pd.actual) over (order by pd.day) as cum_actual
      from per_day pd, base)
  select jsonb_agg(jsonb_build_object('date', c.day, 'plan', c.plan::text, 'actual', c.actual::text,
           'cum_plan', c.cum_plan::text, 'cum_actual', c.cum_actual::text) order by c.day)
    into v_series from cum c;
  return jsonb_build_object(
    'work_order_id', w.id, 'currency', w.currency, 'as_of', v_as_of, 'has_plan', f.has_plan,
    'plan_to_date', f.plan_to_date::text, 'actual_to_date', f.actual_to_date::text, 'gap', (f.actual_to_date - f.plan_to_date)::text,
    'plan_total', f.plan_total::text, 'pending_reports', f.pending_reports, 'series', coalesce(v_series, '[]'::jsonb));
end $$;
