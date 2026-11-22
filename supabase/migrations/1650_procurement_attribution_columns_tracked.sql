-- 1650_procurement_attribution_columns_tracked.sql — the purchase's work order and discipline (1580) join its record history.
--
-- 1580 added work_order_id and discipline_id to procurements without classifying them in the record-history registry, so the
-- catalogue gate (AC-CHG-011) named both as unclassified. They are tracked refs, like work_order_id on the purchase records (0951).
-- Reversal: supabase/migrations/rollback/1650_procurement_attribution_columns_tracked_down.sql
update public.record_history_config
   set captured = captured || '{"work_order_id":"ref","discipline_id":"ref"}'::jsonb
 where table_name = 'procurements';
