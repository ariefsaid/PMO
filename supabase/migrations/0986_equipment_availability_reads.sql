-- 0986_equipment_availability_reads.sql — #2526 slice 2b: downtime runs, the availability/utilisation read model,
-- and the escalation job. Spec FR-EAV-006/009/010/011/012; AC-EAV-001..004, 011. Proven by equipment_status.test.sql.
-- Mirrors pmo-portal/src/lib/equipmentMetrics.ts (the pure oracle; the pgTAP hand-calculated month agrees with its test).
-- Reverse: rollback/0986_equipment_availability_reads_down.sql

-- A downtime period starts at the first down status after a non-down (or no) status and ends at the first later
-- ready/standby status (FR-EAV-006). It is derived, never stored, so editing a status can never orphan a period.
-- Proven = at least one proof dated inside the period (FR-EAV-007). Internal (invoker); the callers are definers.
create function public.equipment_downtime_days(p_org uuid, p_asset uuid, p_from date, p_to date)
returns table (status_date date, status text, period_start date, period_end date, proven boolean)
language sql stable set search_path = public, pg_temp as $$
  with s as (
    select d.status_date, d.status,
           d.status in ('broken','at_vendor','waiting_parts') as is_down,
           lag(d.status in ('broken','at_vendor','waiting_parts')) over (order by d.status_date) as prev_down
      from public.equipment_status_days d
     where d.org_id = p_org and d.asset_id = p_asset
  ), m as (
    select s.*, max(case when s.is_down and coalesce(s.prev_down, false) = false then s.status_date end)
                  over (order by s.status_date) as pstart
      from s
  ), r as (
    select m.status_date, m.status, m.pstart,
           (select min(u.status_date) from s u where not u.is_down and u.status_date > m.pstart) as pend
      from m where m.is_down
  )
  select r.status_date, r.status, r.pstart, r.pend,
         exists (select 1 from public.equipment_downtime_proofs pr
                  where pr.org_id = p_org and pr.asset_id = p_asset and pr.proof_date >= r.pstart
                    and (r.pend is null or pr.proof_date < r.pend))
    from r where r.status_date between p_from and p_to
$$;
revoke all on function public.equipment_downtime_days(uuid, uuid, date, date) from public, anon, authenticated;

-- FR-EAV-011/012/013: per asset and day|week|month bucket. Exact numerators plus the display percentages (one decimal,
-- rounded only here). Approved work only; Draft/Submitted usage is counted so the screen can say it is pending.
-- Bounded (NFR-EAV-001): at most 200 assets, 400 days (93 for the day grain).
create function public.equipment_metrics(p_asset_ids uuid[], p_from date, p_to date, p_grain text default 'month')
returns table (asset_id uuid, bucket_start date, in_service_days int, available_days int, unrecorded_days int,
               work_hours numeric, availability_pct numeric, utilisation_pct numeric, pending_usage_entries int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_org uuid := public.auth_org_id(); v_wh numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Project Manager','Finance','Executive') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_grain is null or p_grain not in ('day','week','month') then raise exception 'grain must be day, week or month' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > case when p_grain = 'day' then 93 else 400 end then
    raise exception 'the period is invalid or too long' using errcode = '22023';
  end if;
  if p_asset_ids is null or cardinality(p_asset_ids) = 0 or cardinality(p_asset_ids) > 200 then
    raise exception 'between 1 and 200 assets' using errcode = '22023';
  end if;
  select o.equipment_working_hours into v_wh from public.organizations o where o.id = v_org;
  return query
  with a as (
    select q.id, q.in_service_on, q.archived_at, q.ownership from public.equipment_assets q
     where q.org_id = v_org and q.id = any (p_asset_ids)
  ), days as (
    select a.id as aid, g::date as d, a.in_service_on, a.archived_at, a.ownership
      from a cross join generate_series(p_from, p_to, interval '1 day') g
  ), st as (
    select days.aid, days.d,
           (case when days.in_service_on is not null and days.d < days.in_service_on then false
                 when days.archived_at is not null and days.d >= days.archived_at::date then false
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
           coalesce(w.hrs, 0) as hrs, coalesce(w.pend, 0) as pend
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

-- FR-EAV-009/010: an open downtime period with more than 2 recorded down days whose latest status is yesterday or today.
-- Computed from status rows and the org's calendar date, never a client clock; an asset with no recent status is not escalated.
create function public.equipment_downtime_escalations(p_org uuid, p_as_of date)
returns table (asset_id uuid, period_start date, down_days int)
language sql stable set search_path = public, pg_temp as $$
  select a.id, d.period_start, count(*)::int
    from public.equipment_assets a
   cross join lateral public.equipment_downtime_days(p_org, a.id, date '0001-01-01', p_as_of) d
   where a.org_id = p_org and a.archived_at is null and d.period_end is null
   group by a.id, d.period_start
  having count(*) > 2 and max(d.status_date) >= p_as_of - 1
$$;
revoke all on function public.equipment_downtime_escalations(uuid, date) from public, anon, authenticated;

-- The scheduled job (OQ-EAV-4 default: a notice per period per day while still down; the log key makes a rerun a no-op).
-- Recipients: active Admin and Project Manager members of the asset's org (OD-EAV-1).
create function public.run_equipment_downtime_escalations(p_as_of date default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org record; v_e record; v_today date; v_r record; v_n int := 0; v_ins int; v_label text;
begin
  for v_org in select o.id from public.organizations o loop
    v_today := coalesce(p_as_of, public.equipment_org_today(v_org.id));
    for v_e in select * from public.equipment_downtime_escalations(v_org.id, v_today) loop
      insert into public.equipment_escalation_log (org_id, asset_id, period_start, sent_on, down_days)
      values (v_org.id, v_e.asset_id, v_e.period_start, v_today, v_e.down_days) on conflict do nothing;
      get diagnostics v_ins = row_count;
      if v_ins = 0 then continue; end if;
      select a.code || ' ' || a.name into v_label from public.equipment_assets a where a.id = v_e.asset_id;
      for v_r in select p.id from public.profiles p where p.org_id = v_org.id and p.role in ('Admin','Project Manager') loop
        perform public.notify_workflow_user(v_org.id, v_r.id, 'Equipment down more than 2 days',
          v_label || ': down since ' || v_e.period_start::text, 'warning', 'equipment_asset', v_e.asset_id, v_label);
      end loop;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function public.run_equipment_downtime_escalations(date) from public, anon, authenticated;
alter function public.run_equipment_downtime_escalations(date) owner to postgres;

-- FR-EAV-009: the on-screen flag for the caller's org (same rule, org calendar date)
create function public.list_equipment_downtime_flags() returns table (asset_id uuid, period_start date, down_days int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  return query select e.asset_id, e.period_start, e.down_days
    from public.equipment_downtime_escalations(public.auth_org_id(), public.equipment_org_today(public.auth_org_id())) e;
end $$;

alter function public.equipment_metrics(uuid[], date, date, text) owner to postgres;
alter function public.list_equipment_downtime_flags() owner to postgres;
revoke all on function public.equipment_metrics(uuid[], date, date, text), public.list_equipment_downtime_flags() from public, anon, authenticated;
grant execute on function public.equipment_metrics(uuid[], date, date, text), public.list_equipment_downtime_flags() to authenticated;

select cron.schedule('equipment-downtime-escalation', '17 1 * * *', $$select public.run_equipment_downtime_escalations()$$);
