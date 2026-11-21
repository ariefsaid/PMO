-- Rollback of 1388_site_checkpoint_reads.sql.
drop function if exists public.site_lost_time_by_cause(date, date, uuid, uuid);
drop function if exists public.crew_start_punctuality(date, date, uuid, uuid);
drop function if exists public.work_order_checkpoint_flag(uuid, date);
drop function if exists public.site_checkpoints_for_day(uuid, date);
drop function if exists public.site_checkpoint_state(timestamptz, smallint, timestamptz, timestamptz);
