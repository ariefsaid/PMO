-- 1275_work_order_revenue_plan.sql — #2671: a dated revenue plan per work order (schema, settings, working-day helper).
-- Spec docs/specs/work-order-revenue-plan.spec.md (FR-WRP-001..007); plan docs/plans/2026-11-21-work-order-revenue-plan.md.
-- Proven by supabase/tests/1275_work_order_revenue_plan.test.sql.
--
-- Two tables, both organisation-scoped with RLS:
--   org_revenue_plan_settings   one row per org: the on/off switch (OFF by default; no row = off) and the working weekdays.
--   work_order_revenue_plan     one amount per work order and calendar date, in the work order's own currency.
-- Neither table is written by a client: every write goes through the security-definer RPCs in 1276. The plan never
-- changes an actual, a project total, a budget or an invoice (FR-WRP-007): nothing reads it but the plan screens.
--
-- ── REVERSE (also supabase/migrations/rollback/1275_work_order_revenue_plan_down.sql) ──────────────────
--   drop table if exists public.work_order_revenue_plan;
--   drop table if exists public.org_revenue_plan_settings;
--   drop function if exists public.org_is_working_day(uuid, date);
--   drop function if exists public.revenue_plan_enabled(uuid);
--   drop function if exists public.set_revenue_plan_settings(boolean, smallint[]);

create table public.org_revenue_plan_settings (
  org_id           uuid primary key references public.organizations(id) on delete cascade
                     default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001'),
  enabled          boolean  not null default false,
  -- ISO weekdays, 1 = Monday .. 7 = Sunday. A month amount is spread over these days (FR-WRP-003).
  working_weekdays smallint[] not null default '{1,2,3,4,5}'
                     check (cardinality(working_weekdays) between 1 and 7 and working_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  updated_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now()
);
create trigger org_revenue_plan_settings_stamp_org_id before insert on public.org_revenue_plan_settings
  for each row execute function public.stamp_org_id();

create table public.work_order_revenue_plan (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade
                  default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001'),
  project_id    uuid not null references public.projects(id),
  work_order_id uuid not null references public.work_orders(id),
  plan_date     date not null check (plan_date between date '2000-01-01' and date '2100-12-31'),
  -- FR-WRP-005: finite, non-negative, at most two decimals.
  amount        numeric not null check (amount >= 0 and amount < 1e15 and amount = round(amount, 2)),
  -- 'month' rows were spread from a month amount; an edited day becomes 'date' (FR-WRP-004).
  source        text not null default 'date' check (source in ('date', 'month')),
  month_key     date check (month_key is null or month_key = date_trunc('month', month_key)::date),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) default auth.uid(),
  updated_at    timestamptz not null default now(),
  unique (work_order_id, plan_date),
  check ((source = 'month') = (month_key is not null))
);
create index work_order_revenue_plan_project_idx on public.work_order_revenue_plan (org_id, project_id, work_order_id, plan_date);
create trigger work_order_revenue_plan_stamp_org_id before insert on public.work_order_revenue_plan
  for each row execute function public.stamp_org_id();

-- Helpers. #2672 reuses org_is_working_day and will add a non-working-dates list.
create function public.revenue_plan_enabled(p_org uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_org = public.auth_org_id()
     and coalesce((select s.enabled from public.org_revenue_plan_settings s where s.org_id = p_org), false), false)
$$;
-- A working day of the organisation: its weekday is on the working-weekdays setting (default Monday to Friday).
create function public.org_is_working_day(p_org uuid, p_date date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_date)::smallint = any (
    coalesce((select s.working_weekdays from public.org_revenue_plan_settings s where s.org_id = p_org),
             '{1,2,3,4,5}'::smallint[]))
$$;
-- revenue_plan_enabled answers only for the caller's own org and is executable by authenticated because the plan table's
-- select policy calls it.
revoke all on function public.revenue_plan_enabled(uuid) from public, anon;
grant execute on function public.revenue_plan_enabled(uuid) to authenticated;
revoke all on function public.org_is_working_day(uuid, date) from public, anon, authenticated;

-- Admin sets the switch and the working weekdays (FR-WRP-001). One row per org, upserted; the row is the org's own.
create function public.set_revenue_plan_settings(p_enabled boolean, p_weekdays smallint[]) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'WRP_ROLE: only an Admin sets the revenue plan settings' using errcode = '42501';
  end if;
  if p_enabled is null or p_weekdays is null or cardinality(p_weekdays) not between 1 and 7
     or not (p_weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
     or cardinality(p_weekdays) <> (select count(distinct x) from unnest(p_weekdays) x) then
    raise exception 'WRP_SETTINGS: choose one to seven different weekdays (1 = Monday to 7 = Sunday)' using errcode = '23514';
  end if;
  insert into public.org_revenue_plan_settings as s (org_id, enabled, working_weekdays, updated_by)
    values (v_org, p_enabled, p_weekdays, auth.uid())
    on conflict (org_id) do update set enabled = excluded.enabled, working_weekdays = excluded.working_weekdays,
      updated_by = auth.uid(), updated_at = now();
  perform public.log_audit('revenue_plan_settings.set', v_org, auth.uid(), v_org,
    jsonb_build_object('enabled', p_enabled, 'working_weekdays', to_jsonb(p_weekdays)));
end $$;
revoke all on function public.set_revenue_plan_settings(boolean, smallint[]) from public, anon;
grant execute on function public.set_revenue_plan_settings(boolean, smallint[]) to authenticated;

alter table public.org_revenue_plan_settings enable row level security;
alter table public.org_revenue_plan_settings force row level security;
alter table public.work_order_revenue_plan enable row level security;
alter table public.work_order_revenue_plan force row level security;

-- Any active member reads their own org's switch (the screens need it); nobody writes the table directly.
create policy org_revenue_plan_settings_select on public.org_revenue_plan_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- Plan rows are money: only the audience that may read the project's revenue (Admin, Finance, Executive, the project's PM),
-- and only while the organisation has switched the plan on.
create policy work_order_revenue_plan_select on public.work_order_revenue_plan for select
  using (org_id = (select public.auth_org_id())
         and (select public.revenue_plan_enabled((select public.auth_org_id())))
         and (select public.dsr_may_see_revenue(project_id)));

revoke all on public.org_revenue_plan_settings, public.work_order_revenue_plan from public, anon, authenticated;
grant select on public.org_revenue_plan_settings, public.work_order_revenue_plan to authenticated;
grant all on public.org_revenue_plan_settings, public.work_order_revenue_plan to service_role;
