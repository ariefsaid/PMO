-- Reverses 1116_sales_invoice_retention_held.sql (#2625). Nothing stored depends on it; the app's selects name it, so roll
-- the app back first.
drop function if exists public.retention_held(public.sales_invoices);
