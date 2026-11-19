-- 0989_attendance_days.sql — #2528: one daily attendance record per person, day and work order, whatever the
-- capture method. Spec: docs/specs/crews-roster-attendance.spec.md (FR-CRW-008..013, FR-CRW-017, OD-CRW-3..5).
-- Plan: Slice 2. Proven by supabase/tests/attendance_days.test.sql.
--
-- Method seam (OQ-CRW-1 / #2535 is open): every method writes the same row through `attendance_record`, told apart only
-- by `source`. This migration builds the crew-roster tick (`roster_tick`) and an office correction
-- (`manual_correction`); `phone_check_in` is accepted from the person's own login so #1517 can write here later. No
-- location data is stored (NFR-CRW-003).
--
-- ── REVERSE (also supabase/migrations/rollback/0989_attendance_days_down.sql) ──────────────────────────────────
--   reverse 0990 first; drop function attendance_record, attendance_can_record, worker_off_rotation; the storage
--   policies and (once empty) the bucket; tables attendance_photos, attendance_days, crew_worker_rotation_off; the
--   guard function; the two organizations columns; restore the 0988 work_order_roster.

-- ── §1 organisation settings (OD-CRW-5, OQ-CRW-2) ────────────────────────────────────────────────────────────
alter table public.organizations
  add column attendance_backdate_days integer not null default 7 check (attendance_backdate_days between 0 and 60),
  add column attendance_conflict_tolerance_hours numeric(4,2) not null default 1
    check (attendance_conflict_tolerance_hours between 0 and 24);

-- ── §2 rotation seam (FR-CRW-010) ────────────────────────────────────────────────────────────────────────────
-- Off-rotation days per person. #1516's rotation is not shipped; when it is, `worker_off_rotation` reads it instead and
-- this table goes. Nothing else reads the table directly.
create table public.crew_worker_rotation_off (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
              references public.organizations(id) on delete cascade,
  worker_id uuid not null references public.crew_workers(id) on delete cascade,
  off_from  date not null,
  off_to    date not null,
  constraint crew_worker_rotation_off_range check (off_to >= off_from)
);
create index crew_worker_rotation_off_worker_idx on public.crew_worker_rotation_off (worker_id, off_from, off_to);
create trigger crew_worker_rotation_off_stamp_org_id before insert on public.crew_worker_rotation_off
  for each row execute function public.stamp_org_id();
alter table public.crew_worker_rotation_off enable row level security;
alter table public.crew_worker_rotation_off force row level security;
create policy crew_worker_rotation_off_select on public.crew_worker_rotation_off for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy crew_worker_rotation_off_insert on public.crew_worker_rotation_off for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage())
              and exists (select 1 from public.crew_workers w where w.id = worker_id and w.org_id = (select public.auth_org_id())));
create policy crew_worker_rotation_off_update on public.crew_worker_rotation_off for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy crew_worker_rotation_off_delete on public.crew_worker_rotation_off for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.crew_can_manage()));
revoke all on public.crew_worker_rotation_off from public, anon, authenticated;
grant select, delete on public.crew_worker_rotation_off to authenticated;
grant insert (worker_id, off_from, off_to) on public.crew_worker_rotation_off to authenticated;
grant update (off_from, off_to) on public.crew_worker_rotation_off to authenticated;
grant all on public.crew_worker_rotation_off to service_role;

create function public.worker_off_rotation(p_worker_id uuid, p_date date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crew_worker_rotation_off o
                  where o.worker_id = p_worker_id and p_date between o.off_from and o.off_to)
$$;
revoke all on function public.worker_off_rotation(uuid, date) from public, anon, authenticated;

