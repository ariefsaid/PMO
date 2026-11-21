-- Rollback of 1356_payment_channel_rpcs.sql (#2698).
drop function if exists public.set_procurement_payment_channel(uuid, uuid);
drop function if exists public.archive_payment_channel(uuid, boolean);
drop function if exists public.save_payment_channel(uuid, text);
drop function if exists public.set_payment_channel_settings(boolean);
drop function if exists public.payment_channel_on(uuid);
