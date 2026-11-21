-- 1444_purchase_order_print_down.sql — rollback 1444_purchase_order_print.sql

revoke all on function public.po_set_print_settings(boolean, text[], text[]) from public, anon, authenticated;
drop function if exists public.po_set_print_settings(boolean, text[], text[]);

drop trigger if exists purchase_order_settings_stamp_org_id on public.purchase_order_settings;
drop table if exists public.purchase_order_settings;

drop function if exists public.check_signature_blocks_bounded(text[]);
drop function if exists public.check_collector_names_bounded(text[]);
