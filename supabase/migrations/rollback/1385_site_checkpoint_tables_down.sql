-- Rollback of 1385_site_checkpoint_tables.sql (reverse 1388, 1387, 1386 first). Recorded checkpoint evidence is lost.
drop function if exists public.set_site_checkpoint_list(jsonb);
drop table if exists public.site_checkpoints;
drop table if exists public.site_checkpoint_templates;
drop function if exists public.site_checkpoint_may_record(uuid, uuid);
drop function if exists public.site_checkpoint_may_read(uuid, uuid);
drop function if exists public.site_checkpoint_today();
