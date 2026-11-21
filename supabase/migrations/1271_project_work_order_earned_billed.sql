-- 1271 (#2733): earned and billed revenue per work order of one project. Earned = frozen amount of validated,
-- current, non-archived progress lines (the work_order_validated_revenue rule); NULL when the work order has no validated
-- line (not available, never zero). Billed = work_order_billing invoiced + pending, excluding tax. Only Issued and Closed
-- work orders (the billable ones). Empty while discipline_profit_enabled is off.
-- Proven by supabase/tests/1270_earned_billed_revenue.test.sql. Reverse: rollback/1271_project_work_order_earned_billed_down.sql.
create function public.project_work_order_earned_billed(p_project uuid)
returns table (work_order_id uuid, currency text, earned numeric, earned_lines integer, unrated_lines integer,
               billed numeric, billed_complete boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_require_member();
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.dsr_may_see_revenue(p_project) then
    raise exception 'you cannot see revenue on this project' using errcode = '42501';
  end if;
  if not coalesce((select o.discipline_profit_enabled from public.organizations o where o.id = public.auth_org_id()), false) then
    return;
  end if;
  return query
    select w.id, w.currency,
           case when count(l.id) = 0 then null else coalesce(sum(l.frozen_amount), 0) end::numeric,
           count(l.id)::integer,
           (count(l.id) filter (where l.frozen_amount is null))::integer,
           (bl.invoiced + bl.pending)::numeric, bl.figures_complete
      from public.work_orders w
      join public.work_order_billing bl on bl.work_order_id = w.id and bl.org_id = w.org_id
      left join public.daily_site_reports d on d.work_order_id = w.id and d.status = 'validated'
                                           and d.superseded_at is null and d.archived_at is null
      left join public.dsr_progress_lines l on l.report_id = d.id
     where w.project_id = p_project and w.org_id = public.auth_org_id() and w.status in ('Issued', 'Closed')
     group by w.id, w.currency, bl.invoiced, bl.pending, bl.figures_complete
     order by w.id;
end $$;
revoke all on function public.project_work_order_earned_billed(uuid) from public, anon;
grant execute on function public.project_work_order_earned_billed(uuid) to authenticated;
