-- 0563_clickup_webhook_worker_every_five_minutes.sql — the ClickUp webhook worker tick moves from every
-- minute (0143) to every five minutes (owner, 2026-11-03), matching the ClickUp sweep. It cuts ~34,600
-- edge-function calls a month; ClickUp task updates land within five minutes instead of one.
-- `cron.schedule` upserts by name. Rollback: rollback/0563_clickup_webhook_worker_every_five_minutes_down.sql

select cron.schedule('clickup-webhook-worker-tick', '*/5 * * * *', 'select public.clickup_webhook_worker_tick()');
