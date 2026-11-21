-- 1450_terminology_term_keys_carry.sql — carries the #2712 term-key expansion onto the #2687 delivery-note print.
-- Sources: 1230_terminology_expansion.sql (the 16-key list) and 1420_delivery_note_print.sql (re-added the constraint
-- from the pre-1230 body with only the six original keys plus 'deliveryNote', which drops the ten #2712 keys). The
-- union is exactly 1230's list — it already contains 'deliveryNote'. Same table, same RLS, same adapter (see 1024).
-- Reverse: supabase/migrations/rollback/1450_terminology_term_keys_carry_down.sql (1420's list).

alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check check (term_key in (
  'workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
  'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
  'stockCount','imprest','standIn','progressClaim'
));
