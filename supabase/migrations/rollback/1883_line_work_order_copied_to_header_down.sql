-- Reverse 1883: stop copying a line work order to the header. A header already copied keeps its value.
drop trigger if exists zz_copy_line_work_order_to_header on public.procurement_items;
drop function if exists public.copy_line_work_order_to_header();
