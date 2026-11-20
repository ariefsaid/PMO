-- 1023_billing_reconciliation_down.sql — reverses 1023: drops the read-only reconciliation function (no data).
drop function if exists public.billing_reconciliation(uuid, uuid);
