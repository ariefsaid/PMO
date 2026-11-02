-- 0490_ops_job_lease.sql — single-drainer lease for ops cron jobs (telegram-notify).
-- Overlapping ticks claim an expiring lease on the job's ops_job_heartbeats row; only one wins.
-- service_role only. Rollback: rollback/0490_ops_job_lease_down.sql

alter table public.ops_job_heartbeats
  add column lease_until  timestamptz,
  add column lease_holder uuid;

create or replace function public.claim_ops_job_lease(p_job text, p_holder uuid, p_ttl interval)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare claimed boolean;
begin
  if p_ttl <= interval '0' or p_ttl > interval '15 minutes' then
    raise exception 'invalid ops job lease ttl' using errcode = '22023';
  end if;
  with upserted as (
    insert into public.ops_job_heartbeats(job_name, last_run_at, lease_until, lease_holder)
    values (p_job, now(), now() + p_ttl, p_holder)
    on conflict (job_name) do update
      set lease_until = excluded.lease_until, lease_holder = excluded.lease_holder
      where public.ops_job_heartbeats.lease_until is null or public.ops_job_heartbeats.lease_until < now()
    returning true
  ) select coalesce((select true from upserted), false) into claimed;
  return claimed;
end;
$$;

create or replace function public.release_ops_job_lease(p_job text, p_holder uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with released as (
    update public.ops_job_heartbeats set lease_until = null, lease_holder = null
    where job_name = p_job and lease_holder = p_holder returning true
  ) select coalesce((select true from released), false);
$$;

revoke execute on function public.claim_ops_job_lease(text, uuid, interval) from public, anon, authenticated;
revoke execute on function public.release_ops_job_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_ops_job_lease(text, uuid, interval) to service_role;
grant execute on function public.release_ops_job_lease(text, uuid) to service_role;
