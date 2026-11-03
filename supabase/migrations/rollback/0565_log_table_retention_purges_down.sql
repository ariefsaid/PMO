-- Rollback 0565: stop purging the three log tables.
select cron.unschedule('clickup-webhook-inbox-purge');
select cron.unschedule('alert-send-log-purge');
select cron.unschedule('notifications-purge');
