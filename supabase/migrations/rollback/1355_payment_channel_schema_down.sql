-- Rollback of 1355_payment_channel_schema.sql (#2698). Run 1356's rollback first.
drop index if exists public.procurements_payment_channel_idx;
alter table public.procurements drop column if exists payment_channel_id;
drop table if exists public.org_payment_channels;
drop table if exists public.org_payment_channel_settings;
