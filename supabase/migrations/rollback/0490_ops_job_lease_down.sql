-- 0490_ops_job_lease_down.sql — reverses 0490.
drop function if exists public.release_ops_job_lease(text, uuid);
drop function if exists public.claim_ops_job_lease(text, uuid, interval);
alter table public.ops_job_heartbeats drop column if exists lease_holder, drop column if exists lease_until;
