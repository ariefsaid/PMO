-- Reverse 0265_efaktur_number.sql.
revoke execute on function public.set_sales_invoice_efaktur(uuid, text, date) from public, anon, authenticated;
revoke execute on function public.set_procurement_invoice_efaktur(uuid, text, date) from public, anon, authenticated;
drop function if exists public.set_sales_invoice_efaktur(uuid, text, date);
drop function if exists public.set_procurement_invoice_efaktur(uuid, text, date);

alter table public.sales_invoices drop constraint if exists sales_invoices_efaktur_number_check;
alter table public.procurement_invoices drop constraint if exists procurement_invoices_efaktur_number_check;
alter table public.sales_invoices drop column if exists efaktur_number, drop column if exists efaktur_date;
alter table public.procurement_invoices drop column if exists efaktur_number, drop column if exists efaktur_date;
