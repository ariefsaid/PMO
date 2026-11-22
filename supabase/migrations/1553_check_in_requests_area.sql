-- 1553_check_in_requests_area.sql -- the supervisor who decides an outside-area check-in sees the area it is judged against:
-- drops: phone_check_in_requests' select line gains the area columns; no read is removed.
-- phone_check_in_requests() also returns the work order's area (centre and radius). Source: 1213; only the three area columns
-- are added, so the function is dropped and created again (its row type changes). Still refused for a light account.
-- Rollback: supabase/migrations/rollback/1553_check_in_requests_area_down.sql
drop function if exists public.phone_check_in_requests();
create function public.phone_check_in_requests()
  returns table (id uuid, work_order_id uuid, work_order_title text, worker_name text, crew_id uuid, crew_name text, work_date date,
                 hours numeric, outcome text, distance_m numeric, accuracy_m double precision, checked_in_at timestamptz,
                 area_lat double precision, area_lng double precision, area_radius_m double precision)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  return query
    select q.id, q.work_order_id, w.title, pe.name, q.crew_id, c.name, q.work_date, q.hours, q.outcome, q.distance_m, q.accuracy_m, q.checked_in_at,
           w.area_lat, w.area_lng, w.area_radius_m
      from public.phone_check_ins q
      join public.work_orders w on w.id = q.work_order_id
      join public.people pe on pe.id = q.worker_id
      left join public.crews c on c.id = q.crew_id
     where q.org_id = public.auth_org_id() and q.status = 'pending' and public.phone_check_in_may_decide(q.id)
     order by q.checked_in_at, q.id
     limit 200;
end $$;
revoke all on function public.phone_check_in_requests() from public, anon;
grant execute on function public.phone_check_in_requests() to authenticated;
