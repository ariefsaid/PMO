select cron.unschedule('email-notify-tick') where exists (select 1 from cron.job where jobname = 'email-notify-tick');
drop function if exists public.email_notify_tick();
drop function if exists public.complete_email_outbox(uuid, boolean, text, boolean);
drop function if exists public.claim_email_outbox(integer, interval);
