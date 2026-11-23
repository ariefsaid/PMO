-- 1730_idle_cost_scope.sql — what idle cost covers (docs/specs/idle-with-rent.spec.md FR-IWR-001, FR-IWR-002).
--   idle_cost_settings.scope: 'labour_average' (default, today's figure: idle hours x the work order's hourly cost) or
--   'people_and_equipment' (idle hours x the head count of the day x hourly cost, plus rented-equipment standby cost).
--   Default keeps today's money figure for every organisation already using idle cost.
--   save_idle_cost_scope(text): Admin and Finance only (labour_cost_gate), the database is the authority.
--   idle_headcount_days(org, project): head count per work order and date, one place to join a new source of people
--   (present attendance days + approved daily head-count lines of 1710). Internal: no client role may call it.
-- drops: none (new objects only)
-- Proven by supabase/tests/1730_idle_cost_scope.test.sql. Reverse: rollback/1730_idle_cost_scope_down.sql.

alter table public.idle_cost_settings
  add column scope text not null default 'labour_average'
  constraint idle_cost_settings_scope_check check (scope in ('labour_average', 'people_and_equipment'));

create function public.save_idle_cost_scope(p_scope text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.labour_cost_gate();   -- active Admin or Finance, else 42501
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p_scope is null or p_scope not in ('labour_average', 'people_and_equipment') then
    raise exception 'scope is malformed' using errcode = '22023';
  end if;
  insert into public.idle_cost_settings (org_id, scope, updated_by) values (v_org, p_scope, auth.uid())
    on conflict (org_id) do update set scope = excluded.scope, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.save_idle_cost_scope(text) from public, anon;
grant execute on function public.save_idle_cost_scope(text) to authenticated;

-- Head count per work order and date of one project: distinct workers marked present, plus the approved unnamed
-- head-count lines (1710). Unnamed lines carry no worker, so the two never name the same person.
create function public.idle_headcount_days(p_org uuid, p_project_id uuid)
returns table(work_order_id uuid, work_date date, heads integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.work_order_id, u.work_date, sum(u.n)::int
    from (
      select a.work_order_id, a.work_date, count(distinct a.worker_id) as n
        from public.attendance_days a
       where a.org_id = p_org and a.project_id = p_project_id and a.status = 'present'
       group by a.work_order_id, a.work_date
      union all
      select h.work_order_id, h.work_date, sum(h.head_count)
        from public.headcount_days h
        join public.work_orders w on w.id = h.work_order_id and w.project_id = p_project_id
       where h.org_id = p_org and h.approved_at is not null
       group by h.work_order_id, h.work_date
    ) u
   group by u.work_order_id, u.work_date
$$;
revoke all on function public.idle_headcount_days(uuid, uuid) from public, anon, authenticated;
