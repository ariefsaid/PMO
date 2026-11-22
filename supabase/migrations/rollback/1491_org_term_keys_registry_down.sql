-- Rollback of 1491: the term_key CHECK returns exactly as 1450 left it
-- ('workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
--  'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
--  'stockCount','imprest','standIn','progressClaim'), and the key table goes.
alter table public.org_terminology drop constraint if exists org_terminology_term_key_fkey;
alter table public.org_terminology add constraint org_terminology_term_key_check check (term_key in (
  'workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
  'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
  'stockCount','imprest','standIn','progressClaim'
));
drop table if exists public.org_term_keys;
