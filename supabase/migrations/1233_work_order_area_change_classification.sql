-- 1233: classify the work-order area columns (#2705, added by 1210) in the change-history registry, so the catalog gate
-- (record_changes_catalog_gate, AC-CHG-011) sees every column of work_orders classified exactly once.
-- Rollback: supabase/migrations/rollback/1233_work_order_area_change_classification_down.sql
-- Classified as CAPTURED (kind number), not omitted: the area is the site point and radius a phone check-in is measured
-- against, so moving or resizing it changes who counts as off-area. That is a meaningful change a reader of the work
-- order's history should see. It is a place on a map the order is about, not a person's location, so the registry's rule
-- against capturing personal data does not apply. The columns are SELECT-able by authenticated (table-level grant).
update public.record_history_config
   set captured = captured || '{"area_lat":"number","area_lng":"number","area_radius_m":"number"}'::jsonb
 where entity_type = 'work_order';
