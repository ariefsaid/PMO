drop trigger if exists external_command_outbox_zz_erpnext_payment_inflight_guard on public.external_command_outbox;
drop function if exists public.sync_erpnext_payment_inflight_bills();
drop table if exists public.erpnext_payment_inflight_bills;
