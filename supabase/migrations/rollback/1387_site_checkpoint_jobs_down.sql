-- Rollback of 1387_site_checkpoint_jobs.sql.
select cron.unschedule('site-checkpoint-late');
select cron.unschedule('site-checkpoint-materialise');
drop function if exists public.remind_late_site_checkpoints(timestamptz);
drop function if exists public.materialise_site_checkpoints(timestamptz);
