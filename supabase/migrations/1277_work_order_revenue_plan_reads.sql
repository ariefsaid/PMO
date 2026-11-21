-- 1277_work_order_revenue_plan_reads.sql — #2671: plan to date, actual to date and gap, per work order and per project.
-- Spec FR-WRP-010..014. Proven by supabase/tests/1276_work_order_revenue_plan_reads.test.sql.
-- Actual = validated daily revenue: only `validated`, non-superseded, non-archived reports (FR-DSR-014), summed from the
-- amounts frozen at validation (`dsr_progress_lines.frozen_amount`), dated by the report's work_date. Submitted reports are
-- named apart ("not yet validated") and never counted. Plan and actual come from the same read; the screens never re-sum.
-- Amounts are returned as exact decimal text. A caller who may not see the project's revenue is refused (42501), never given a zero. While the organisation's switch is
-- off the reads return null. Amounts are in the work order's currency; the project read totals per currency, never blended.
--
-- ── REVERSE (also supabase/migrations/rollback/1277_work_order_revenue_plan_reads_down.sql) ────────────
--   drop function if exists public.wo_revenue_plan_vs_actual(uuid, date, date, date);
--   drop function if exists public.project_revenue_plan_vs_actual(uuid, date);
--   drop function if exists public.wrp_figures(uuid, date);
--   drop function if exists public.wrp_org_today(uuid);

create function public.wrp_org_today(p_org uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.wrp_org_today(uuid) from public, anon, authenticated;

-- The one place the figures are derived (internal): one work order as of one date.
create function public.wrp_figures(p_work_order uuid, p_as_of date)
  returns table (has_plan boolean, plan_to_date numeric, actual_to_date numeric, plan_total numeric, pending_reports integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select
    exists (select 1 from public.work_order_revenue_plan p where p.work_order_id = p_work_order),
    coalesce((select sum(p.amount) from public.work_order_revenue_plan p where p.work_order_id = p_work_order and p.plan_date <= p_as_of), 0),
    coalesce((select sum(l.frozen_amount) from public.dsr_progress_lines l join public.daily_site_reports d on d.id = l.report_id
               where d.work_order_id = p_work_order and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
                 and d.work_date <= p_as_of), 0),
    coalesce((select sum(p.amount) from public.work_order_revenue_plan p where p.work_order_id = p_work_order), 0),
    (select count(*)::integer from public.daily_site_reports d
      where d.work_order_id = p_work_order and d.status = 'submitted' and d.superseded_at is null and d.archived_at is null)
$$;
revoke all on function public.wrp_figures(uuid, date) from public, anon, authenticated;

create function public.wo_revenue_plan_vs_actual(p_work_order uuid, p_as_of date default null, p_from date default null, p_to date default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders; v_as_of date; v_from date; v_to date; f record; v_series jsonb;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(w.project_id) then
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

create function public.project_revenue_plan_vs_actual(p_project uuid, p_as_of date default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_as_of date; v_rows jsonb; v_totals jsonb;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  select org_id into v_org from public.projects where id = p_project and org_id = public.auth_org_id();
  if v_org is null then raise exception 'project not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(p_project) then
    raise exception 'WRP_ROLE: you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(v_org) then return null; end if;
  v_as_of := coalesce(p_as_of, public.wrp_org_today(v_org));
  select coalesce(jsonb_agg(r.j order by r.sort_no, r.id), '[]'::jsonb) into v_rows from (
    select w.id, coalesce(w.wo_number, '') as sort_no,
      jsonb_build_object('work_order_id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'status', w.status, 'currency', w.currency,
        'has_plan', f.has_plan, 'plan_to_date', f.plan_to_date::text, 'actual_to_date', f.actual_to_date::text,
        'gap', (f.actual_to_date - f.plan_to_date)::text, 'plan_total', f.plan_total::text, 'pending_reports', f.pending_reports) as j
      from public.work_orders w cross join lateral public.wrp_figures(w.id, v_as_of) f
     where w.project_id = p_project and w.org_id = v_org
       and (w.status in ('Issued', 'Closed') or f.has_plan or f.actual_to_date <> 0)) r;
  -- Totals per currency over the work orders that have a plan, so a gap is never a plan-less work order's whole actual.
  select coalesce(jsonb_agg(jsonb_build_object('currency', t.currency, 'plan_to_date', t.plan::text, 'actual_to_date', t.actual::text,
           'gap', (t.actual - t.plan)::text, 'plan_total', t.total::text, 'planned_count', t.n) order by t.currency), '[]'::jsonb) into v_totals from (
    select x->>'currency' as currency, sum((x->>'plan_to_date')::numeric) as plan, sum((x->>'actual_to_date')::numeric) as actual,
           sum((x->>'plan_total')::numeric) as total, count(*) as n
      from jsonb_array_elements(v_rows) x where (x->>'has_plan')::boolean group by 1) t;
  return jsonb_build_object('as_of', v_as_of, 'rows', v_rows, 'totals', v_totals);
end $$;

revoke all on function public.wo_revenue_plan_vs_actual(uuid, date, date, date) from public, anon;
revoke all on function public.project_revenue_plan_vs_actual(uuid, date) from public, anon;
grant execute on function public.wo_revenue_plan_vs_actual(uuid, date, date, date) to authenticated;
grant execute on function public.project_revenue_plan_vs_actual(uuid, date) to authenticated;