-- ── §7 the roster read names who is off rotation that day (FR-CRW-010), so the tick screen defaults them ──────────
create or replace function public.work_order_roster(p_work_order_id uuid, p_date date)
  returns table (crew_id uuid, crew_code text, crew_name text, field_controller_id uuid,
                 members jsonb, roles jsonb, shortfall integer)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with rostered as (
    select c.id, c.code, c.name, c.field_controller_id
      from public.work_order_crews r join public.crews c on c.id = r.crew_id
     where r.work_order_id = p_work_order_id
       and p_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
  ), placed as (
    select m.crew_id, m.worker_id, w.display_name, w.kind, w.profile_id, m.standard_role_id
      from public.crew_members m join public.crew_workers w on w.id = m.worker_id
     where m.crew_id in (select id from rostered)
       and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
  ), role_counts as (
    select s.crew_id, s.id, s.name, s.headcount, s.sort_order,
           (select count(*)::int from placed p where p.crew_id = s.crew_id and p.standard_role_id = s.id) as placed
      from public.crew_standard_roles s where s.crew_id in (select id from rostered)
  )
  select r.id, r.code, r.name, r.field_controller_id,
         coalesce((select jsonb_agg(jsonb_build_object('worker_id', p.worker_id, 'display_name', p.display_name,
                                                       'kind', p.kind, 'has_login', p.profile_id is not null,
                                                       'standard_role_id', p.standard_role_id,
                                                       'off_rotation', exists (
                                                         select 1 from public.crew_worker_rotation_off o
                                                          where o.worker_id = p.worker_id and p_date between o.off_from and o.off_to))
                                    order by p.display_name, p.worker_id)
                     from placed p where p.crew_id = r.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('standard_role_id', rc.id, 'name', rc.name,
                                                       'headcount', rc.headcount, 'placed', rc.placed,
                                                       'shortfall', greatest(rc.headcount - rc.placed, 0))
                                    order by rc.sort_order, rc.name)
                     from role_counts rc where rc.crew_id = r.id), '[]'::jsonb),
         coalesce((select sum(greatest(rc.headcount - rc.placed, 0))::int from role_counts rc where rc.crew_id = r.id), 0)
    from rostered r
   order by r.code, r.id
$$;

-- ── §3 the attendance record (FR-CRW-008, FR-CRW-011) ────────────────────────────────────────────────────────
create table public.attendance_days (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  worker_id          uuid not null references public.crew_workers(id),
  work_order_id      uuid not null references public.work_orders(id),
  -- Derived from the work order by the guard; the timesheet line needs it.
  project_id         uuid not null references public.projects(id),
  -- The crew the person was in when recorded (who may record and read it).
  crew_id            uuid references public.crews(id),
  work_date          date not null,
  status             text not null check (status in ('present', 'absent', 'leave', 'off_rotation')),
  hours              numeric(5,2) check (hours between 0 and 24),
  overtime_hours     numeric(5,2) check (overtime_hours between 0 and 24),
  reason             text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  source             text not null check (source in ('phone_check_in', 'roster_tick', 'manual_correction')),
  -- Each method's own hours, kept side by side so a reviewer sees both (FR-CRW-011).
  tick_hours         numeric(5,2),
  phone_hours        numeric(5,2),
  needs_review       boolean not null default false,
  recorded_by        uuid references public.profiles(id),
  -- Everyone who ever recorded this row: the SoD oracle. `recorded_by` is only the last writer.
  recorded_by_ids    uuid[] not null default '{}',
  recorded_at        timestamptz not null default now(),
  -- Week sent for approval (people with no login, FR-CRW-016); a login's week is tracked by its timesheet.
  submitted_at       timestamptz,
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  locked_at          timestamptz,
  version            integer not null default 1,
  constraint attendance_days_one_per_day unique (worker_id, work_order_id, work_date),
  constraint attendance_days_hours_when_present check (
    (status = 'present' and hours is not null) or (status <> 'present' and hours is null and overtime_hours is null))
);
create index attendance_days_worker_date_idx on public.attendance_days (worker_id, work_date);
create index attendance_days_wo_date_idx on public.attendance_days (work_order_id, work_date);
create index attendance_days_crew_date_idx on public.attendance_days (crew_id, work_date);
create trigger attendance_days_stamp_org_id before insert on public.attendance_days
  for each row execute function public.stamp_org_id();

