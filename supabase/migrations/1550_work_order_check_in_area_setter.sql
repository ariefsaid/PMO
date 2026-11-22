-- 1550_work_order_check_in_area_setter.sql -- a work order's check-in area (a point and a radius in metres) can be set, changed
-- and cleared by the roles that may update a work order: Admin, Executive, Project Manager, Finance.
-- The work-order UPDATE grant is a pinned column list (0193) that does not name the area columns, so a direct table write is
-- refused for every role; this RPC is the one writer, like set_work_order_area_group (1384). All three values or none (the table
-- check work_orders_area_all_or_none still applies). A field account (Foreman, Field user) never sets it. The history capture
-- (1233) records the change on the work order; an audit entry names who set it.
-- Rollback: supabase/migrations/rollback/1550_work_order_check_in_area_setter_down.sql
create or replace function public.set_work_order_check_in_area(
  p_work_order uuid, p_lat double precision, p_lng double precision, p_radius_m double precision) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  if v_org is null or public.auth_role() not in ('Admin', 'Executive', 'Project Manager', 'Finance') then      -- mut:area_role
    raise exception 'only an Admin, Executive, Project Manager or Finance member can set a work order''s check-in area' using errcode = '42501';
  end if;
  if not ((p_lat is null and p_lng is null and p_radius_m is null)
          or coalesce(p_lat between -90 and 90 and p_lng between -180 and 180 and p_radius_m > 0 and p_radius_m <= 50000, false)) then
    raise exception 'WO_AREA: give latitude -90 to 90, longitude -180 to 180 and a radius above 0 up to 50000 metres, or all three empty'
      using errcode = '22023';
  end if;
  update public.work_orders w
     set area_lat = p_lat, area_lng = p_lng, area_radius_m = p_radius_m
   where w.id = p_work_order and w.org_id = v_org;                                                               -- mut:area_org
  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  perform public.log_audit('work_order.check_in_area_set', v_org, auth.uid(), p_work_order,
            jsonb_build_object('lat', p_lat, 'lng', p_lng, 'radius_m', p_radius_m));
end $$;
revoke all on function public.set_work_order_check_in_area(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.set_work_order_check_in_area(uuid, double precision, double precision, double precision) to authenticated;
