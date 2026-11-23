-- Rollback of 1768: restore the 1630 / 1631 bodies, drop the helpers, index, check and column (followed marks are lost).
create or replace function public.worker_effective_crew(p_worker_id uuid, p_date date)
  returns uuid language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select l.host_crew_id from public.crew_loans l
      where l.worker_id = p_worker_id and p_date between l.valid_from and l.valid_to
        and exists (select 1 from public.work_order_crews r
                     where r.crew_id = l.host_crew_id
                       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date))
      limit 1),
    (select m.crew_id from public.crew_members m
      where m.worker_id = p_worker_id
        and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
        and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                         where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                           and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
      order by m.valid_from desc, m.id
      limit 1))
$$;

create or replace function public.work_order_roster(p_work_order_id uuid, p_date date)
  returns table (crew_id uuid, crew_code text, crew_name text, field_controller_id uuid,
                 members jsonb, roles jsonb, shortfall integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select x.crew_id, x.worker_id, w.name as display_name, x.standard_role_id, x.on_loan
      from (
        select m.crew_id, m.worker_id, m.standard_role_id, false as on_loan
          from public.crew_members m
         where m.crew_id in (select id from rostered)
           and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
           and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                            where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                              and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
        union all
        select l.host_crew_id, l.worker_id, null::uuid, true
          from public.crew_loans l
         where l.host_crew_id in (select id from rostered)
           and p_date between l.valid_from and l.valid_to
      ) x
      join public.people_directory w on w.id = x.worker_id
     where public.worker_effective_crew(x.worker_id, p_date) = x.crew_id
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'standard_role_id', p.standard_role_id,
                                                       'off_rotation', exists (
                                                         select 1 from public.crew_worker_rotation_off o
                                                          where o.worker_id = p.worker_id and p_date between o.off_from and o.off_to))
                                    || case when p.on_loan then jsonb_build_object('on_loan', true) else '{}'::jsonb end
                                    || coalesce((select jsonb_build_object('reported_absent', jsonb_build_object('reason', a.reason, 'note', a.note))
                                                   from public.absence_reports a
                                                  where a.person_id = p.worker_id and a.work_date = p_date), '{}'::jsonb)
                                    order by p.display_name, p.worker_id)
                     from placed p where p.crew_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('standard_role_id', rc.id, 'name', rc.name,
                                                       'headcount', rc.headcount, 'placed', rc.placed,
                                                       'shortfall', greatest(rc.headcount - rc.placed, 0))
                                    order by rc.sort_order, rc.name)
                     from role_counts rc where rc.crew_id = r.id), '[]'::jsonb),
         coalesce((select sum(greatest(rc.headcount - rc.placed, 0))::int from role_counts rc where rc.crew_id = r.id), 0)
    from rostered r
   order by r.code, r.id
$$;

drop function public.worker_followed_crew(uuid, date);
drop index public.attendance_days_followed_idx;
alter table public.attendance_days drop constraint attendance_days_followed_is_crew;
alter table public.attendance_days drop column followed_crew_id;
