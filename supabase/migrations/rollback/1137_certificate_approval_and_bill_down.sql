-- 1137_certificate_approval_and_bill_down.sql — refused while a bill carries a deduction or a certificate is past draft (NFR-SPC-005).
do $$ begin
  if exists (select 1 from public.procurement_invoices where deduction_amount <> 0 or certificate_id is not null)
     or exists (select 1 from public.subcontract_certificates where status not in ('draft', 'cancelled'))
  then raise exception 'rollback refused: certificates past draft or bills with a deduction exist — export and remove them first'; end if;
end $$;
drop trigger if exists procurement_invoices_zz_certificate_void on public.procurement_invoices;
drop function if exists public.spc_on_bill_void();
drop function if exists public.bill_subcontract_certificate(uuid, date, text, text, text, numeric, numeric, text);
drop function if exists public.approve_subcontract_certificate(uuid);
drop function if exists public.cancel_subcontract_certificate(uuid, text);
drop function if exists public.return_subcontract_certificate(uuid, text);
drop function if exists public.spc_release(uuid, boolean);
drop function if exists public.submit_subcontract_certificate(uuid);
drop trigger if exists payments_zz_net_of_deduction on public.payments;
drop function if exists public.guard_payment_net_of_deduction();
drop trigger if exists procurement_invoices_zz_deduction on public.procurement_invoices;
drop function if exists public.guard_invoice_deduction();
update public.record_history_config set captured = captured - 'deduction_amount' - 'certificate_id' where table_name = 'procurement_invoices';
alter table public.procurement_invoices drop column if exists certificate_id;
alter table public.procurement_invoices drop column if exists deduction_amount;
