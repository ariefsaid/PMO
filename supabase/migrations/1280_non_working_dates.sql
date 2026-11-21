-- 1280_non_working_dates.sql — #2672: the organisation's list of non-working dates (holidays, shutdowns).
-- Spec docs/specs/work-order-daily-target.spec.md (FR-WDT-001..003); plan docs/plans/2026-11-21-work-order-daily-target.md.
-- Proven by supabase/tests/1280_non_working_dates.test.sql.
--
-- The daily target is #2671's dated plan row; this migration only changes WHICH days count as working days.
-- org_is_working_day keeps #2671's signature and weekday rule exactly and adds one condition: the date is not listed.
-- An empty list (the default) changes nothing. Editing the list never moves or deletes an existing plan row (FR-WDT-002).
--
-- ── REVERSE (also supabase/migrations/rollback/1280_non_working_dates_down.sql) ───────────────────────
--   restore org_is_working_day to the 1275 body, then drop the two RPCs and the table.

create table public.org_non_working_dates (
  org_id     uuid not null references public.organizations(id) on delete cascade
               default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001'),
  work_date  date not null check (work_date between date '2000-01-01' and date '2100-12-31'),
  label      text check (label is null or char_length(label) <= 80),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (org_id, work_date)
);
create trigger org_non_working_dates_stamp_org_id before insert on public.org_non_working_dates
  for each row execute function public.stamp_org_id();

alter table public.org_non_working_dates enable row level security;
alter table public.org_non_working_dates force row level security;
-- Any active member reads their own org's list while the plan is on (the day view marks the dates); nobody writes directly.
create policy org_non_working_dates_select on public.org_non_working_dates for select
  using (org_id = (select public.auth_org_id())
         and (select public.is_active_member())
         and (select public.revenue_plan_enabled((select public.auth_org_id()))));
revoke all on public.org_non_working_dates from public, anon, authenticated;
grant select on public.org_non_working_dates to authenticated;

-- Same signature, same weekday logic as 1275; only the "not a listed date" condition is added.
create or replace function public.org_is_working_day(p_org uuid, p_date date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_date)::smallint = any (
    coalesce((select s.working_weekdays from public.org_revenue_plan_settings s where s.org_id = p_org),
             '{1,2,3,4,5}'::smallint[]))
     and not exists (select 1 from public.org_non_working_dates n where n.org_id = p_org and n.work_date = p_date)
$$;
revoke all on function public.org_is_working_day(uuid, date) from public, anon, authenticated;

create function public.non_working_date_add(p_date date, p_label text default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_label text := nullif(btrim(p_label), '');
begin
  if not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'WDT_ROLE: only an Admin edits the non-working dates' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(v_org) then
    raise exception 'WDT_OFF: the revenue plan is not switched on for this organisation' using errcode = '55000';
  end if;
  if p_date is null or p_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'WDT_DATE: enter a real date' using errcode = '23514';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'WDT_LABEL: a label is at most 80 characters' using errcode = '23514';
  end if;
  insert into public.org_non_working_dates (org_id, work_date, label, created_by) values (v_org, p_date, v_label, auth.uid())
    on conflict (org_id, work_date) do nothing;
  if found then
    perform public.log_audit('non_working_date.add', v_org, auth.uid(), v_org, jsonb_build_object('date', p_date, 'label', v_label));
  end if;
end $$;

create function public.non_working_date_remove(p_date date) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  if not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'WDT_ROLE: only an Admin edits the non-working dates' using errcode = '42501';
  end if;
  if not public.revenue_plan_enabled(v_org) then
    raise exception 'WDT_OFF: the revenue plan is not switched on for this organisation' using errcode = '55000';
  end if;
  delete from public.org_non_working_dates where org_id = v_org and work_date = p_date;
  if found then
    perform public.log_audit('non_working_date.remove', v_org, auth.uid(), v_org, jsonb_build_object('date', p_date));
  end if;
end $$;

revoke all on function public.non_working_date_add(date, text) from public, anon;
revoke all on function public.non_working_date_remove(date) from public, anon;
grant execute on function public.non_working_date_add(date, text) to authenticated;
grant execute on function public.non_working_date_remove(date) to authenticated;
