-- 1710_headcount_days.sql — a daily head count for people with no name on the roster (docs/specs/guard-headcount.spec.md,
-- FR-HC-001..004, FR-HC-006). Plan: docs/plans/2026-11-22-guard-headcount.md (T2).
--   headcount_days: for one work order, one crew rostered on it that day, one date and one labour class, how many
--   unnamed people were present. Written by three actions only (record, approve, clear); read by the roles that read
--   attendance. A line costs money only once a different Admin, Executive or Project Manager approves it (1722 reads it).
-- Entry authority is exactly attendance_can_record(crew) (1036) and never a field account.
-- Reverse: supabase/migrations/rollback/1710_headcount_days_down.sql (drops the table: data loss, stated there).
-- Proven by supabase/tests/1710_headcount_days.test.sql.

create table public.headcount_days (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                    references public.organizations(id) on delete cascade,
  work_order_id   uuid not null references public.work_orders(id),
  crew_id         uuid not null references public.crews(id),
  class_id        uuid not null references public.labour_cost_classes(id),
  work_date       date not null,
  head_count      integer not null constraint headcount_days_count check (head_count between 1 and 500),
  -- Everyone who ever entered or changed the line: the SoD oracle (as attendance_days.recorded_by_ids).
  recorded_by_ids uuid[] not null default '{}',
  recorded_at     timestamptz not null default now(),
  approved_by     uuid constraint headcount_days_approved_by_fkey references public.profiles(id),
  approved_at     timestamptz,
  constraint headcount_days_one_per_class unique (work_order_id, crew_id, work_date, class_id),
  constraint headcount_days_approval_pair check ((approved_by is null) = (approved_at is null))
);
create index headcount_days_wo_date_idx on public.headcount_days (work_order_id, work_date);
create trigger headcount_days_stamp_org_id before insert on public.headcount_days
  for each row execute function public.stamp_org_id();

alter table public.headcount_days enable row level security;
alter table public.headcount_days force row level security;
create policy headcount_days_select on public.headcount_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.crews c
                          where c.id = headcount_days.crew_id and c.field_controller_id = (select auth.uid()))));
-- Field accounts read none of it (the light-account boundary, 2711 (b)).
create policy light_account_deny_select on public.headcount_days as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.headcount_days from public, anon, authenticated;
grant select on public.headcount_days to authenticated;
grant all on public.headcount_days to service_role;

create function public.record_headcount_day(p_work_order_id uuid, p_crew_id uuid, p_work_date date, p_class_id uuid, p_count integer)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_earliest date;
  v_today date;
  v_cur public.headcount_days;
  v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org)
     or not exists (select 1 from public.crews c where c.id = p_crew_id and c.org_id = v_org) then
    raise exception 'work order or crew not found' using errcode = 'P0002';   -- another organisation's id reads as absent
  end if;
  if not public.attendance_can_record(p_crew_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 500 then
    raise exception 'HC_COUNT: a head count is a whole number from 1 to 500' using errcode = '22023';
  end if;
  if not exists (select 1 from public.labour_cost_classes k where k.id = p_class_id and k.org_id = v_org and k.archived_at is null) then
    raise exception 'HC_CLASS: choose a labour class that is not archived' using errcode = '22023';
  end if;
  select o.attendance_backdate_days into v_backdate from public.organizations o where o.id = v_org;
  v_today := public.equipment_org_today(v_org);
  v_earliest := v_today - v_backdate;
  if p_work_date is null or p_work_date > v_today then
    raise exception 'HC_DATE_FUTURE: a head count cannot be recorded for a future date' using errcode = '23514';
  end if;
  if p_work_date < v_earliest then
    raise exception 'HC_DATE_OLD: the earliest date open for a head count is %', to_char(v_earliest, 'YYYY-MM-DD') using errcode = '23514';
  end if;
  if not exists (select 1 from public.work_order_crews r
                  where r.work_order_id = p_work_order_id and r.crew_id = p_crew_id and r.org_id = v_org
                    and p_work_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)) then
    raise exception 'HC_CREW_NOT_ROSTERED: that crew is not on this work order on that date' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hc:' || p_work_order_id::text || p_crew_id::text || p_work_date::text || p_class_id::text, 0));
  select * into v_cur from public.headcount_days h
   where h.work_order_id = p_work_order_id and h.crew_id = p_crew_id and h.work_date = p_work_date and h.class_id = p_class_id;
  if found and v_cur.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  if found then
    update public.headcount_days h
       set head_count = p_count, recorded_at = now(),
           recorded_by_ids = case when v_uid = any(h.recorded_by_ids) then h.recorded_by_ids else h.recorded_by_ids || v_uid end
     where h.id = v_cur.id returning h.id into v_id;
  else
    insert into public.headcount_days (org_id, work_order_id, crew_id, class_id, work_date, head_count, recorded_by_ids)
    values (v_org, p_work_order_id, p_crew_id, p_class_id, p_work_date, p_count, array[v_uid])
    returning id into v_id;
  end if;
  perform public.log_audit('headcount_day.record', v_org, v_uid, v_id,
            jsonb_build_object('work_order_id', p_work_order_id, 'crew_id', p_crew_id, 'class_id', p_class_id,
                               'work_date', p_work_date, 'head_count', p_count));
  return v_id;
end $$;
revoke all on function public.record_headcount_day(uuid, uuid, date, uuid, integer) from public, anon;
grant execute on function public.record_headcount_day(uuid, uuid, date, uuid, integer) to authenticated;

create function public.approve_headcount_day(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_h public.headcount_days;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_h from public.headcount_days h where h.id = p_id and h.org_id = v_org;
  if not found then
    raise exception 'head count not found' using errcode = 'P0002';
  end if;
  -- SECURITY (SoD) FIRST, ALWAYS: whoever entered or changed the line never approves it, whatever their role.
  if v_uid = any(v_h.recorded_by_ids) then
    raise exception 'separation of duties: the person who entered a head count cannot approve it' using errcode = '42501';
  end if;
  if not public.crew_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_h.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  update public.headcount_days h set approved_by = v_uid, approved_at = now() where h.id = p_id;
  perform public.log_audit('headcount_day.approve', v_org, v_uid, p_id,
            jsonb_build_object('work_order_id', v_h.work_order_id, 'work_date', v_h.work_date, 'head_count', v_h.head_count));
end $$;
revoke all on function public.approve_headcount_day(uuid) from public, anon;
grant execute on function public.approve_headcount_day(uuid) to authenticated;

create function public.clear_headcount_day(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_h public.headcount_days;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_h from public.headcount_days h where h.id = p_id and h.org_id = v_org;
  if not found then
    raise exception 'head count not found' using errcode = 'P0002';
  end if;
  if not public.attendance_can_record(v_h.crew_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_h.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  delete from public.headcount_days h where h.id = p_id;
  perform public.log_audit('headcount_day.clear', v_org, v_uid, p_id,
            jsonb_build_object('work_order_id', v_h.work_order_id, 'work_date', v_h.work_date, 'head_count', v_h.head_count));
end $$;
revoke all on function public.clear_headcount_day(uuid) from public, anon;
grant execute on function public.clear_headcount_day(uuid) to authenticated;
