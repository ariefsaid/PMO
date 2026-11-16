-- Rollback of 0885_void_subcontract_bill.sql (#1671).
-- Refused while a voided bill exists: dropping the columns would leave its erp_cancelled_at stamp with no record of why.
do $$ begin
  if exists (select 1 from public.procurement_invoices where voided_at is not null) then
    raise exception 'rollback refused: voided bills exist — export them first'; end if; end $$;
drop function if exists public.void_subcontract_bill(uuid, text);
drop trigger if exists payments_zz_voided_bill on public.payments;
drop function if exists public.guard_payment_voided_bill();
drop trigger if exists procurement_invoices_void_guard on public.procurement_invoices;
drop function if exists public.guard_procurement_invoice_void();
update public.record_history_config
   set captured = captured - array['voided_at','voided_by'], flag_cols = array_remove(flag_cols, 'void_reason')
 where table_name = 'procurement_invoices';
alter table public.procurement_invoices drop constraint if exists procurement_invoices_void_shape;
alter table public.procurement_invoices drop column if exists void_reason, drop column if exists voided_by,
  drop column if exists voided_at;
