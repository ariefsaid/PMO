-- 1281_work_order_daily_target_reads.sql — #2672: a work order's daily target against actual, month to date, projection.
-- Spec docs/specs/work-order-daily-target.spec.md (FR-WDT-010..015). Proven by supabase/tests/1281_work_order_daily_target_reads.test.sql.
-- The target is #2671's plan row; actual is the same validated, non-superseded, non-archived daily revenue by work_date.
-- The projection projects the ACTUAL run-rate over working days; it is never a target (OD-SCOPE-7).
--
-- ── REVERSE (also supabase/migrations/rollback/1281_work_order_daily_target_reads_down.sql) ───────────
--   drop function if exists public.wo_daily_target_vs_actual(uuid, date);
--   drop function if exists public.wdt_month_summary(uuid, date);

-- The one place the month figures are derived (internal): one work order, the month of one as-of date.
create function public.wdt_month_summary(p_work_order uuid, p_as_of date)
  returns table (month_start date, month_end date, has_target boolean, month_target numeric, mtd_target numeric, mtd_actual numeric,
                 elapsed_working_days integer, remaining_working_days integer, projection numeric)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders; v_ms date; v_me date; v_el integer; v_rem integer; v_act numeric;
begin
  select * into w from public.work_orders where id = p_work_order;
  v_ms := date_trunc('month', p_as_of)::date;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  select count(*)::integer into v_el from generate_series(greatest(v_ms, coalesce(w.start_date, v_ms)), p_as_of, interval '1 day') d
   where public.org_is_working_day(w.org_id, d::date);
  select count(*)::integer into v_rem from generate_series(p_as_of + 1, least(v_me, coalesce(w.end_date, v_me)), interval '1 day') d
   where public.org_is_working_day(w.org_id, d::date);
  select coalesce(sum(l.frozen_amount), 0) into v_act from public.dsr_progress_lines l join public.daily_site_reports d on d.id = l.report_id
   where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     and d.work_date between v_ms and p_as_of;
  return query select v_ms, v_me,
    exists (select 1 from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date between v_ms and v_me),
    coalesce((select sum(p.amount) from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date between v_ms and v_me), 0),
    coalesce((select sum(p.amount) from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date between v_ms and p_as_of), 0),
    v_act, coalesce(v_el, 0), coalesce(v_rem, 0),
    case when coalesce(v_el, 0) = 0 then null else v_act + round(v_act / v_el * coalesce(v_rem, 0), 2) end;
end $$;
revoke all on function public.wdt_month_summary(uuid, date) from public, anon, authenticated;

create function public.wo_daily_target_vs_actual(p_work_order uuid, p_as_of date default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders; v_as_of date; s record; v_days jsonb;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(w.project_id) then
    raise exception 'WDT_ROLE: you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(w.org_id) then return null; end if;
  v_as_of := coalesce(p_as_of, public.wrp_org_today(w.org_id));
  if v_as_of not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'WDT_DATE: enter a real date' using errcode = '23514';
  end if;
  select * into s from public.wdt_month_summary(w.id, v_as_of);
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', x.day, 'working', public.org_is_working_day(w.org_id, x.day),
      'non_working_label', (select n.label from public.org_non_working_dates n where n.org_id = w.org_id and n.work_date = x.day),
      'is_listed', exists (select 1 from public.org_non_working_dates n where n.org_id = w.org_id and n.work_date = x.day),
      'has_target', x.tgt is not null, 'target', coalesce(x.tgt, 0)::text, 'actual', x.act::text,
      'gap', (x.act - coalesce(x.tgt, 0))::text, 'pending_reports', x.pend) order by x.day), '[]'::jsonb)
    into v_days from (
      select d::date as day,
        (select p.amount from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date = d::date) as tgt,
        coalesce((select sum(l.frozen_amount) from public.dsr_progress_lines l join public.daily_site_reports r on r.id = l.report_id
                   where r.work_order_id = w.id and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
                     and r.work_date = d::date), 0) as act,
        (select count(*)::integer from public.daily_site_reports r where r.work_order_id = w.id and r.status = 'submitted'
            and r.superseded_at is null and r.archived_at is null and r.work_date = d::date) as pend
      from generate_series(s.month_start, s.month_end, interval '1 day') d) x;
  return jsonb_build_object(
    'work_order_id', w.id, 'currency', w.currency, 'as_of', v_as_of, 'month', s.month_start, 'has_target', s.has_target,
    'month_target', s.month_target::text, 'mtd_target', s.mtd_target::text, 'mtd_actual', s.mtd_actual::text,
    'mtd_gap', (s.mtd_actual - s.mtd_target)::text,
    'elapsed_working_days', s.elapsed_working_days, 'remaining_working_days', s.remaining_working_days,
    'projection', s.projection::text, 'projected_gap', (s.projection - s.month_target)::text,
    'days', v_days);
end $$;
revoke all on function public.wo_daily_target_vs_actual(uuid, date) from public, anon;
grant execute on function public.wo_daily_target_vs_actual(uuid, date) to authenticated;
