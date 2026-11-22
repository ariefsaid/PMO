-- 1266 (#2669): tag a contract item with a discipline, and read validated revenue per discipline.
-- Revenue is the amount frozen at validation (contract rate), only from current, non-superseded, non-archived validated
-- reports (the rule work_order_validated_revenue uses). Proven by supabase/tests/1265_discipline_profit.test.sql.
-- Reverse: supabase/migrations/rollback/1266_discipline_profit_rpcs_down.sql.

create function public.set_boq_item_discipline(p_item uuid, p_discipline uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  perform public.dsr_require_member();
  select b.project_id into v_project from public.boq_items b where b.id = p_item and b.org_id = v_org;
  if v_project is null then raise exception 'contract item not found' using errcode = 'P0002'; end if;
  if not public.dsr_may_see_revenue(v_project) then
    raise exception 'you cannot change contract items on this project' using errcode = '42501';
  end if;
  if p_discipline is not null and not exists (
       select 1 from public.cost_disciplines d where d.id = p_discipline and d.org_id = v_org and d.archived_at is null) then
    raise exception 'the discipline is not on your list or is archived' using errcode = '23514';
  end if;
  update public.boq_items set discipline_id = p_discipline where id = p_item;
  return p_discipline;
end $$;
revoke all on function public.set_boq_item_discipline(uuid, uuid) from public, anon;
grant execute on function public.set_boq_item_discipline(uuid, uuid) to authenticated;

-- One row per (basis, discipline, currency). `basis` names where the revenue comes from, so another basis can be
-- added as further rows without changing the shape. Empty while the organisation setting is off.
create function public.project_discipline_revenue(p_project uuid)
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
revoke all on function public.project_discipline_revenue(uuid) from public, anon;
grant execute on function public.project_discipline_revenue(uuid) to authenticated;
