-- 1411_safety_days_tables.sql — #2596 daily safety records: the day and its five parts, access rules and the locking guard.
-- Spec: docs/specs/daily-safety-records.spec.md (FR-DSF-001..007, 015, 016). Proven by supabase/tests/safety_days.test.sql.
-- Not a money path. A safety day is one record per work order and date: draft until submitted, then locked for good;
-- a correction is a new version (1412). Writers: Admin, Engineer, or the project's Project Manager (until the
-- safety-officer role of #902 exists). Reversal: rollback/1411_safety_days_tables_down.sql.

-- ── who may do what ──────────────────────────────────────────────────────────────────────────────────────────
create function public.safety_may_enter(p_project uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$$;
-- OD-DSF-6: worker names and photos are readable by Admin, Executive, Engineer and the project's Project Manager.
create function public.safety_may_see_people(p_project uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project and p.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Executive', 'Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid()))), false)
$$;

-- ── the day ──────────────────────────────────────────────────────────────────────────────────────────────────
create table public.safety_days (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                      references public.organizations(id) on delete cascade,
  project_id        uuid not null references public.projects(id),
  work_order_id     uuid not null references public.work_orders(id),
  work_date         date not null,
  status            text not null default 'draft' check (status in ('draft', 'locked')),
  version           integer not null default 1 check (version >= 1),
  supersedes_id     uuid unique references public.safety_days(id),
  correction_reason text check (correction_reason is null or char_length(btrim(correction_reason)) between 1 and 500),
  author_id         uuid not null references public.profiles(id) default auth.uid(),
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint safety_days_correction_pair check ((supersedes_id is null) = (correction_reason is null)),
  constraint safety_days_locked_stamped check ((status = 'locked') = (submitted_at is not null))
);
create unique index safety_days_one_per_day on public.safety_days (work_order_id, work_date)
  where supersedes_id is null and archived_at is null;
create index safety_days_wo_date on public.safety_days (work_order_id, work_date desc, version desc);
create index safety_days_project_date on public.safety_days (org_id, project_id, work_date desc, id desc);
create index safety_days_author on public.safety_days (author_id);

