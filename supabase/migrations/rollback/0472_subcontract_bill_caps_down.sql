-- 0472_subcontract_bill_caps_down.sql — reverses 0472 (#1513 S3). Refuses while subcontract bill lines exist (NFR-SCA-007):
-- export (scripts/prod-read.sh / pg_dump -t) and remove them first. Never copy rows into a table in `public`: that schema is
-- API-exposed and an `as select *` copy carries no RLS.
do $$ begin
  if exists (select 1 from public.procurement_invoice_lines) then
    raise exception 'rollback refused: subcontract bill lines exist — export and remove them first';
  end if;
end $$;
drop trigger if exists procurement_invoices_zz_subcontract_capture on public.procurement_invoices;
drop function if exists public.capture_subcontract_vendor_invoice(uuid, procurement_invoice_status, date, jsonb, text, numeric, text, text, numeric, numeric, text, integer, integer, text, numeric, text);
drop function if exists public.subcontract_po_position(uuid);
drop function if exists public.subcontract_bill_cap_violation(uuid, jsonb, uuid);
drop function if exists public.subcontract_billed(uuid, uuid);
drop function if exists public.subcontract_bill_is_live(smallint, timestamptz);
drop function if exists public.guard_subcontract_invoice_capture();
drop table if exists public.procurement_invoice_lines;
drop function if exists public.guard_procurement_invoice_line();
