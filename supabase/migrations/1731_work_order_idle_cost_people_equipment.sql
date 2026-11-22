-- 1731_work_order_idle_cost_people_equipment.sql — idle cost adds up people and rented equipment (docs/specs/idle-with-rent.spec.md
-- FR-IWR-002..006). Plan: docs/plans/2026-11-22-idle-with-rent.md (T2).
--   work_order_idle_cost restated from the database at head (1721). The return type gains people_amount, equipment_amount
--   and headcount_hours, so the function is dropped and created again. Under scope 'labour_average' (the default) the
--   rows are exactly 1721's and the new columns are null. Under 'people_and_equipment', per work order and reason:
--   people = sum over days of idle minutes / 60 x head count of the day x the work order's hourly cost; equipment =
--   approved, non-archived standby entries naming the work order, at the standby rate in force, on days with recorded
--   idle time, shared across that day's reasons by idle minutes; amount = people + equipment. Each figure is rounded once
--   per reason row. A read only: nothing here touches work_order_cost_amounts, actuals, margin or the ledger.
-- drops: the idle read is split per day (idle_day) before it is summed per reason, and the amount column gains the scope arms; the amount line, the idle CTE select and its group by are restated; the function is dropped and created again for the new return type
-- Proven by supabase/tests/1731_idle_with_rent.test.sql. Reverse: rollback/1731_work_order_idle_cost_people_equipment_down.sql.

drop function public.work_order_idle_cost(uuid);
create function public.work_order_idle_cost(p_project_id uuid)
returns table(work_order_id uuid, reason_id uuid, reason_label text, minutes bigint, hours text, hourly_cost text,
              amount text, currency text, reason text, people_amount text, equipment_amount text, headcount_hours text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
  v_pm boolean;
  v_full boolean;
begin
  perform public.assert_not_light();
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.idle_cost_enabled(v_org) then return; end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';
  v_full := coalesce((select s.scope from public.idle_cost_settings s where s.org_id = v_org), 'labour_average') = 'people_and_equipment';

  return query
  with wo_cost as (
    select c.work_order_id as wo, sum(c.amount::numeric) as amt, sum(c.quantity) as hrs
      from public.work_order_cost_amounts(p_project_id) c
     where c.reason = 'counted' and c.labour_class_id is not null and c.quantity_unit = 'hours' and c.work_order_id is not null
     group by c.work_order_id
  ), idle_day as (
    select d.work_order_id as wo, d.work_date as dt, ip.reason_id, sum(ip.minutes)::bigint as mins
      from public.dsr_idle_periods ip
      join public.daily_site_reports d on d.id = ip.report_id
     where d.org_id = v_org and d.project_id = p_project_id and ip.org_id = v_org
       and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     group by d.work_order_id, d.work_date, ip.reason_id
  ), idle as (
    select x.wo, x.reason_id, sum(x.mins)::bigint as mins from idle_day x group by x.wo, x.reason_id
  ), heads as (
    select h.work_order_id as wo, h.work_date as dt, h.heads from public.idle_headcount_days(v_org, p_project_id) h where v_full
  ), standby as (
    select e.work_order_id as wo, e.work_date as dt, sum(e.quantity * coalesce(v.standby_rate, 0)) as amt
      from public.equipment_usage_entries e
      join public.equipment_settings_effective(v_org, null) v
        on v.basis = 'hire_rate' and v.asset_id = e.asset_id and e.unit = v.rate_unit
       and e.work_date between v.window_from and v.window_to
     where v_full and e.org_id = v_org and e.project_id = p_project_id and e.kind = 'standby'
       and e.status = 'Approved' and e.archived_at is null and e.work_order_id is not null
     group by e.work_order_id, e.work_date
  ), day_total as (
    select x.wo, x.dt, sum(x.mins) as tm from idle_day x group by x.wo, x.dt
  ), per_reason as (
    select x.wo, x.reason_id, x.mins::numeric * coalesce(h.heads, 0) as person_minutes,
           coalesce(s.amt, 0) * x.mins / t.tm as equip
      from idle_day x
      join day_total t on t.wo = x.wo and t.dt = x.dt
      left join heads h on h.wo = x.wo and h.dt = x.dt
      left join standby s on s.wo = x.wo and s.dt = x.dt
  ), shared as (
    select p.wo, p.reason_id, sum(p.person_minutes) as person_minutes, sum(p.equip) as equip
      from per_reason p group by p.wo, p.reason_id
  )
  select i.wo, i.reason_id, r.label, i.mins,
         round(i.mins / 60.0, 2)::text,
         case when v_pm or w.hrs is null or w.hrs <= 0 then null::text else round(w.amt / w.hrs, 2)::text end,
         case when not v_full then case when w.hrs > 0 then round(i.mins / 60.0 * (w.amt / w.hrs), 2)::text end
              when w.hrs > 0 then (round(sh.person_minutes / 60.0 * (w.amt / w.hrs), 2) + round(sh.equip, 2))::text
              when sh.equip > 0 then round(sh.equip, 2)::text end,
         v_cur,
         case when w.hrs > 0 then 'counted' else 'no-rate' end,
         case when v_full and w.hrs > 0 then round(sh.person_minutes / 60.0 * (w.amt / w.hrs), 2)::text end,
         case when v_full then round(sh.equip, 2)::text end,
         case when v_full then round(sh.person_minutes / 60.0, 2)::text end
    from idle i
    join shared sh on sh.wo = i.wo and sh.reason_id = i.reason_id
    join public.dsr_idle_reasons r on r.id = i.reason_id and r.org_id = v_org
    left join wo_cost w on w.wo = i.wo
   order by i.wo, r.label, i.reason_id;
end $$;
revoke all on function public.work_order_idle_cost(uuid) from public, anon;
grant execute on function public.work_order_idle_cost(uuid) to authenticated;
