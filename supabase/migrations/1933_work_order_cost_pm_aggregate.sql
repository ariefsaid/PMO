-- 1933_work_order_cost_pm_aggregate.sql — a Project Manager reads class-priced labour money per work order and discipline only.
-- work_order_cost_amounts restated from 1721 (the latest migration that defines it; 1722 restated labour_cost_class_lines only):
-- the Project Manager's class-line rows (no-login attendance, head count) lose the class and the quantity and are grouped per
-- source, work order and discipline. Admin, Executive and Finance read every row as before; the timesheet rows are unchanged.
-- work_order_idle_cost restated from 1731 (the latest): its work-order hourly cost reads the class lines from
-- labour_cost_class_lines, so the idle figures stay the same for every role.
-- drops: the Project Manager class-line select returns null quantity and null class and its group by no longer names the class; the idle cost's wo_cost select and group by are rewritten over a union of the timesheet rows and labour_cost_class_lines (same rows).
-- Proven by supabase/tests/1721_no_login_labour_cost.test.sql and 1722_headcount_cost.test.sql.
-- Rollback: supabase/migrations/rollback/1933_work_order_cost_pm_aggregate_down.sql

create or replace function public.work_order_cost_amounts(p_project_id uuid)
returns table(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date,
              reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid,
              labour_class_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
  v_pm boolean;
begin
  perform public.assert_not_light();
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';

  return query
  with priced as (select * from public.labour_cost_priced_lines(p_project_id))
  , cls as (select * from public.labour_cost_class_lines(p_project_id))
  -- 1721: class-priced labour lines (costed attendance days). Per row, except a Project Manager's priced money.
  select l.source, l.record_id, p_project_id, l.work_order_id, l.discipline_id, l.occurred_on, null::text,
         case when l.amount is null then null::text else v_cur end, l.amount::text,
         case when l.amount is null then 'no-rate' else 'counted' end, l.quantity, l.quantity_unit,
         case when v_pm then null::uuid else l.worker_id end, l.class_id
    from cls l
   where not v_pm or l.amount is null
  union all
  -- 1933: a Project Manager's class-priced money is one row per source, work order and discipline, with no class and no
  -- quantity, so no class rate can be read from amount over quantity. Its sum is the per-row sum Admin, Executive and Finance read.
  select l.source, null::uuid, p_project_id, l.work_order_id, l.discipline_id, null::date, null::text, v_cur,
         sum(l.amount)::text, 'counted', null::numeric, l.quantity_unit, null::uuid, null::uuid               -- mut:pm_mask
    from cls l
   where v_pm and l.amount is not null
   group by l.source, l.work_order_id, l.discipline_id, l.quantity_unit
  union all
  select b.source, b.record_id, b.project_id, b.work_order_id, b.discipline_id, b.occurred_on, b.reference, b.currency,
         b.amount, b.reason, b.quantity, b.quantity_unit, b.person_id, null::uuid
    from public.work_order_cost_amounts_pre_labour(p_project_id) b
   where not (b.source = 'timesheet_entry' and exists (select 1 from priced x where x.entry_id = b.record_id))
  union all
  select 'timesheet_entry', x.entry_id, p_project_id, x.work_order_id, x.discipline_id, x.entry_date, null::text, v_cur,
         x.amount::text, 'counted', x.hours, 'hours', x.person_id, x.class_id
    from priced x
   where not v_pm
  union all
  select 'timesheet_entry', null::uuid, p_project_id, x.work_order_id, x.discipline_id, null::date, null::text, v_cur,
         sum(x.amount)::text, 'counted', sum(x.hours), 'hours', null::uuid, x.class_id
    from priced x
   where v_pm
   group by x.work_order_id, x.discipline_id, x.class_id;
end $$;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;

create or replace function public.work_order_idle_cost(p_project_id uuid)
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
    -- 1933: the class-priced lines are read from labour_cost_class_lines (the caller's cost read no longer carries their hours
    -- for a Project Manager), the timesheet lines from the cost read as before. The same rows as before, for every role.
    select y.wo, sum(y.amt) as amt, sum(y.hrs) as hrs from (
      select c.work_order_id as wo, c.amount::numeric as amt, c.quantity as hrs
        from public.work_order_cost_amounts(p_project_id) c
       where c.reason = 'counted' and c.labour_class_id is not null and c.quantity_unit = 'hours' and c.work_order_id is not null
         and c.source = 'timesheet_entry'
      union all
      select l.work_order_id, l.amount, l.quantity
        from public.labour_cost_class_lines(p_project_id) l
       where l.amount is not null and l.class_id is not null and l.quantity_unit = 'hours' and l.work_order_id is not null
    ) y group by y.wo
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
