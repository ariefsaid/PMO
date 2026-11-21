-- Rollback of 1270_discipline_billed_basis.sql: restore the 1266 body (validated_progress rows only).
create or replace function public.project_discipline_revenue(p_project uuid)
returns table (basis text, discipline_id uuid, currency text, revenue numeric, validated_lines integer, unrated_lines integer)
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
    select 'validated_progress'::text, b.discipline_id, w.currency,
           coalesce(sum(l.frozen_amount), 0)::numeric, count(*)::integer,
           (count(*) filter (where l.frozen_amount is null))::integer
      from public.dsr_progress_lines l
      join public.daily_site_reports d on d.id = l.report_id
      join public.work_orders w on w.id = d.work_order_id
      join public.work_order_lines wl on wl.id = l.work_order_line_id
      join public.boq_items b on b.id = wl.boq_item_id
     where d.project_id = p_project and d.org_id = public.auth_org_id()
       and d.status = 'validated' and d.superseded_at is null and d.archived_at is null
     group by b.discipline_id, w.currency
     order by b.discipline_id nulls last, w.currency;
end $$;
