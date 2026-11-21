-- 1210 (#2705): the work-order area (a point and a radius in metres) and the organisation's supervisor-role setting for off-area check-ins.
-- Rollback: supabase/migrations/rollback/1210_phone_clock_in_area_down.sql
-- No area (all three NULL) = no location is asked and clock-in behaves as before. Who sets the area is whoever may update a work order
-- today (work_orders_update); no new write path. The setting names a built-in role key; NULL = the crew's field controller / attendance approver.
alter table public.work_orders
  add column area_lat double precision,
  add column area_lng double precision,
  add column area_radius_m double precision,
  add constraint work_orders_area_all_or_none check (
    (area_lat is null and area_lng is null and area_radius_m is null)
    or (area_lat is not null and area_lng is not null and area_radius_m is not null
        and area_lat between -90 and 90 and area_lng between -180 and 180 and area_radius_m > 0 and area_radius_m <= 50000));
comment on column public.work_orders.area_lat is '#2705 Work-order area: centre latitude. All three area columns set or all NULL.';

alter table public.organizations
  add column phone_check_in_supervisor_role text references public.built_in_roles(key);
comment on column public.organizations.phone_check_in_supervisor_role is
  '#2705 Built-in role key of who decides off-area phone check-ins. NULL = the crew''s field controller or anyone who may record attendance. Written only by set_phone_check_in_supervisor_role (Admin).';

create function public.get_phone_check_in_supervisor_role() returns text
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case when public.is_active_member()
              then (select o.phone_check_in_supervisor_role from public.organizations o where o.id = public.auth_org_id()) end
$$;

create function public.set_phone_check_in_supervisor_role(p_role text) returns text
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change the check-in supervisor role' using errcode = '42501';
  end if;
  if p_role is not null and not exists (select 1 from public.built_in_roles r where r.key = p_role) then
    raise exception 'PCI_ROLE: unknown built-in role' using errcode = '22023';
  end if;
  update public.organizations set phone_check_in_supervisor_role = p_role where id = v_org;
  return p_role;
end $$;

revoke all on function public.get_phone_check_in_supervisor_role(), public.set_phone_check_in_supervisor_role(text) from public, anon;
grant execute on function public.get_phone_check_in_supervisor_role(), public.set_phone_check_in_supervisor_role(text) to authenticated;
