-- 0294 — statement source lock and account master/replay state.
-- Rollback: rollback/0294_statement_account_source_down.sql

create table public.erp_sweep_lock (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  locked_until timestamptz not null,
  holder uuid not null
);

alter table public.erp_sweep_lock enable row level security;
alter table public.erp_sweep_lock force row level security;
revoke all on public.erp_sweep_lock from anon, authenticated;
grant all on public.erp_sweep_lock to service_role;

create or replace function public.claim_erp_sweep_lock(p_org_id uuid, p_holder uuid, p_ttl interval)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare claimed boolean;
begin
  if p_ttl <> interval '15 minutes' then
    raise exception 'invalid sweep lock ttl' using errcode = '22023';
  end if;
  with upserted as (
    insert into public.erp_sweep_lock(org_id, locked_until, holder)
    values (p_org_id, now() + p_ttl, p_holder)
    on conflict (org_id) do update
      set locked_until = excluded.locked_until, holder = excluded.holder
      where public.erp_sweep_lock.locked_until < now()
    returning true
  ) select coalesce((select true from upserted), false) into claimed;
  return claimed;
end;
$$;

create or replace function public.release_erp_sweep_lock(p_org_id uuid, p_holder uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.erp_sweep_lock where org_id = p_org_id and holder = p_holder returning true
  ) select coalesce((select true from deleted), false);
$$;

revoke execute on function public.claim_erp_sweep_lock(uuid, uuid, interval) from public, anon, authenticated;
revoke execute on function public.release_erp_sweep_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_erp_sweep_lock(uuid, uuid, interval) to service_role;
grant execute on function public.release_erp_sweep_lock(uuid, uuid) to service_role;

comment on table public.erp_sweep_lock is 'ponytail: TTL > the edge-function wall-clock cap, so a worker cannot outlive its lock; use fenced epochs if ticks ever exceed the cap.';