-- ── the parts ────────────────────────────────────────────────────────────────────────────────────────────────
create table public.safety_fitness_checks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  day_id        uuid not null references public.safety_days(id) on delete cascade,
  worker_id     uuid references public.people(id),
  visitor_name  text check (visitor_name is null or char_length(btrim(visitor_name)) between 1 and 120),
  check_type_id uuid references public.safety_list_items(id),
  result        text not null default 'not_checked' check (result in ('fit', 'not_fit', 'not_checked')),
  note          text check (note is null or char_length(note) <= 500),
  constraint safety_fitness_who check ((worker_id is null) <> (visitor_name is null)),
  constraint safety_fitness_note check (result <> 'not_fit' or char_length(btrim(coalesce(note, ''))) > 0)
);
create unique index safety_fitness_one on public.safety_fitness_checks
  (day_id, coalesce(worker_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(lower(visitor_name), ''),
   coalesce(check_type_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index safety_fitness_worker on public.safety_fitness_checks (worker_id) where worker_id is not null;
create index safety_fitness_type on public.safety_fitness_checks (check_type_id) where check_type_id is not null;

create table public.safety_toolbox_talks (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
              references public.organizations(id) on delete cascade,
  day_id    uuid not null references public.safety_days(id) on delete cascade,
  topic     text not null check (char_length(btrim(topic)) between 1 and 200),
  presenter text not null check (char_length(btrim(presenter)) between 1 and 120),
  held_at   timestamptz not null
);
create index safety_talks_day on public.safety_toolbox_talks (day_id);

create table public.safety_toolbox_attendees (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                 references public.organizations(id) on delete cascade,
  day_id       uuid not null references public.safety_days(id) on delete cascade,
  talk_id      uuid not null references public.safety_toolbox_talks(id) on delete cascade,
  worker_id    uuid references public.people(id),
  visitor_name text check (visitor_name is null or char_length(btrim(visitor_name)) between 1 and 120),
  constraint safety_attendee_who check ((worker_id is null) <> (visitor_name is null))
);
create index safety_attendees_talk on public.safety_toolbox_attendees (talk_id);
create index safety_attendees_day on public.safety_toolbox_attendees (day_id);
create index safety_attendees_worker on public.safety_toolbox_attendees (worker_id) where worker_id is not null;

create table public.safety_toolbox_photos (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  day_id      uuid not null references public.safety_days(id) on delete cascade,
  talk_id     uuid not null references public.safety_toolbox_talks(id) on delete cascade,
  file_path   text not null check (char_length(file_path) between 1 and 400),
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index safety_photos_talk on public.safety_toolbox_photos (talk_id);
create index safety_photos_day on public.safety_toolbox_photos (day_id);
create index safety_photos_uploader on public.safety_toolbox_photos (uploaded_by);

-- The pre-work checklist is copied from the organisation's active list when a day is created (OD-DSF-5), so a later
-- change to the list never rewrites a past day. answer null = not yet answered.
create table public.safety_checklist_answers (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
             references public.organizations(id) on delete cascade,
  day_id   uuid not null references public.safety_days(id) on delete cascade,
  item_id  uuid references public.safety_list_items(id),
  label    text not null check (char_length(btrim(label)) between 1 and 120),
  position integer not null default 0,
  answer   text check (answer is null or answer in ('yes', 'no', 'not_applicable')),
  note     text check (note is null or char_length(note) <= 500)
);
create index safety_checklist_day on public.safety_checklist_answers (day_id, position);
create index safety_checklist_item on public.safety_checklist_answers (item_id) where item_id is not null;

create table public.safety_permits (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  day_id        uuid not null references public.safety_days(id) on delete cascade,
  permit_number text not null check (char_length(btrim(permit_number)) between 1 and 60),
  type_id       uuid references public.safety_list_items(id),
  valid_from    timestamptz not null,
  valid_to      timestamptz not null,
  issued_by     text check (issued_by is null or char_length(btrim(issued_by)) between 1 and 120),
  state         text not null default 'open' check (state in ('open', 'closed')),
  constraint safety_permit_validity check (valid_to >= valid_from)
);
create index safety_permits_day on public.safety_permits (day_id);
create index safety_permits_type on public.safety_permits (type_id) where type_id is not null;

-- The safety officer's report: signed entries, added even after the day is locked, never edited (FR-DSF-007).
create table public.safety_officer_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                 references public.organizations(id) on delete cascade,
  day_id       uuid not null references public.safety_days(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  near_misses  integer not null default 0 check (near_misses between 0 and 1000),
  observations integer not null default 0 check (observations between 0 and 1000),
  incident_id  uuid references public.incident_reports(id),
  author_id    uuid not null references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index safety_officer_day on public.safety_officer_entries (day_id, created_at);
create index safety_officer_incident on public.safety_officer_entries (incident_id) where incident_id is not null;
create index safety_officer_author on public.safety_officer_entries (author_id);

-- ── row access helpers over a day ────────────────────────────────────────────────────────────────────────────
create function public.safety_may_enter_day(p_day uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.safety_days d
    where d.id = p_day and d.org_id = public.auth_org_id() and public.safety_may_enter(d.project_id)), false)
$$;
create function public.safety_day_writable(p_day uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.safety_days d
    where d.id = p_day and d.org_id = public.auth_org_id() and d.status = 'draft' and public.safety_may_enter(d.project_id)), false)
$$;
create function public.safety_may_see_people_day(p_day uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.safety_days d
    where d.id = p_day and d.org_id = public.auth_org_id() and public.safety_may_see_people(d.project_id)), false)
$$;
-- A photo row is evidence only while its uploaded object exists in the bucket.
create function public.safety_photo_stored(p_path text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'safety-photos' and o.name = p_path)
$$;

-- ── the guards ───────────────────────────────────────────────────────────────────────────────────────────────
-- The day: only an Issued work order of the caller's own org, project derived, status/version/author the database's.
-- pmo.safety_internal is raised only inside the 1412 RPCs (a correction copies a locked day).
create function public.safety_days_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_internal boolean := coalesce(current_setting('pmo.safety_internal', true), '') = 'on';
  v_wo record;
begin
  if tg_op = 'DELETE' then
    -- a client never deletes a day; the service role (auth.uid() null: retention, manual Admin removal, fixtures) may (OD-DSF-7)
    if auth.uid() is not null then
      raise exception 'a safety day is never deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'locked' and not v_internal then
      raise exception 'a locked safety day cannot be changed' using errcode = '23514';
    end if;
    return new;
  end if;
  select w.org_id, w.project_id, w.status into v_wo from public.work_orders w where w.id = new.work_order_id;
  if not found or v_wo.org_id is distinct from new.org_id then
    raise exception 'work order not in this organisation' using errcode = '42501';
  end if;
  new.project_id := v_wo.project_id;
  if not v_internal then
    if not exists (select 1 from public.organizations o where o.id = new.org_id and o.safety_records_enabled) then
      raise exception 'safety records are not switched on for this organisation' using errcode = '42501';
    end if;
    if v_wo.status::text <> 'Issued' then
      raise exception 'work order is not issued' using errcode = '23514';
    end if;
    new.status := 'draft'; new.version := 1; new.supersedes_id := null; new.correction_reason := null;
    new.submitted_at := null; new.archived_at := null;
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger safety_days_zz_guard before insert or update or delete on public.safety_days
  for each row execute function public.safety_days_guard();

-- Every part: its day is draft (officer entries excepted and immutable), workers are on the roster or named visitors,
-- list entries are of the right kind. Roster = the shipped work_order_roster (1036) for the day's work order and date.
create function public.safety_part_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_internal boolean := coalesce(current_setting('pmo.safety_internal', true), '') = 'on';
  v_row jsonb;
  v_old jsonb;
  v_day public.safety_days%rowtype;
  v_worker uuid;
  v_kind text;
  v_list uuid;
begin
  if tg_op = 'DELETE' and auth.uid() is null then return old; end if;   -- the service role removing a day takes its parts
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  select * into v_day from public.safety_days where id = (v_row ->> 'day_id')::uuid;
  if not found then
    raise exception 'safety day not found' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' and (v_row ->> 'org_id')::uuid is distinct from v_day.org_id then
    raise exception 'safety day not in this organisation' using errcode = '42501';
  end if;
  if v_internal then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'safety_officer_entries' then
    if tg_op <> 'INSERT' then
      raise exception 'a safety officer entry is never changed' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_day.status <> 'draft' then
    raise exception 'a locked safety day cannot be changed' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if tg_table_name in ('safety_fitness_checks', 'safety_toolbox_attendees') and (v_row ->> 'worker_id') is not null
     and (v_row ->> 'worker_id') is distinct from (v_old ->> 'worker_id') then
    v_worker := (v_row ->> 'worker_id')::uuid;
    if not exists (select 1 from public.work_order_roster(v_day.work_order_id, v_day.work_date) r,
                          jsonb_array_elements(r.members) m where (m ->> 'worker_id')::uuid = v_worker) then
      raise exception 'worker is not on the work order roster for this date' using errcode = '23514';
    end if;
  end if;

  v_kind := case tg_table_name when 'safety_fitness_checks' then 'check_type' when 'safety_permits' then 'permit_type' end;
  v_list := nullif(case tg_table_name when 'safety_fitness_checks' then v_row ->> 'check_type_id'
                                      when 'safety_permits' then v_row ->> 'type_id' end, '')::uuid;
  if v_kind is not null and v_list is not null
     and v_list is distinct from nullif(case tg_table_name when 'safety_fitness_checks' then v_old ->> 'check_type_id'
                                                           when 'safety_permits' then v_old ->> 'type_id' end, '')::uuid then
    if not exists (select 1 from public.safety_list_items i where i.id = v_list and i.kind = v_kind
                    and i.org_id = v_day.org_id and i.archived_at is null) then
      raise exception 'not an active entry of this list' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['safety_fitness_checks', 'safety_toolbox_talks', 'safety_toolbox_attendees',
                           'safety_toolbox_photos', 'safety_checklist_answers', 'safety_permits', 'safety_officer_entries'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.safety_part_guard()', t || '_zz_guard', t);
  end loop;
end $$;

-- The checklist is copied onto a new original day from the organisation's active list.
create function public.safety_days_copy_checklist() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.supersedes_id is null then
    insert into public.safety_checklist_answers (org_id, day_id, item_id, label, position)
      select new.org_id, new.id, i.id, i.label, (row_number() over (order by i.position, i.created_at, i.id))::int
        from public.safety_list_items i
       where i.org_id = new.org_id and i.kind = 'checklist_item' and i.archived_at is null;
  end if;
  return null;
end $$;
create trigger safety_days_copy_checklist after insert on public.safety_days
  for each row execute function public.safety_days_copy_checklist();

-- ── org stamp, RLS, grants ───────────────────────────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['safety_days', 'safety_fitness_checks', 'safety_toolbox_talks', 'safety_toolbox_attendees',
                           'safety_toolbox_photos', 'safety_checklist_answers', 'safety_permits', 'safety_officer_entries'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()', t || '_stamp_org_id', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Header, talks (topic and presenter), checklist, permits and officer entries: every active member of the organisation (counts).
create policy safety_days_select on public.safety_days for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy safety_talks_select on public.safety_toolbox_talks for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy safety_checklist_select on public.safety_checklist_answers for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy safety_permits_select on public.safety_permits for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy safety_officer_select on public.safety_officer_entries for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- Worker names and photos: OD-DSF-6.
create policy safety_fitness_select on public.safety_fitness_checks for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_may_see_people_day(day_id));
create policy safety_attendees_select on public.safety_toolbox_attendees for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_may_see_people_day(day_id));
create policy safety_photos_select on public.safety_toolbox_photos for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_may_see_people_day(day_id));

-- Writes: an enterer, while the day is a draft (the guards above refuse the rest).
create policy safety_days_insert on public.safety_days for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_may_enter(project_id));
grant insert (work_order_id, work_date) on public.safety_days to authenticated;

