alter policy receiving_blind_lines on public.procurement_items using (not (select public.order_receiving_blind()));
drop function public.order_receiving_line_blind(uuid);
