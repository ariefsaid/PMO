-- 1383_work_orders_area_group.sql — #2668: a work order may name one area and one group (FR-WAG-003/004).
-- Composite foreign keys on (org_id, id) make "same organisation" a database rule; MATCH SIMPLE means a null
-- area/group is always valid. A delete of an entry in use is FK-blocked (23503).
-- ── REVERSE (rollback/1383_work_orders_area_group_down.sql) ───────────────────────────────────────────
alter table public.work_orders
  add column area_id  uuid,
  add column group_id uuid;
alter table public.work_orders
  add constraint work_orders_area_same_org  foreign key (org_id, area_id)  references public.work_order_areas  (org_id, id),
  add constraint work_orders_group_same_org foreign key (org_id, group_id) references public.work_order_groups (org_id, id);
create index work_orders_area_idx  on public.work_orders (org_id, project_id, area_id)  where area_id  is not null;
create index work_orders_group_idx on public.work_orders (org_id, project_id, group_id) where group_id is not null;
-- No column grant: 0193's work_orders grant lists are a pinned SoD surface (0193 AC-WO-011/012), so the two columns are
-- written only through set_work_order_area_group (1384), which mirrors the table's update role rule.
-- Record history (0260 registry): the two new columns are tracked refs, like work_order_id on the purchase records (0951).
update public.record_history_config
   set captured = captured || '{"area_id":"ref","group_id":"ref"}'::jsonb
 where table_name = 'work_orders';
