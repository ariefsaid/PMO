-- 0040_gr_vi_reference_amount.sql — Extend GR + VI with external-reference + VI amount.
-- Forward-only, additive; reversibility contract is `supabase db reset` (pre-production, ADR-0006).
--
-- Adds two nullable columns to procurement_receipts (GR):
--   • reference_number text — supplier delivery-note number (e.g. "DN-44120").
--
-- Adds two nullable columns to procurement_invoices (VI):
--   • reference_number text — supplier invoice number (e.g. "INV-SF-2291").
--   • amount numeric(14,2) — invoice total (fills the ledger amount column, AC-PR-LEDGER-015).
--
-- Column adds inherit existing RLS policies on their tables (no RLS change needed — the column
-- becomes readable/writable wherever the row is accessible, which is already restricted by
-- procurement_receipts_select / procurement_invoices_select).
--
-- Rollback (dev-only — supabase db reset is authoritative):
--   alter table procurement_receipts drop column if exists reference_number;
--   alter table procurement_invoices  drop column if exists reference_number;
--   alter table procurement_invoices  drop column if exists amount;

alter table procurement_receipts
  add column reference_number text;   -- nullable, additive (AC-PR-LEDGER-015)

alter table procurement_invoices
  add column reference_number text,   -- nullable, additive (AC-PR-LEDGER-015)
  add column amount numeric(14,2);    -- nullable, additive (AC-PR-LEDGER-015)
