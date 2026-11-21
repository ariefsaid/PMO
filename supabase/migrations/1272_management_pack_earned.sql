-- 1272 (#2733): earned revenue per project for the management pack (validated progress, all validated work to date),
-- plus how many Issued/Closed work orders have no validated progress. Rows only for projects whose revenue the caller may
-- see (the pack's cost and margin are computed in the app from the same roll-up the project tab uses). Empty while
-- discipline_profit_enabled is off. get_management_pack is not touched.
-- Proven by supabase/tests/1270_earned_billed_revenue.test.sql. Reverse: rollback/1272_management_pack_earned_down.sql.
create function public.management_pack_earned()
returns table (project_id uuid, currency text, earned numeric, earned_lines integer, unrated_lines integer,
               work_orders integer, work_orders_without_progress integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.dsr_require_member();
  if not coalesce((select o.discipline_profit_enabled from public.organizations o where o.id = public.auth_org_id()), false) then
    return;
  end if;
  return query
    with per_wo as (
      select w.project_id, w.id as wo, w.currency, count(l.id) as lines,
             coalesce(sum(l.frozen_amount), 0) as amount,
             count(l.id) filter (where l.frozen_amount is null) as unrated
        from public.work_orders w
        left join public.daily_site_reports d on d.work_order_id = w.id and d.status = 'validated'
                                             and d.superseded_at is null and d.archived_at is null
        left join public.dsr_progress_lines l on l.report_id = d.id
       where w.org_id = public.auth_org_id() and w.status in ('Issued', 'Closed')
         and public.dsr_may_see_revenue(w.project_id)
       group by w.project_id, w.id, w.currency
    )
    select p.project_id, p.currency, sum(p.amount)::numeric, sum(p.lines)::integer, sum(p.unrated)::integer,
           count(*)::integer, (count(*) filter (where p.lines = 0))::integer
      from per_wo p group by p.project_id, p.currency order by p.project_id, p.currency;
end $$;
revoke all on function public.management_pack_earned() from public, anon;
grant execute on function public.management_pack_earned() to authenticated;
