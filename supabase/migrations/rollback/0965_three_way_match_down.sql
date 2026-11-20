-- Rollback of 0965_three_way_match.sql (#2525).
-- Refused while an approved exception exists: dropping it would erase the record of who released a held bill and why.
do $$ begin
  if exists (select 1 from public.bill_match_exceptions) then
    raise exception 'rollback refused: approved three-way match exceptions exist — export them first'; end if; end $$;
drop function if exists public.approve_bill_match_exception(uuid, text);
drop function if exists public.get_bill_match(uuid);
drop function if exists public.record_bill_match_lines(uuid, jsonb);
drop function if exists public.record_receipt_match_lines(uuid, jsonb);
drop function if exists public.three_way_match_lines_unreadable(jsonb, boolean);
drop function if exists public.set_three_way_match_settings(boolean, numeric, numeric);
drop trigger if exists procurements_zz_three_way_hold on public.procurements;
drop function if exists public.guard_procurement_paid_three_way_hold();
drop trigger if exists procurement_invoices_zz_three_way_hold on public.procurement_invoices;
drop function if exists public.guard_invoice_paid_three_way_hold();
drop trigger if exists payments_zz_three_way_hold on public.payments;
drop function if exists public.guard_payment_three_way_hold();
drop function if exists public.purchase_has_held_bill(uuid);
drop function if exists public.purchase_match_on(uuid);
drop function if exists public.bill_match_evaluate(uuid);
drop table if exists public.bill_match_exceptions;   -- drops its immutability trigger
drop function if exists public.guard_bill_match_exception_immutable();
drop table if exists public.procurement_bill_match_lines;
drop table if exists public.procurement_bill_matches;
drop table if exists public.procurement_receipt_lines;
drop table if exists public.org_three_way_match_settings;
