-- Rollback 0563: restore the every-minute ClickUp webhook worker tick (0143).
select cron.schedule('clickup-webhook-worker-tick', '* * * * *', 'select public.clickup_webhook_worker_tick()');
