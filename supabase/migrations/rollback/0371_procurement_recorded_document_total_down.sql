-- Reverses 0371: drops the recorded-document total refresh. Totals it already wrote stay as written (they are the
-- documents' amounts); nothing else reads these functions.
drop trigger if exists zy_procurement_invoices_recorded_total on public.procurement_invoices;
drop trigger if exists zy_payments_recorded_total on public.payments;
drop trigger if exists zy_purchase_orders_recorded_total on public.purchase_orders;
drop function if exists public.refresh_procurement_total_on_record();
drop function if exists public.refresh_procurement_recorded_total(uuid);
