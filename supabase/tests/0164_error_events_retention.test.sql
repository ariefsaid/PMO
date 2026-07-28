-- 0164_error_events_retention.test.sql
-- AC-OBS-020 [pgTAP]: rows older than the retention window are deleted, rows inside it are untouched,
-- and the job records how many it deleted.
-- AC-OBS-021 [pgTAP]: a cron entry for the purge exists AND is enabled.
--
-- PAIRING NOTE (spec 3.3): "a schedule exists" is NOT the same as "the schedule works". 0071
-- registered a telegram-notify-tick that ran thousands of times with ZERO successes in production
-- because its GUCs were never set -- discovered only when 0083 replaced it. So AC-OBS-021 is paired
-- with an assertion that the job actually recorded a successful run into ops_job_heartbeats.
--
-- SCHEMA NOTE: ops_job_heartbeats (0167, as hardened in review) carries last_run_at (written
-- UNCONDITIONALLY at the end of every completed tick) and last_outbound_at (written only when a
-- message actually left for Telegram) -- NOT a single last_success_at. The purge job never sends
-- anything outbound, so it stamps last_run_at + last_detail only; last_run_at is the "did it run and
-- finish" signal this test needs, mirroring the split telegram-notify already uses.
--
-- ASSUMPTION AS-1: the 90-day window is owner-confirmable, not settled. It lives in ONE default
-- argument and ONE cron literal.
begin;
select plan(6);

insert into public.error_events (fn, error_code, created_at) values
  ('erpnext-sweep','OLD_1',  now() - interval '120 days'),
  ('erpnext-sweep','OLD_2',  now() - interval '91 days'),
  ('erpnext-sweep','FRESH_1',now() - interval '89 days'),
  ('erpnext-sweep','FRESH_2',now());

select is(public.purge_error_events(90), 2,
  'AC-OBS-020 the purge deletes exactly the 2 rows outside the 90-day window and RETURNS the count');

select is((select count(*)::int from public.error_events where error_code like 'OLD_%'), 0,
  'AC-OBS-020 rows older than the window are gone');
select is((select count(*)::int from public.error_events where error_code like 'FRESH_%'), 2,
  'AC-OBS-020 rows inside the window are untouched');

select is(
  (select (last_detail->>'deleted')::int from public.ops_job_heartbeats
    where job_name = 'error-events-purge'),
  2, 'AC-OBS-020 the job records how many it deleted');

select is(
  (select count(*)::int from cron.job where jobname = 'error-events-purge' and active),
  1, 'AC-OBS-021 a cron entry for the purge exists AND is enabled');

select isnt(
  (select last_run_at from public.ops_job_heartbeats where job_name = 'error-events-purge'),
  null, 'AC-OBS-021 the job has actually RUN and finished (a registered schedule is not a working one)');

select * from finish();
rollback;
