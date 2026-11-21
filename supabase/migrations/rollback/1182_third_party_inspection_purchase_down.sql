-- 1182_third_party_inspection_purchase_down.sql — reverse 1133 (#2580). Records already attributed keep their work order.
drop trigger if exists a1_tpi_stamp_cost_attribution on public.procurement_invoices;
drop trigger if exists a1_tpi_stamp_cost_attribution on public.procurement_receipts;
drop trigger if exists a1_tpi_stamp_cost_attribution on public.purchase_orders;
drop trigger if exists a1_tpi_stamp_cost_attribution on public.purchase_requests;
drop function if exists public.tpi_stamp_cost_attribution();
drop function if exists public.tpi_raise_purchase(uuid, uuid, text);
