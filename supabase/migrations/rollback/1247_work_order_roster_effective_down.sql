-- Rollback of 1247: restore the 1036 work_order_roster.
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
    select m.crew_id, m.worker_id, w.name as display_name, m.standard_role_id
      from public.crew_members m join public.people_directory w on w.id = m.worker_id
     where m.crew_id in (select id from rostered)
       and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                        where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                          and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
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
