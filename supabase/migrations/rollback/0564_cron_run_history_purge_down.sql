-- Rollback 0564: stop purging pg_cron run history.
select cron.unschedule('cron-run-history-purge');
