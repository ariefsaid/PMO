-- 1276_work_order_revenue_plan_writes.sql — #2671: the only writers of the revenue plan.
-- Spec FR-WRP-002..007. Proven by supabase/tests/1275_work_order_revenue_plan.test.sql.
-- Every writer: active member of the work order's org, a role that may read the project's revenue
-- (Admin, Executive, Finance, the project's PM: dsr_may_see_revenue), the organisation's switch ON, and the work order
-- neither Cancelled nor Closed. One audit event per call records who changed which dates and the totals before and after.
--
-- ── REVERSE (also supabase/migrations/rollback/1276_work_order_revenue_plan_writes_down.sql) ───────────
--   drop function if exists public.wo_revenue_plan_set_day(uuid, date, numeric);
--   drop function if exists public.wo_revenue_plan_set_month(uuid, date, numeric, boolean);
--   drop function if exists public.wo_revenue_plan_clear(uuid, date, date);
--   drop function if exists public.wrp_writable_work_order(uuid);

create function public.wrp_writable_work_order(p_work_order uuid) returns public.work_orders
  language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.work_orders;
begin
  if not public.is_active_member() then
    raise exception 'WRP_ROLE: not authorized' using errcode = '42501';
  end if;
  select * into w from public.work_orders where id = p_work_order and org_id = public.auth_org_id();
  if w.id is null then raise exception 'work order not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(w.project_id) then
    raise exception 'WRP_ROLE: you cannot change the revenue plan on this project' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(w.org_id) then
    raise exception 'WRP_OFF: the revenue plan is not switched on for this organisation' using errcode = '55000';
  end if;
  if w.status in ('Cancelled', 'Closed') then
    raise exception 'WRP_FROZEN: the plan of a % work order is frozen', lower(w.status::text) using errcode = '23514';
  end if;
  return w;
end $$;
revoke all on function public.wrp_writable_work_order(uuid) from public, anon, authenticated;

create function public.wrp_check_amount(p_amount numeric) returns void
  language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_amount is null or p_amount < 0 or p_amount >= 1e15 or p_amount <> round(p_amount, 2) then
    raise exception 'WRP_AMOUNT: an amount is from 0 with at most two decimals' using errcode = '23514';
  end if;
end $$;
revoke all on function public.wrp_check_amount(numeric) from public, anon, authenticated;

create function public.wrp_audit(p_wo public.work_orders, p_action text, p_detail jsonb) returns void
  language sql security definer set search_path = public, pg_temp as $$
  select public.log_audit('work_order_revenue_plan.' || p_action, p_wo.org_id, auth.uid(), p_wo.id, p_detail)
$$;
revoke all on function public.wrp_audit(public.work_orders, text, jsonb) from public, anon, authenticated;

-- One date (FR-WRP-002). An edited day of a spread month becomes a plain dated row (FR-WRP-004).
create function public.wo_revenue_plan_set_day(p_work_order uuid, p_date date, p_amount numeric) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.work_orders; v_old numeric;
begin
  perform public.assert_is_active_member();
  w := public.wrp_writable_work_order(p_work_order);
  perform public.wrp_check_amount(p_amount);
  if p_date is null or p_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'WRP_DATE: enter a real date' using errcode = '23514';
  end if;
  select amount into v_old from public.work_order_revenue_plan where work_order_id = w.id and plan_date = p_date;
  insert into public.work_order_revenue_plan (org_id, project_id, work_order_id, plan_date, amount, source, month_key)
    values (w.org_id, w.project_id, w.id, p_date, p_amount, 'date', null)
    on conflict (work_order_id, plan_date) do update
      set amount = excluded.amount, source = 'date', month_key = null, updated_by = auth.uid(), updated_at = now();
  perform public.wrp_audit(w, 'set_day', jsonb_build_object('date', p_date, 'before', v_old, 'after', p_amount));
end $$;

-- One month spread evenly over the organisation's working days (FR-WRP-003/004), exact to the cent: whole cents are
-- divided, the remainder cents go one each to the earliest dates. Days outside the work order's own start and end dates
-- (when it has them) are left out. keep_edited keeps the month's dated rows and spreads only what is left (never negative).
create function public.wo_revenue_plan_set_month(p_work_order uuid, p_month date, p_amount numeric, p_keep_edited boolean default false)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders; v_month date; v_end date; v_before numeric; v_kept numeric := 0; v_left bigint;
  v_days date[]; v_n integer; v_base bigint; v_rem bigint;
begin
  perform public.assert_is_active_member();
  w := public.wrp_writable_work_order(p_work_order);
  perform public.wrp_check_amount(p_amount);
  if p_month is null or p_month not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'WRP_DATE: enter a real month' using errcode = '23514';
  end if;
  v_month := date_trunc('month', p_month)::date;
  v_end := (v_month + interval '1 month - 1 day')::date;
  select coalesce(sum(amount), 0) into v_before from public.work_order_revenue_plan
    where work_order_id = w.id and plan_date between v_month and v_end;
  if coalesce(p_keep_edited, false) then
    delete from public.work_order_revenue_plan where work_order_id = w.id and plan_date between v_month and v_end and source = 'month';
    select coalesce(sum(amount), 0) into v_kept from public.work_order_revenue_plan
      where work_order_id = w.id and plan_date between v_month and v_end;
  else
    delete from public.work_order_revenue_plan where work_order_id = w.id and plan_date between v_month and v_end;
  end if;
  v_left := round((p_amount - v_kept) * 100)::bigint;
  if v_left < 0 then
    raise exception 'WRP_KEPT_EXCEEDS: the days you kept already add up to more than the month amount' using errcode = '23514';
  end if;
  select array_agg(d::date order by d) into v_days
    from generate_series(v_month, v_end, interval '1 day') d
   where public.org_is_working_day(w.org_id, d::date)
     and (w.start_date is null or d::date >= w.start_date) and (w.end_date is null or d::date <= w.end_date)
     and not exists (select 1 from public.work_order_revenue_plan p where p.work_order_id = w.id and p.plan_date = d::date);
  v_n := coalesce(cardinality(v_days), 0);
  if v_n = 0 then
    raise exception 'WRP_NO_WORKING_DAY: the month has no free working day on this work order' using errcode = '23514';
  end if;
  v_base := v_left / v_n; v_rem := v_left % v_n;
  insert into public.work_order_revenue_plan (org_id, project_id, work_order_id, plan_date, amount, source, month_key)
    select w.org_id, w.project_id, w.id, x.d, (v_base + case when x.i <= v_rem then 1 else 0 end)::numeric / 100, 'month', v_month
      from unnest(v_days) with ordinality as x(d, i);
  perform public.wrp_audit(w, 'set_month', jsonb_build_object('month', v_month, 'before', v_before, 'after', p_amount,
    'keep_edited', coalesce(p_keep_edited, false), 'days', v_n));
  return v_n;
end $$;

-- Clear a date range (a day is from = to; a month is its first to last day) (FR-WRP-007).
create function public.wo_revenue_plan_clear(p_work_order uuid, p_from date, p_to date) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.work_orders; v_count integer; v_before numeric;
begin
  perform public.assert_is_active_member();
  w := public.wrp_writable_work_order(p_work_order);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'WRP_DATE: enter a real date range' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into v_before from public.work_order_revenue_plan
    where work_order_id = w.id and plan_date between p_from and p_to;
  delete from public.work_order_revenue_plan where work_order_id = w.id and plan_date between p_from and p_to;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.wrp_audit(w, 'clear', jsonb_build_object('from', p_from, 'to', p_to, 'before', v_before, 'rows', v_count));
  end if;
  return v_count;
end $$;

revoke all on function public.wo_revenue_plan_set_day(uuid, date, numeric) from public, anon;
revoke all on function public.wo_revenue_plan_set_month(uuid, date, numeric, boolean) from public, anon;
revoke all on function public.wo_revenue_plan_clear(uuid, date, date) from public, anon;
grant execute on function public.wo_revenue_plan_set_day(uuid, date, numeric) to authenticated;
grant execute on function public.wo_revenue_plan_set_month(uuid, date, numeric, boolean) to authenticated;
grant execute on function public.wo_revenue_plan_clear(uuid, date, date) to authenticated;