-- The lock, the 24-hour day and the derived columns hold for EVERY writer, the RPC and the table owner alike.
create function public.guard_attendance_day() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lock_cols text[] := array['locked_at', 'approved_by', 'approved_at', 'timesheet_entry_id'];
  v_other numeric;
  v_other_wo text;
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path'
        using errcode = '55000';
    end if;
    return old;
  end if;
  -- AC-CRW-011 / FR-CRW-017: locked attendance is immutable. The one exception is the approval trigger re-opening it
  -- (a nested trigger changing nothing but the lock columns), which is the correction path.
  if tg_op = 'UPDATE' and old.locked_at is not null then
    if not (pg_trigger_depth() > 1 and new.locked_at is null
            and (to_jsonb(new) - v_lock_cols) = (to_jsonb(old) - v_lock_cols)) then
      raise exception 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path'
        using errcode = '55000';
    end if;
    return new;
  end if;

  select w.project_id into new.project_id from public.work_orders w
   where w.id = new.work_order_id and w.org_id = new.org_id;
  if new.project_id is null then
    raise exception 'ATT_REF: the work order is not in this organisation' using errcode = '23514';
  end if;
  if not exists (select 1 from public.crew_workers w where w.id = new.worker_id and w.org_id = new.org_id) then
    raise exception 'ATT_REF: the person is not in this organisation' using errcode = '23514';
  end if;

  -- AC-CRW-007 / FR-CRW-012: at most 24 hours a day per person across work orders. Serialised per person-day.
  if new.status = 'present' then
    perform pg_advisory_xact_lock(hashtextextended('att-day:' || new.worker_id::text || ':' || new.work_date::text, 0));
    select coalesce(sum(a.hours + coalesce(a.overtime_hours, 0)), 0),
           string_agg(coalesce(w.wo_number, w.title), ', ' order by w.title)
      into v_other, v_other_wo
      from public.attendance_days a join public.work_orders w on w.id = a.work_order_id
     where a.worker_id = new.worker_id and a.work_date = new.work_date and a.status = 'present' and a.id <> new.id;
    if v_other + new.hours + coalesce(new.overtime_hours, 0) > 24 then
      raise exception 'ATT_DAY_CEILING: this person already has % hours on % that day; a day holds at most 24',
        v_other, v_other_wo using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
revoke all on function public.guard_attendance_day() from public, anon, authenticated;
create trigger zz_attendance_days_guard before insert or update or delete on public.attendance_days
  for each row execute function public.guard_attendance_day();

-- The timesheet line generated from this record (0990 writes it). Here so the lock guard can name it.
alter table public.attendance_days
  add column timesheet_entry_id uuid unique references public.timesheet_entries(id) on delete set null;

alter table public.attendance_days enable row level security;
alter table public.attendance_days force row level security;
-- Read: the office roles, the field controller of the person's crew, and the person themself (FR-CRW-019).
create policy attendance_days_select on public.attendance_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.crews c where c.id = attendance_days.crew_id and c.field_controller_id = (select auth.uid()))
              or exists (select 1 from public.crew_workers w where w.id = attendance_days.worker_id and w.profile_id = (select auth.uid()))));
-- Writes only through the security-definer RPCs below and in 0990.
revoke all on public.attendance_days from public, anon, authenticated;
grant select on public.attendance_days to authenticated;
grant all on public.attendance_days to service_role;

-- ── §4 who may record (FR-CRW-019) ───────────────────────────────────────────────────────────────────────────
-- A crew manager, or the field controller of the crew rostered on that work order that day.
create function public.attendance_can_record(p_crew_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.crew_can_manage()
      or (public.is_active_member()
          and exists (select 1 from public.crews c
                       where c.id = p_crew_id and c.org_id = public.auth_org_id() and c.field_controller_id = auth.uid()))
$$;
revoke all on function public.attendance_can_record(uuid) from public, anon;
grant execute on function public.attendance_can_record(uuid) to authenticated;

-- ── §5 group photo (FR-CRW-009, OD-CRW-4) ────────────────────────────────────────────────────────────────────
create table public.attendance_photos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id),
  crew_id       uuid not null references public.crews(id),
  work_date     date not null,
  file_path     text not null,
  uploaded_by   uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index attendance_photos_wo_date_idx on public.attendance_photos (work_order_id, work_date);
create trigger attendance_photos_stamp_org_id before insert on public.attendance_photos
  for each row execute function public.stamp_org_id();
alter table public.attendance_photos enable row level security;
alter table public.attendance_photos force row level security;
create policy attendance_photos_select on public.attendance_photos for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
              or exists (select 1 from public.crews c where c.id = attendance_photos.crew_id and c.field_controller_id = (select auth.uid()))));
