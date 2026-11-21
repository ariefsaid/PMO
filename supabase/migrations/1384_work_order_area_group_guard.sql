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
