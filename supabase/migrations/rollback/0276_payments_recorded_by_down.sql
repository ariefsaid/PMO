-- Rollback of 0276_payments_recorded_by.sql (#910, DD-VPAY-9) — restore the record_history_config
-- classification first (the catalog gate refuses an unclassified column only while it exists; a
-- captured entry for a dropped column is equally refused), then drop the column.

update public.record_history_config
   set captured = captured - 'recorded_by_id'
 where entity_type = 'payment'
   and (captured ? 'recorded_by_id');

alter table public.payments
  drop column if exists recorded_by_id;

notify pgrst, 'reload schema';