create policy safety_fitness_insert on public.safety_fitness_checks for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
create policy safety_fitness_update on public.safety_fitness_checks for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
create policy safety_fitness_delete on public.safety_fitness_checks for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
grant insert (day_id, worker_id, visitor_name, check_type_id, result, note) on public.safety_fitness_checks to authenticated;
grant update (result, note, check_type_id) on public.safety_fitness_checks to authenticated;
grant delete on public.safety_fitness_checks to authenticated;

-- Talks and attendees are written by safety_save_talk (1412); a talk is removed here.
create policy safety_talks_delete on public.safety_toolbox_talks for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
grant delete on public.safety_toolbox_talks to authenticated;

create policy safety_photos_insert on public.safety_toolbox_photos for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id)
              and split_part(file_path, '/', 1) = org_id::text and split_part(file_path, '/', 2) = day_id::text
              and split_part(file_path, '/', 3) = id::text and public.safety_photo_stored(file_path)
              and exists (select 1 from public.safety_toolbox_talks t where t.id = talk_id and t.day_id = safety_toolbox_photos.day_id));
create policy safety_photos_delete on public.safety_toolbox_photos for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
grant insert (id, day_id, talk_id, file_path) on public.safety_toolbox_photos to authenticated;
grant delete on public.safety_toolbox_photos to authenticated;

