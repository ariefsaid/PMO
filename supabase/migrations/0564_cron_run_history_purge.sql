-- 0564_cron_run_history_purge.sql — pg_cron logs every run in cron.job_run_details and nothing deleted
-- them: 244,000 rows / 49 MB on the cloud project by 2026-11-03 (37% of the database), growing ~60,000
-- rows a month. A daily job now keeps 7 days of run history (owner, 2026-11-03). Freed space is reused
-- by later rows; the file only shrinks after a one-off VACUUM FULL.
-- `cron.schedule` upserts by name. Rollback: rollback/0564_cron_run_history_purge_down.sql

select cron.schedule(
  'cron-run-history-purge',
  '23 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
