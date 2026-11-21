-- 1298_work_order_labour_reads_aggregate.sql — labour cost reads for Project Managers are aggregate.
-- Restates work_order_cost_amounts (1252) and work_order_idle_cost (1256) whole from their latest definitions;
-- for a Project Manager the priced labour money becomes one row per work order, discipline and labour class with
-- summed hours and summed amount, and no record id, no date and no person (the ruling: a Project Manager reads
-- amounts, never a rate or a person — docs/specs/labour-cost-money.spec.md FR-LCM-013, FR-IHC-005 for the idle
-- hourly cost). Every other role reads exactly what 1252/1256 returned. No gate, grant or column changes.
-- Proven by supabase/tests/1298_work_order_labour_reads.test.sql.
-- Reverse: supabase/migrations/rollback/1298_work_order_labour_reads_aggregate_down.sql.
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
     where c.source = 'timesheet_entry' and c.reason = 'counted' and c.work_order_id is not null
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
