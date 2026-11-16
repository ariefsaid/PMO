-- 0918_sweep_failure_backoff_down.sql — reverse of 0918: restores the 0358 and 0427 function bodies and
-- drops the failure count (the sweep returns to a fixed five-minute retry).
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
  insert into public.erp_sweep_full_run (org_id, completed_at) values (p_org_id, now())
  on conflict (org_id) do update set completed_at = excluded.completed_at;
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
  insert into public.erp_sweep_full_run (org_id, completed_at)
  values (p_org_id, now() - interval '55 minutes' + make_interval(secs => greatest(coalesce(p_due_in_seconds, 0), 0)))
  on conflict (org_id) do update set completed_at = excluded.completed_at;
  return true;
end;
$$;

alter table public.erp_sweep_full_run drop column if exists consecutive_failures;
