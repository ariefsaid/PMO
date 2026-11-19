-- 0974_document_expiry_cron.sql — #2527: daily run, 01:23 UTC (off the hour). Heartbeat: ops_job_heartbeats 'document-expiry-warnings'.
-- Reverse: rollback/0974_document_expiry_cron_down.sql
select cron.schedule('document-expiry-warnings', '23 1 * * *', 'select public.run_document_expiry_warnings()');
