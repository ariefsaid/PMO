create or replace function public.get_work_order_performance(p_project_id uuid, p_as_of date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_tz text;
  v_enabled boolean; v_low numeric; v_high numeric;
  v_asof date;
  v_total integer;
  v_rows jsonb;
  v_limit constant integer := 500;
begin
  if v_org is null or auth.uid() is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager')
     or not public.dsr_may_see_revenue(p_project_id) then
    raise exception 'you cannot read revenue and cost on this project' using errcode = '42501';
  end if;

  select o.performance_indices_enabled, o.performance_band_low, o.performance_band_high,
         coalesce(o.default_timezone, 'UTC')
    into v_enabled, v_low, v_high, v_tz
    from public.organizations o where o.id = v_org;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;

  v_asof := coalesce(p_as_of, public.native_org_today(v_org));
  select count(*)::integer into v_total from public.work_orders w where w.project_id = p_project_id and w.org_id = v_org;

  with costs as materialized (
    select c.work_order_id, c.occurred_on, c.currency, c.amount, c.reason
      from public.work_order_cost_amounts(p_project_id) c
     where c.work_order_id is not null and c.reason in ('counted', 'unresolved-direct')
  ), wos as (
    select w.id, w.wo_number, w.title, w.status, w.currency, w.start_date, w.end_date, w.created_at,
           b.order_net as bac,
           case when w.status = 'Closed' and w.closed_at is not null
                then least(v_asof, (w.closed_at at time zone v_tz)::date) else v_asof end as eff
      from public.work_orders w
      join public.work_order_billing b on b.work_order_id = w.id and b.org_id = v_org
     where w.project_id = p_project_id and w.org_id = v_org
     order by w.wo_number nulls last, w.created_at, w.id
     limit v_limit
  ), per as (
    select w.*,
      (select coalesce(sum(l.frozen_amount), 0) from public.dsr_progress_lines l
         join public.daily_site_reports d on d.id = l.report_id
        where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null
          and d.archived_at is null and d.work_date <= w.eff) as ev,
      (select count(*)::integer from public.dsr_progress_lines l
         join public.daily_site_reports d on d.id = l.report_id
        where d.work_order_id = w.id and d.status = 'validated' and d.superseded_at is null
          and d.archived_at is null and d.work_date <= w.eff and l.frozen_amount is null) as unrated,
      exists (select 1 from costs c where c.work_order_id = w.id and c.reason = 'counted'
                 and (c.occurred_on is null or c.occurred_on <= w.eff) and c.currency is distinct from w.currency) as other_ccy,
      exists (select 1 from costs c where c.work_order_id = w.id
                 and ((c.reason = 'unresolved-direct')
                      or (c.reason = 'counted' and (c.occurred_on is null or c.amount is null)))) as incomplete,
      (select count(*)::integer from costs c where c.work_order_id = w.id and c.reason = 'counted' and c.occurred_on is null) as undated,
      (select coalesce(sum(c.amount::numeric), 0) from costs c where c.work_order_id = w.id and c.reason = 'counted'
          and c.occurred_on <= w.eff and c.currency = w.currency and c.amount is not null) as ac
    from wos w
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'work_order_id', p.id, 'wo_number', p.wo_number, 'title', p.title, 'status', p.status, 'currency', p.currency,
      'as_of', p.eff, 'start_date', p.start_date, 'end_date', p.end_date,
      'bac', case when p.status in ('Issued', 'Closed') then p.bac::numeric(16,2)::text end,
      'ev',  case when p.status in ('Issued', 'Closed') then p.ev::numeric(16,2)::text end,
      'unrated_lines', case when p.status in ('Issued', 'Closed') then p.unrated else 0 end,
      'pv',  case when p.status in ('Issued', 'Closed') and p.start_date is not null and p.end_date is not null
                   and p.end_date >= p.start_date
                  then (case when v_asof < p.start_date then 0::numeric
                             else round(p.bac * (least(v_asof, p.end_date) - p.start_date + 1)
                                        / (p.end_date - p.start_date + 1), 2) end)::numeric(16,2)::text end,
      'ac',  case when p.status in ('Issued', 'Closed') and not p.other_ccy and not p.incomplete then p.ac::numeric(16,2)::text end,
      'ac_status', case when p.other_ccy then 'not_comparable' when p.incomplete then 'incomplete' else 'complete' end,
      'undated_cost_lines', p.undated
    ) order by p.wo_number nulls last, p.created_at, p.id), '[]'::jsonb)
    into v_rows from per p;

  return jsonb_build_object(
    'enabled', true, 'as_of', v_asof,
    'bands', jsonb_build_object('low', v_low::numeric(3,2)::text, 'high', v_high::numeric(3,2)::text),
    'truncated', v_total > v_limit, 'omitted', greatest(v_total - v_limit, 0),
    'rows', v_rows);
end $$;
revoke all on function public.get_work_order_performance(uuid, date) from public, anon;
grant execute on function public.get_work_order_performance(uuid, date) to authenticated;
