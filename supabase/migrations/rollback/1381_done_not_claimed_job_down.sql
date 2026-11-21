-- Rollback of 1381_done_not_claimed_job.sql.
select cron.unschedule('done-not-claimed');
drop function if exists public.notify_done_not_claimed();
