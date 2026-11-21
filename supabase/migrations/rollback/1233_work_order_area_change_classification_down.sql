-- Rollback of 1233_work_order_area_change_classification.sql.
update public.record_history_config
   set captured = captured - 'area_lat' - 'area_lng' - 'area_radius_m'
 where entity_type = 'work_order';
