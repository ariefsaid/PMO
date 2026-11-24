-- Apply 2226 through 2221 rollback first. Refuse removal when receipt history exists; export history before any deliberate dismantling.
do $$ begin
  if exists(select 1 from public.order_receiving_requests) then raise exception 'Retain order receipt history before removing receiving.'; end if;
end $$;
drop trigger order_receipt_immutable on public.procurement_receipts;
drop trigger order_receipt_lines_immutable on public.procurement_receipt_lines;
drop function public.guard_order_receipt_immutable();
drop policy receiving_blind_lines on public.procurement_items;
drop policy receiving_blind_po_lines on public.purchase_order_lines;
drop function public.order_receiving_blind();
drop function public.list_receiving_orders();
drop function public.set_order_receiving_enabled(boolean);
drop function public.get_order_receiving_enabled();
drop function public.read_order_receiving(uuid);
drop function public.approve_order_receiving(uuid,text);
drop function public.receive_order_goods(uuid,uuid,date,jsonb,uuid);
drop function public.receiving_lock_order(uuid);
drop function public.map_order_stock(uuid,uuid);
drop function public.order_receiving_purchaser();
drop table public.order_receiving_reversals;
drop table public.order_receiving_requests;
drop table public.order_stock_mappings;
drop table public.order_receiving_settings;
drop function public.guard_order_receiving_setting();
