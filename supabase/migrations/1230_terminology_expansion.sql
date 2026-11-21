-- 1230_terminology_expansion.sql — the renameable terms grow from 6 to 16 (#2712, map #2516).
-- Same table, same RLS, same adapter (see 1024); only the accepted term_key list widens.
-- Reversal: supabase/migrations/rollback/1230_terminology_expansion_down.sql

alter table public.org_terminology drop constraint if exists org_terminology_term_key_check;
alter table public.org_terminology add constraint org_terminology_term_key_check check (term_key in (
  'workOrder','project','clientSuppliedStock','purchaseRequest','discipline','materialRequest',
  'billOfQuantities','contractItem','dailyRevenue','acceptedQuantity','costVariation','deliveryNote',
  'stockCount','imprest','standIn','progressClaim'
));