create policy attendance_photos_insert on public.attendance_photos for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.attendance_can_record(crew_id)
              and exists (select 1 from public.work_order_crews r
                           where r.crew_id = attendance_photos.crew_id and r.work_order_id = attendance_photos.work_order_id
                             and attendance_photos.work_date between r.valid_from and coalesce(r.valid_to, 'infinity'::date)));
create policy attendance_photos_update on public.attendance_photos for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.attendance_can_record(crew_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.attendance_photos from public, anon, authenticated;
grant select on public.attendance_photos to authenticated;
grant insert (id, work_order_id, crew_id, work_date, file_path) on public.attendance_photos to authenticated;
grant update (archived_at) on public.attendance_photos to authenticated;
grant all on public.attendance_photos to service_role;

-- Private bucket at {org}/{work_order}/{photo}/{filename}; read and write follow the photo row's own policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attendance-photos', 'attendance-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;
create policy storage_objects_attendance_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.attendance_photos p where p.id::text = split_part(name, '/', 3)));
create policy storage_objects_attendance_photo_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.work_order_crews r join public.crews c on c.id = r.crew_id
                      where r.work_order_id::text = split_part(name, '/', 2) and c.org_id = (select public.auth_org_id())
                        and public.attendance_can_record(c.id)));

-- ── §6 recording (FR-CRW-008..013, AC-CRW-005..008, 013) ─────────────────────────────────────────────────────
-- p_rows: [{worker_id, status, hours?, overtime_hours?, reason?}] — one per person, all on one work order and date.
-- Returns the number of records written.
create function public.attendance_record(p_work_order_id uuid, p_work_date date, p_source text, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_backdate int;
  v_tolerance numeric;
  v_earliest date;
  r record;
  v_crew uuid;
  v_profile uuid;
  v_status text;
  v_hours numeric;
  v_ot numeric;
  v_reason text;
  v_cur public.attendance_days;
  v_tick numeric;
  v_phone numeric;
  v_n int := 0;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('phone_check_in', 'roster_tick', 'manual_correction') then
    raise exception 'ATT_SOURCE: unknown attendance source' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'ATT_ROWS: name between 1 and 200 people' using errcode = '22023';
  end if;
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'work order not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  -- AC-CRW-013 / FR-CRW-013: not in the future, not before the organisation's back-date limit.
  select o.attendance_backdate_days, o.attendance_conflict_tolerance_hours into v_backdate, v_tolerance
    from public.organizations o where o.id = v_org;
  v_earliest := current_date - v_backdate;
  if p_work_date is null or p_work_date > current_date then
    raise exception 'ATT_DATE_FUTURE: attendance cannot be recorded for a future date' using errcode = '23514';
  end if;
  if p_work_date < v_earliest then
    raise exception 'ATT_DATE_WINDOW: the earliest date open for attendance is %', to_char(v_earliest, 'YYYY-MM-DD')
      using errcode = '23514';
  end if;

  for r in select * from jsonb_to_recordset(p_rows)
             as x(worker_id uuid, status text, hours numeric, overtime_hours numeric, reason text) loop
    -- OD-CRW-3: the person must be in a crew rostered on this work order that day.
    select m.crew_id, w.profile_id into v_crew, v_profile
      from public.crew_members m
      join public.crew_workers w on w.id = m.worker_id
      join public.work_order_crews ro on ro.crew_id = m.crew_id and ro.work_order_id = p_work_order_id
     where m.worker_id = r.worker_id and w.org_id = v_org
       and p_work_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
       and p_work_date between ro.valid_from and coalesce(ro.valid_to, 'infinity'::date);
    if v_crew is null then
      raise exception 'ATT_NOT_ROSTERED: this person is not in a crew rostered on this work order that day'
        using errcode = '23514';
    end if;
    -- Authority: a phone check-in is the person's own; the other methods are the crew's recorder's.
    if p_source = 'phone_check_in' then
      if v_profile is distinct from v_uid then
        raise exception 'not authorized' using errcode = '42501';
      end if;
    elsif not public.attendance_can_record(v_crew) then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    v_status := r.status;
    v_reason := nullif(btrim(r.reason), '');
    if v_status is null or v_status not in ('present', 'absent', 'leave', 'off_rotation') then
      raise exception 'ATT_STATUS: unknown attendance status' using errcode = '22023';
    end if;
    -- AC-CRW-006 / FR-CRW-010: a person off rotation is present only with a reason.
    if v_status = 'present' and v_reason is null and public.worker_off_rotation(r.worker_id, p_work_date) then
      raise exception 'ATT_OFF_ROTATION: this person is off rotation that day; give a reason to mark them present'
        using errcode = '23514';
    end if;
    if v_status = 'present' then
      if r.hours is null then
        raise exception 'ATT_HOURS: a present person needs hours' using errcode = '22023';
      end if;
      v_hours := r.hours; v_ot := r.overtime_hours;
    else
      v_hours := null; v_ot := null;
    end if;

    select * into v_cur from public.attendance_days a
     where a.worker_id = r.worker_id and a.work_order_id = p_work_order_id and a.work_date = p_work_date
     for update;
    if v_cur.id is null then
      insert into public.attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status,
                                          hours, overtime_hours, reason, source, tick_hours, phone_hours,
                                          recorded_by, recorded_by_ids)
      values (v_org, r.worker_id, p_work_order_id, (select project_id from public.work_orders where id = p_work_order_id),
              v_crew, p_work_date, v_status, v_hours, v_ot, v_reason, p_source,
              case when p_source = 'roster_tick' then coalesce(v_hours, 0) end,
              case when p_source = 'phone_check_in' then coalesce(v_hours, 0) end,
              v_uid, array[v_uid]);
    else
      if v_cur.locked_at is not null then
        raise exception 'ATT_LOCKED: approved attendance cannot be changed; correct it through the timesheet correction path'
          using errcode = '55000';
      end if;
      -- FR-CRW-017: once the week is submitted, change goes through the correction path, never a silent edit.
      if v_cur.submitted_at is not null or exists (
           select 1 from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
            where e.id = v_cur.timesheet_entry_id and t.status <> 'Draft') then
        raise exception 'ATT_SUBMITTED: this week is submitted; return it through the timesheet correction path to change it'
          using errcode = '55000';
      end if;
      if p_source = 'manual_correction' or p_source = v_cur.source
         or (v_cur.source = 'manual_correction') then
        -- Same method again, or an office correction: the new values stand and any conflict is settled.
        v_tick := case when p_source = 'roster_tick' then coalesce(v_hours, 0) else v_cur.tick_hours end;
        v_phone := case when p_source = 'phone_check_in' then coalesce(v_hours, 0) else v_cur.phone_hours end;
        update public.attendance_days
           set status = v_status, hours = v_hours, overtime_hours = v_ot, reason = v_reason, source = p_source,
               crew_id = v_crew, tick_hours = v_tick, phone_hours = v_phone,
               needs_review = case when p_source = 'manual_correction' then false
                                   else v_tick is not null and v_phone is not null and abs(v_tick - v_phone) > v_tolerance end,
               recorded_by = v_uid, recorded_at = now(),
               recorded_by_ids = case when v_uid = any(recorded_by_ids) then recorded_by_ids else recorded_by_ids || v_uid end
         where id = v_cur.id;
      else
        -- AC-CRW-008 / OQ-CRW-2: the other method on the same day. Neither wins: keep one record, keep both hours,
        -- and flag it when they differ by more than the organisation's tolerance.
        v_tick := case when p_source = 'roster_tick' then coalesce(v_hours, 0) else v_cur.tick_hours end;
        v_phone := case when p_source = 'phone_check_in' then coalesce(v_hours, 0) else v_cur.phone_hours end;
        update public.attendance_days
           set tick_hours = v_tick, phone_hours = v_phone,
               needs_review = v_tick is not null and v_phone is not null and abs(v_tick - v_phone) > v_tolerance,
               recorded_by = v_uid, recorded_at = now(),
               recorded_by_ids = case when v_uid = any(recorded_by_ids) then recorded_by_ids else recorded_by_ids || v_uid end
         where id = v_cur.id;
      end if;
    end if;
    v_n := v_n + 1;
    v_cur := null;
  end loop;

  perform public.log_audit('attendance.record', v_org, v_uid, p_work_order_id,
            jsonb_build_object('work_date', p_work_date, 'source', p_source, 'rows', p_rows));
  return v_n;
end $$;
revoke all on function public.attendance_record(uuid, date, text, jsonb) from public, anon;
grant execute on function public.attendance_record(uuid, date, text, jsonb) to authenticated;
