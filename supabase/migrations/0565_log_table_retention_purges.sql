-- 0565_log_table_retention_purges.sql (#1755, Map #1533) — three log-like tables had no purge.
-- Keep periods per docs/retention.md: clickup_webhook_inbox done rows 30 days (failed rows stay for
-- diagnosis), alert_send_log 90 days, notifications read ones 180 days (unread never purged).
-- `cron.schedule` upserts by name. Rollback: rollback/0565_log_table_retention_purges_down.sql

select cron.schedule(
  'clickup-webhook-inbox-purge',
  '29 3 * * *',
  $$delete from public.clickup_webhook_inbox where status = 'done' and processed_at < now() - interval '30 days'$$
);
select cron.schedule(
  'alert-send-log-purge',
  '31 3 * * *',
  $$delete from public.alert_send_log where last_sent_at < now() - interval '90 days'$$
);
select cron.schedule(
  'notifications-purge',
  '33 3 * * *',
  $$delete from public.notifications where read_at < now() - interval '180 days'$$
);
