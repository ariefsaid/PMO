-- 0918_sweep_failure_backoff.sql — a repeatedly failing hourly sweep run backs off (#1642).
--
-- A failed hourly run was deferred a fixed 5 minutes (0427 defer_erp_full_sweep), so a persistent failure
-- reran the whole hourly workload every 5 minutes. The marker now also counts consecutive failed runs:
-- the sweep reads the count with the marker and passes a doubling delay (5, 10, 20, 40 min, then the
-- hourly interval). A completed run resets the count in the same statement as its stamp.
--
-- Failure vs truncation: the sweep defers a merely truncated run with p_due_in_seconds = 0 and a failed
-- run with p_due_in_seconds > 0, so only a deferral with a delay counts as a failure.
--
-- Column + two function bodies (0358 mark, 0427 defer) with only the count lines added; signatures,
-- lock fence and service-role-only grants unchanged. Rollback: rollback/0918_sweep_failure_backoff_down.sql.
alter table public.erp_sweep_full_run add column consecutive_failures int not null default 0;

create or replace function public.mark_erp_full_sweep_done(p_org_id uuid, p_holder uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_sweep_lock
     where org_id = p_org_id and holder = p_holder and locked_until > now()
  ) then
    return false;
  end if;
  insert into public.erp_sweep_full_run (org_id, completed_at, consecutive_failures) values (p_org_id, now(), 0)
  on conflict (org_id) do update set completed_at = excluded.completed_at, consecutive_failures = 0;
  return true;
end;
$$;

create or replace function public.defer_erp_full_sweep(p_org_id uuid, p_holder uuid, p_due_in_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_sweep_lock
     where org_id = p_org_id and holder = p_holder and locked_until > now()
  ) then
    return false;
  end if;
  insert into public.erp_sweep_full_run (org_id, completed_at, consecutive_failures)
  values (p_org_id, now() - interval '55 minutes' + make_interval(secs => greatest(coalesce(p_due_in_seconds, 0), 0)),
          case when coalesce(p_due_in_seconds, 0) > 0 then 1 else 0 end)
  on conflict (org_id) do update set completed_at = excluded.completed_at,
    consecutive_failures = case when coalesce(p_due_in_seconds, 0) > 0
                                then least(public.erp_sweep_full_run.consecutive_failures + 1, 1000)
                                else public.erp_sweep_full_run.consecutive_failures end;
  return true;
end;
$$;
