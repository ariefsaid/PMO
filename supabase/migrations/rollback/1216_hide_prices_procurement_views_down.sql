-- rollback/1216_hide_prices_procurement_views_down.sql
drop view if exists public.procurements_masked;
drop view if exists public.procurement_items_masked;
drop view if exists public.procurement_invoices_masked;
drop view if exists public.purchase_orders_masked;
drop view if exists public.purchase_requests_masked;
drop view if exists public.payments_masked;
drop view if exists public.purchase_order_lines_masked;
drop view if exists public.po_variation_lines_masked;
