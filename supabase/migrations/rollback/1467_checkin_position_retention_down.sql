-- Rollback of 1467: unschedule the check-in position purge.
select cron.unschedule('phone-check-in-position-purge');
