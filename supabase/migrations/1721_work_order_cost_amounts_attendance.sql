-- 1721_work_order_cost_amounts_attendance.sql — approved hours of crew members with no login become work-order labour
-- cost (docs/specs/no-login-labour-cost.spec.md FR-NLL-003..007, 009). Plan: docs/plans/2026-11-22-no-login-labour-cost.md (T3).
--   1. labour_cost_class_lines(project): every class-priced labour line of a project. Branch one: the costed attendance
--      days of 1720's view, priced at the class rate in force for the class the person holds that date, by the timesheet
--      rule of 1251 (regular hours fill the rate's day length across the person's costed days of the date, ordered by
--      project then id; the rest at the overtime multiplier). A day with no class or no class rate is a line with no
--      amount. Gated on the labour cost switch: off = no line. A later class-priced source (guard head-count) adds a
--      branch here; work_order_cost_amounts maps the lines generically and is not restated for it.
--   2. work_order_cost_amounts restated from the database at head (1298 + the light-account guard) with the class
--      lines appended: per row for Admin, Executive, Finance; for a Project Manager the priced money is one row per
--      source, work order, discipline, class and unit with no record, date or person, and unpriced lines name no person.
--   3. work_order_idle_cost restated from head: the work-order hourly cost reads every counted labour row measured in
--      hours (labour class set), so attendance-only labour is costed too. Today's rows are the same rows (a counted
--      timesheet row always carries its rate's class).
-- drops: work_order_idle_cost's hourly-cost filter reads every counted hourly labour row, not only timesheet rows (FR-NLL-009)
-- Proven by supabase/tests/1721_no_login_labour_cost.test.sql. Reverse: rollback/1721_work_order_cost_amounts_attendance_down.sql.

create function public.labour_cost_class_lines(p_project_id uuid)
returns table(source text, record_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, class_id uuid,
              quantity numeric, quantity_unit text, amount numeric, worker_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with org as (select public.auth_org_id() as id),
  proj_days as (
    select distinct d.worker_id, d.work_date
      from public.labour_cost_attendance_days d, org
     where d.org_id = org.id and d.project_id = p_project_id and public.labour_cost_enabled(org.id)
  ), ent as (
    select d.* from public.labour_cost_attendance_days d
      join proj_days p on p.worker_id = d.worker_id and p.work_date = d.work_date, org
     where d.org_id = org.id
  ), rated as (
    select ent.*, x.class_id, r.basis, r.amount as rate_amount, r.overtime_multiplier, r.day_hours, r.month_hours
      from ent cross join org
     cross join lateral public.labour_class_for(org.id, ent.worker_id, ent.work_date) x
     cross join lateral public.labour_class_rate_for(org.id, x.class_id, ent.work_date) r
  ), cum as (
    select rated.*, coalesce(sum(rated.hours) over (partition by rated.worker_id, rated.work_date
             order by rated.project_id, rated.id rows between unbounded preceding and 1 preceding), 0) as prior
      from rated
  ), split as (
    select cum.*, greatest(0, least(cum.hours, cum.day_hours - cum.prior)) as regular_hours,
           case cum.basis when 'hourly' then cum.rate_amount when 'daily' then cum.rate_amount / cum.day_hours
                          else cum.rate_amount / cum.month_hours end as hourly
      from cum
  )
  select 'attendance_day'::text, s.id, s.work_order_id, c.discipline_id, s.work_date, s.class_id, s.hours, 'hours'::text,
         round(s.hourly * (s.regular_hours + (s.hours - s.regular_hours) * s.overtime_multiplier), 2), s.worker_id
    from split s left join public.crews c on c.id = s.crew_id
   where s.project_id = p_project_id
  union all
  select 'attendance_day'::text, e.id, e.work_order_id, c.discipline_id, e.work_date, null::uuid, e.hours, 'hours'::text,
         null::numeric, e.worker_id
    from ent e left join public.crews c on c.id = e.crew_id
   where e.project_id = p_project_id and not exists (select 1 from rated x where x.id = e.id)
$$;
revoke all on function public.labour_cost_class_lines(uuid) from public, anon, authenticated;

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
  select l.source, null::uuid, p_project_id, l.work_order_id, l.discipline_id, null::date, null::text, v_cur,
         sum(l.amount)::text, 'counted', sum(l.quantity), l.quantity_unit, null::uuid, l.class_id
    from cls l
   where v_pm and l.amount is not null
   group by l.source, l.work_order_id, l.discipline_id, l.class_id, l.quantity_unit
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
              amount text, currency text, reason text)
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
  if not public.idle_cost_enabled(v_org) then return; end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';

  return query
  with wo_cost as (
    select c.work_order_id as wo, sum(c.amount::numeric) as amt, sum(c.quantity) as hrs
      from public.work_order_cost_amounts(p_project_id) c
     where c.reason = 'counted' and c.labour_class_id is not null and c.quantity_unit = 'hours' and c.work_order_id is not null
     group by c.work_order_id
  ), idle as (
    select d.work_order_id as wo, ip.reason_id, sum(ip.minutes)::bigint as mins
      from public.dsr_idle_periods ip
      join public.daily_site_reports d on d.id = ip.report_id
     where d.org_id = v_org and d.project_id = p_project_id and ip.org_id = v_org
       and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     group by d.work_order_id, ip.reason_id
  )
  select i.wo, i.reason_id, r.label, i.mins,
         round(i.mins / 60.0, 2)::text,
         case when v_pm or w.hrs is null or w.hrs <= 0 then null::text else round(w.amt / w.hrs, 2)::text end,
         case when w.hrs > 0 then round(i.mins / 60.0 * (w.amt / w.hrs), 2)::text end,
         v_cur,
         case when w.hrs > 0 then 'counted' else 'no-rate' end
    from idle i
    join public.dsr_idle_reasons r on r.id = i.reason_id and r.org_id = v_org
    left join wo_cost w on w.wo = i.wo
   order by i.wo, r.label, i.reason_id;
end $$;
revoke all on function public.work_order_idle_cost(uuid) from public, anon;
grant execute on function public.work_order_idle_cost(uuid) to authenticated;
