-- Reverse of 0508_odoo_vendor_payment_gate.sql: drop the held-payment resolution RPC and the one-in-flight-payment-per-bill index.
drop index if exists public.external_command_outbox_one_inflight_odoo_payment_per_bill;
drop function if exists public.resolve_held_outbox_command(uuid, text, text, text);
