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

-- Account master, reconciled only after a complete validated ERP chart scan.
create table public.erp_account_mirror (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001') references public.organizations(id) on delete cascade,
  company text not null,
  erp_name text not null,
  account_name text not null,
  root_type text not null check (root_type in ('Asset','Liability','Equity','Income','Expense')),
  report_type text not null check (report_type in ('Balance Sheet','Profit and Loss')),
  parent_account text,
  is_group boolean not null,
  account_number text,
  account_currency text not null,
  lft integer not null,
  rgt integer not null,
  account_type text,
  include_in_gross boolean not null default false,
  disabled boolean not null default false,
  erp_modified timestamptz,
  as_of timestamptz not null default now(),
  refresh_id uuid not null,
  unique (org_id, company, erp_name)
);
create index erp_account_mirror_org_company_lft_idx on public.erp_account_mirror(org_id, company, lft);
create trigger erp_account_mirror_stamp_org_id before insert or update on public.erp_account_mirror
  for each row execute function public.stamp_org_id();
alter table public.erp_account_mirror enable row level security;
alter table public.erp_account_mirror force row level security;
create policy erp_account_mirror_select on public.erp_account_mirror for select
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Finance','Executive'));
revoke all on public.erp_account_mirror from anon, authenticated;
grant select on public.erp_account_mirror to authenticated;
grant all on public.erp_account_mirror to service_role;

alter table public.external_org_bindings
  add column statement_full_ledger_replay_needed boolean not null default true,
  add column statement_update_delayed boolean not null default true,
  add column statement_last_attempt_at timestamptz,
  add column statement_calendar jsonb;

comment on table public.erp_sweep_lock is 'ponytail: TTL > the edge-function wall-clock cap, so a worker cannot outlive its lock; use fenced epochs if ticks ever exceed the cap.';
