create or replace function public.equipment_metrics(p_asset_ids uuid[], p_from date, p_to date, p_grain text default 'month')
returns table (asset_id uuid, bucket_start date, in_service_days int, available_days int, unrecorded_days int,
               work_hours numeric, availability_pct numeric, utilisation_pct numeric, pending_usage_entries int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid := public.auth_org_id(); v_wh numeric; v_timezone text; v_first date; v_max int := case when p_grain = 'day' then 93 else 400 end;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Project Manager','Finance','Executive') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_grain is null or p_grain not in ('day','week','month') then raise exception 'grain must be day, week or month' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > v_max then
    raise exception 'the period is invalid or too long' using errcode = '22023';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 or cardinality(p_asset_ids) > 200 then
    raise exception 'between 1 and 200 assets' using errcode = '22023';
  end if;
  select o.equipment_working_hours, coalesce(o.default_timezone, 'UTC') into v_wh, v_timezone from public.organizations o where o.id = v_org;
  -- 1601: days before the organisation's first day (its creation, or its earliest recorded status or usage, whichever is
  -- earlier) are not "not recorded": nobody could have recorded them. least() skips the nulls.
  select least((o.created_at at time zone v_timezone)::date,
               (select min(s.status_date) from public.equipment_status_days s where s.org_id = v_org),
               (select min(u.work_date) from public.equipment_usage_entries u where u.org_id = v_org and u.archived_at is null))
    into v_first from public.organizations o where o.id = v_org;
  return query
  with a as (
    select q.id, q.in_service_on, q.archived_at, q.ownership from public.equipment_assets q
     where q.org_id = v_org and q.id = any (p_asset_ids)
  ), days as (
    select a.id as aid, g::date as d, a.in_service_on, a.archived_at, a.ownership
      from a cross join generate_series(p_from, p_to, interval '1 day') g
  ), st as (
    select days.aid, days.d,
           (case when days.d < v_first then false
                 when days.in_service_on is not null and days.d < days.in_service_on then false
                 when days.archived_at is not null and days.d >= (days.archived_at at time zone v_timezone)::date then false
                 when days.ownership = 'rented' then exists (select 1 from public.equipment_rental_terms t
                        where t.asset_id = days.aid and t.org_id = v_org and t.rented_from <= days.d and coalesce(t.rented_to, 'infinity'::date) >= days.d)
                 else true end) as in_svc,
           s.status
      from days left join public.equipment_status_days s on s.asset_id = days.aid and s.status_date = days.d and s.org_id = v_org
  ), w as (
    select e.asset_id as aid, e.work_date as d,
           sum(case when e.status = 'Approved' and e.kind = 'work' then case when e.unit = 'hours' then e.quantity else e.quantity * v_wh end else 0 end) as hrs,
           count(*) filter (where e.status in ('Draft','Submitted'))::int as pend
      from public.equipment_usage_entries e
     where e.org_id = v_org and e.asset_id = any (p_asset_ids) and e.work_date between p_from and p_to and e.archived_at is null
     group by e.asset_id, e.work_date
  ), j as (
    select st.aid, st.in_svc, st.status,
           case p_grain when 'day' then st.d when 'week' then date_trunc('week', st.d)::date else date_trunc('month', st.d)::date end as b,
           case when st.in_svc and st.status is not null then coalesce(w.hrs, 0) else 0 end as hrs, coalesce(w.pend, 0) as pend
      from st left join w on w.aid = st.aid and w.d = st.d
  ), g as (
    select j.aid, j.b,
           count(*) filter (where j.in_svc and j.status is not null)::int as svc,
           count(*) filter (where j.in_svc and j.status in ('ready','standby'))::int as av,
           count(*) filter (where j.in_svc and j.status is null)::int as unrec,
           sum(j.hrs) as hrs, sum(j.pend)::int as pend
      from j group by j.aid, j.b
  )
  select g.aid, g.b, g.svc, g.av, g.unrec, g.hrs,
         case when g.svc > 0 then round(g.av * 100.0 / g.svc, 1) end,
         case when g.av > 0 then round(g.hrs * 100.0 / (g.av * v_wh), 1) end,
         g.pend
    from g order by g.aid, g.b;
end $$;
