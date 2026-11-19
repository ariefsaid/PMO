-- 0989_attendance_days_down.sql — reverse 0989. Reverse 0990 first.
drop function if exists public.attendance_record(uuid, date, text, jsonb);
drop policy if exists storage_objects_attendance_photo_write on storage.objects;
drop policy if exists storage_objects_attendance_photo_read on storage.objects;
-- bucket: only once it holds no objects (remove them through the Storage API first):
--   delete from storage.buckets where id = 'attendance-photos';
drop table if exists public.attendance_photos;
drop table if exists public.attendance_days;
drop function if exists public.guard_attendance_day();
drop function if exists public.attendance_can_record(uuid);
drop function if exists public.worker_off_rotation(uuid, date);
-- restore the 0988 roster read (no off_rotation) before its table goes
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
    select m.crew_id, m.worker_id, w.display_name, w.kind, w.profile_id, m.standard_role_id
      from public.crew_members m join public.crew_workers w on w.id = m.worker_id
     where m.crew_id in (select id from rostered)
       and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'kind', p.kind, 'has_login', p.profile_id is not null,
                                                       'standard_role_id', p.standard_role_id)
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

drop table if exists public.crew_worker_rotation_off;
alter table public.organizations
  drop column if exists attendance_conflict_tolerance_hours,
  drop column if exists attendance_backdate_days;
