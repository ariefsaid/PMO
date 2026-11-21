-- 1282_project_daily_target_rollup.sql — #2672: the project roll-up of month-to-date target, actual and projection (FR-WDT-016).
-- Totals are per currency, never blended. Same gate as the work-order read. Proven by
-- supabase/tests/1281_work_order_daily_target_reads.test.sql.
--
-- ── REVERSE (also supabase/migrations/rollback/1282_project_daily_target_rollup_down.sql) ─────────────
--   drop function if exists public.project_daily_target_vs_actual(uuid, date);

create function public.project_daily_target_vs_actual(p_project uuid, p_as_of date default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_as_of date; v_rows jsonb; v_totals jsonb;
begin
  if not public.is_active_member() then raise exception 'not authorized' using errcode = '42501'; end if;
  select org_id into v_org from public.projects where id = p_project and org_id = public.auth_org_id();
  if v_org is null then raise exception 'project not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(p_project) then
    raise exception 'WDT_ROLE: you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(v_org) then return null; end if;
  v_as_of := coalesce(p_as_of, public.wrp_org_today(v_org));
  if v_as_of not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'WDT_DATE: enter a real date' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(r.j order by r.sort_no, r.id), '[]'::jsonb) into v_rows from (
    select w.id, coalesce(w.wo_number, '') as sort_no,
      jsonb_build_object('work_order_id', w.id, 'wo_number', w.wo_number, 'title', w.title, 'status', w.status, 'currency', w.currency,
        'has_target', m.has_target, 'month_target', m.month_target::text, 'mtd_target', m.mtd_target::text,
        'mtd_actual', m.mtd_actual::text, 'mtd_gap', (m.mtd_actual - m.mtd_target)::text,
        'projection', m.projection::text, 'projected_gap', (m.projection - m.month_target)::text) as j
      from public.work_orders w cross join lateral public.wdt_month_summary(w.id, v_as_of) m
     where w.project_id = p_project and w.org_id = v_org
       and (w.status in ('Issued', 'Closed') or m.has_target or m.mtd_actual <> 0)) r;
  -- Totals per currency over work orders with a target this month. The projection total is null if any row's is null.
  select coalesce(jsonb_agg(jsonb_build_object('currency', t.currency, 'month_target', t.month_target::text,
           'mtd_target', t.mtd_target::text, 'mtd_actual', t.mtd_actual::text, 'mtd_gap', (t.mtd_actual - t.mtd_target)::text,
           'projection', t.projection::text, 'targeted_count', t.n) order by t.currency), '[]'::jsonb) into v_totals from (
    select x->>'currency' as currency, sum((x->>'month_target')::numeric) as month_target, sum((x->>'mtd_target')::numeric) as mtd_target,
           sum((x->>'mtd_actual')::numeric) as mtd_actual,
           case when bool_and(x->>'projection' is not null) then sum((x->>'projection')::numeric) end as projection, count(*) as n
      from jsonb_array_elements(v_rows) x where (x->>'has_target')::boolean group by 1) t;
  return jsonb_build_object('as_of', v_as_of, 'rows', v_rows, 'totals', v_totals);
end $$;
revoke all on function public.project_daily_target_vs_actual(uuid, date) from public, anon;
grant execute on function public.project_daily_target_vs_actual(uuid, date) to authenticated;
