-- Reverse of 0508_odoo_vendor_payment_gate.sql: drop the held-payment resolution RPC. Nothing else changed.
drop function if exists public.resolve_held_outbox_command(uuid, text, text, text);
