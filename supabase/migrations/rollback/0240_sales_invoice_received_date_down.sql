-- Rollback for 0240_sales_invoice_received_date.sql (#767).
drop function if exists public.set_sales_invoice_received_date(uuid, date);
alter table public.sales_invoices
  drop column if exists received_date,
  drop column if exists erp_due_date;
