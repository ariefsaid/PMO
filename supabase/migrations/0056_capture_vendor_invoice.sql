-- 0056_capture_vendor_invoice.sql — atomic vendor-invoice capture (reliability harden #2).
--
-- ProcurementDetails' VI capture was TWO separate FE writes: transition→'Vendor Invoiced'
-- then createInvoice. A failure between them left the case advanced to Vendor Invoiced with
-- NO invoice row (or, if the transition failed after a retry, an invoice with no transition).
-- This RPC does both — plus the status-event log — in ONE transaction (all-or-nothing).
--
-- SECURITY / SoD: the RPC does NOT re-implement or bypass the transition guard. It CALLS the
-- existing transition_procurement() (SECURITY DEFINER, 0038) which enforces the full legal-map +
-- role matrix + SoD-a/SoD-b + tenancy, and CALLS create_procurement_invoice() (0041) which enforces
-- its own role gate + tenancy. auth.uid()/auth_role() resolve from the JWT GUC (not the definer),
-- so SoD fires exactly as it does on the two-call FE path. If EITHER inner call raises, the whole
-- transaction rolls back — no advanced status without an invoice, no invoice without the transition.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`.

create or replace function capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  -- 1. Advance the case (legal-map + role + SoD + tenancy + status-event log, all in-guard).
  --    A raise here (illegal transition / not authorized) aborts before any invoice is created.
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  -- 2. Create the invoice (its own role gate + tenancy re-assertion, mints VI# server-side).
  --    A raise here rolls back the transition from step 1 — the two are atomic.
  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount);

  return v_invoice;
end; $$;

revoke all     on function capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text) from public;
grant  execute on function capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text) to   authenticated;
revoke execute on function capture_vendor_invoice(uuid, procurement_invoice_status, date, text, numeric, text) from anon;
