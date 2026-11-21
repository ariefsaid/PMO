-- 1384_work_order_area_group_guard.sql — #2668 (FR-WAG-004): an archived area or group cannot be newly named.
-- A work order that already names an entry keeps it on unrelated edits (the check fires only when the value changes).
-- ── REVERSE (rollback/1384_work_order_area_group_guard_down.sql) ──────────────────────────────────────
create or replace function public.check_work_order_area_group_live() returns trigger
  language plpgsql security invoker set search_path = public as $$
begin
  if new.area_id is not null and (tg_op = 'INSERT' or new.area_id is distinct from old.area_id)
     and exists (select 1 from public.work_order_areas a where a.id = new.area_id and a.archived_at is not null) then
    raise exception 'WO_AREA_ARCHIVED: the work order area is archived' using errcode = '23514';
  end if;
  if new.group_id is not null and (tg_op = 'INSERT' or new.group_id is distinct from old.group_id)
     and exists (select 1 from public.work_order_groups g where g.id = new.group_id and g.archived_at is not null) then
    raise exception 'WO_GROUP_ARCHIVED: the work order group is archived' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.check_work_order_area_group_live() from public, anon, authenticated;
create trigger work_orders_area_group_live before insert or update on public.work_orders
  for each row execute function public.check_work_order_area_group_live();

-- The only writer of the two columns (1383 grants none). Same role rule as work_orders_update (0193): an active member of
-- the work order's org in Admin / Executive / Project Manager / Finance. The composite FKs and the guard above still apply.
-- p_set_area / p_set_group say which of the two to change, so a form that offers only one picker leaves the other alone.
create or replace function public.set_work_order_area_group(
  p_work_order uuid, p_area uuid default null, p_group uuid default null,
  p_set_area boolean default true, p_set_group boolean default true) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.auth_org_id() is null or not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'only an Admin, Executive, Project Manager or Finance member can set a work order''s area or group' using errcode = '42501';
  end if;
  update public.work_orders w
     set area_id  = case when p_set_area  then p_area  else w.area_id  end,
         group_id = case when p_set_group then p_group else w.group_id end
   where w.id = p_work_order and w.org_id = public.auth_org_id();
  if not found then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.set_work_order_area_group(uuid, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.set_work_order_area_group(uuid, uuid, uuid, boolean, boolean) to authenticated;
