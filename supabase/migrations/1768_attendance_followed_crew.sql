-- 1768_attendance_followed_crew.sql -- the day record can say "followed crew X on this day" (no advance loan).
-- worker_effective_crew and work_order_roster are restated whole from the database at head (1246, 1247); the changes are the
-- followed-crew step in the effective crew and a followed arm in the roster. Spec docs/specs/crew-followed.spec.md.
-- Rollback supabase/migrations/rollback/1768_attendance_followed_crew_down.sql
-- drops: nothing removed in effect; work_order_roster's placed-candidate select lists gain the followed and from_crew_name columns, so three select lines are rewritten.

alter table public.attendance_days add column followed_crew_id uuid references public.crews(id);
alter table public.attendance_days add constraint attendance_days_followed_is_crew
  check (followed_crew_id is null or followed_crew_id = crew_id);
create index attendance_days_followed_idx on public.attendance_days (work_date, worker_id) where followed_crew_id is not null;
comment on column public.attendance_days.followed_crew_id is
  'Set when the person followed a crew other than their own that day without a loan (#crew-followed). Equals crew_id. Written only by attendance_record.';

-- SECURITY: definers so the roster of the home crew and of the receiving crew agree whatever the caller's row visibility;
-- they return only (worker, crew) of the caller's own organisation.
create function public.worker_followed_crew(p_worker_id uuid, p_date date)
  returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select a.followed_crew_id from public.attendance_days a
   where a.worker_id = p_worker_id and a.work_date = p_date and a.followed_crew_id is not null
     and a.org_id = public.auth_org_id()
   order by a.recorded_at, a.id limit 1
$$;
revoke all on function public.worker_followed_crew(uuid, date) from public, anon;
grant execute on function public.worker_followed_crew(uuid, date) to authenticated;

create function public.followed_workers_on(p_date date)
  returns table (worker_id uuid, crew_id uuid) language sql stable security definer set search_path = public, pg_temp as $$
  select distinct a.worker_id, a.followed_crew_id from public.attendance_days a
   where a.work_date = p_date and a.followed_crew_id is not null and a.org_id = public.auth_org_id()
     and public.is_active_member()
$$;
revoke all on function public.followed_workers_on(date) from public, anon;
grant execute on function public.followed_workers_on(date) to authenticated;

CREATE OR REPLACE FUNCTION public.worker_effective_crew(p_worker_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select l.host_crew_id from public.crew_loans l
      where l.worker_id = p_worker_id and p_date between l.valid_from and l.valid_to
      limit 1),
    public.worker_followed_crew(p_worker_id, p_date),
    (select m.crew_id from public.crew_members m
      where m.worker_id = p_worker_id
        and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
        and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                         where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                           and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
      order by m.valid_from desc, m.id
      limit 1))
$function$;

CREATE OR REPLACE FUNCTION public.work_order_roster(p_work_order_id uuid, p_date date)
 RETURNS TABLE(crew_id uuid, crew_code text, crew_name text, field_controller_id uuid, members jsonb, roles jsonb, shortfall integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select x.crew_id, x.worker_id, w.name as display_name, x.standard_role_id, x.on_loan, x.followed, x.from_crew_name
      from (
        select m.crew_id, m.worker_id, m.standard_role_id, false as on_loan, false as followed, null::text as from_crew_name
          from public.crew_members m
         where m.crew_id in (select id from rostered)
           and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
           and not exists (select 1 from public.crew_members n   -- a newer placement covering the day wins (host crew)
                            where n.worker_id = m.worker_id and n.id <> m.id and n.valid_from > m.valid_from
                              and p_date between n.valid_from and coalesce(n.valid_to, 'infinity'::date))
        union all
        select l.host_crew_id, l.worker_id, null::uuid, true, false, null::text
          from public.crew_loans l
         where l.host_crew_id in (select id from rostered)
           and p_date between l.valid_from and l.valid_to
        union all
        -- 1768: a person recorded on the day as following this crew (no loan, no placement change)
        select f.crew_id, f.worker_id, null::uuid, false, true,
               (select hc.name from public.crew_members hm join public.crews hc on hc.id = hm.crew_id
                 where hm.worker_id = f.worker_id and p_date between hm.valid_from and coalesce(hm.valid_to, 'infinity'::date)
                 order by hm.valid_from desc, hm.id limit 1)
          from public.followed_workers_on(p_date) f
         where f.crew_id in (select id from rostered)
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
                                    || case when p.followed then jsonb_build_object('followed', true, 'from_crew_name', p.from_crew_name) else '{}'::jsonb end
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
$function$;
