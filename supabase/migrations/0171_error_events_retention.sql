-- 0171_error_events_retention.sql — FR-OBS-020/021, AC-OBS-020/021.
-- error_events has had NO retention since 0071; it grows unbounded.
--
-- ASSUMPTION AS-1 (owner-confirmable, spec §8 Q3): the window is 90 days, chosen to outlive a
-- quarterly audit cycle while bounding table growth. It appears exactly twice below -- the function
-- default and the cron literal -- so changing it is a one-line migration.
--
-- The function stamps ops_job_heartbeats (0167) on every run so "the schedule exists" (AC-OBS-021)
-- is paired with proof the schedule actually WORKS -- the 0071 cron lesson: telegram-notify-tick was
-- registered and ran thousands of times in production with ZERO successes because its GUCs were
-- never set, discovered only when 0083 replaced it.
--
-- SCHEMA NOTE: ops_job_heartbeats carries last_run_at (written UNCONDITIONALLY at the end of every
-- completed run) and last_outbound_at (written only when a message actually left for Telegram, per
-- the 2026-07-28 review split — I4). The purge never sends anything outbound, so it stamps
-- last_run_at + last_detail only, leaving last_outbound_at untouched (NULL for this job, which is
-- correct — it has nothing to report there).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   select cron.unschedule('error-events-purge');
--   drop function if exists public.purge_error_events(integer);

create or replace function public.purge_error_events(p_retention_days integer default 90)
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention window must be at least 1 day' using errcode = '22023';
  end if;

  delete from public.error_events
   where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;

  insert into public.ops_job_heartbeats (job_name, last_run_at, last_detail)
  values ('error-events-purge', now(),
          jsonb_build_object('deleted', v_deleted, 'retention_days', p_retention_days))
  on conflict (job_name) do update
    set last_run_at = excluded.last_run_at,
        last_detail = excluded.last_detail;

  return v_deleted;
end $$;

comment on function public.purge_error_events(integer) is
  'Deletes error_events rows older than the retention window (default 90 days, ASSUMPTION AS-1) and '
  'stamps ops_job_heartbeats.last_run_at + last_detail with the deleted count. FR-OBS-020/021.';

revoke all on function public.purge_error_events(integer) from public;

-- 03:17 UTC daily — off the hour so it never contends with the telegram-notify tick (every 2 min).
select cron.schedule('error-events-purge', '17 3 * * *', 'select public.purge_error_events(90)');
