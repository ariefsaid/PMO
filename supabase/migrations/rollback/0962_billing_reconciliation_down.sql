-- 0962_billing_reconciliation_down.sql — reverses 0962: drops the read-only reconciliation function (no data).
drop function if exists public.billing_reconciliation(uuid, uuid);
