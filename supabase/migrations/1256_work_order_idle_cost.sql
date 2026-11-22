-- 1256_work_order_idle_cost.sql — #2673: idle hours of validated daily site reports, costed at the work order's hourly cost.
-- Read-only; posts nothing and never changes direct cost, plan versus actual totals or the ledger (FR-IHC-004).
-- Hourly cost = sum(amount) / sum(hours) over the work order's priced ('counted') timesheet rows from
-- work_order_cost_amounts (1252), a weighted average over the work order's whole history (known v1 limit). Returns no row
-- unless BOTH the labour cost and idle cost switches are on. Eligible reports: validated, not superseded, not archived.
-- Reveals no person and no rate. Proven by supabase/tests/1255_idle_cost.test.sql. Reverse: rollback/1256_work_order_idle_cost_down.sql.
create function public.work_order_idle_cost(p_project_id uuid)
returns table(work_order_id uuid, reason_id uuid, reason_label text, minutes bigint, hours text, hourly_cost text,
              amount text, currency text, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
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
         case when w.hrs > 0 then round(w.amt / w.hrs, 2)::text end,
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