create policy safety_checklist_update on public.safety_checklist_answers for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
grant update (answer, note) on public.safety_checklist_answers to authenticated;

create policy safety_permits_insert on public.safety_permits for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
create policy safety_permits_update on public.safety_permits for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
create policy safety_permits_delete on public.safety_permits for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_day_writable(day_id));
grant insert (day_id, permit_number, type_id, valid_from, valid_to, issued_by) on public.safety_permits to authenticated;
grant update (permit_number, type_id, valid_from, valid_to, issued_by, state) on public.safety_permits to authenticated;
grant delete on public.safety_permits to authenticated;

-- Officer entries: also on a locked day (FR-DSF-007).
create policy safety_officer_insert on public.safety_officer_entries for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.safety_may_enter_day(day_id));
grant insert (day_id, body, near_misses, observations, incident_id) on public.safety_officer_entries to authenticated;

revoke all on function public.safety_may_enter(uuid), public.safety_may_see_people(uuid), public.safety_may_enter_day(uuid),
  public.safety_day_writable(uuid), public.safety_may_see_people_day(uuid), public.safety_photo_stored(text) from public, anon;
grant execute on function public.safety_may_enter(uuid), public.safety_may_see_people(uuid), public.safety_may_enter_day(uuid),
  public.safety_day_writable(uuid), public.safety_may_see_people_day(uuid), public.safety_photo_stored(text) to authenticated;
revoke all on function public.safety_days_guard(), public.safety_part_guard(), public.safety_days_copy_checklist()
  from public, anon, authenticated;
