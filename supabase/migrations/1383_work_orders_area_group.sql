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
-- Column-level grants (0193 §5): a column is writable only if listed. Neither column is money or pushed to the ERP.
grant insert (area_id, group_id) on public.work_orders to authenticated;
grant update (area_id, group_id) on public.work_orders to authenticated;
