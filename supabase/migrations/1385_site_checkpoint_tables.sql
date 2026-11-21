-- 1385_site_checkpoint_tables.sql — #2594 (map #2516): timed checkpoints on the daily site report. Tables, read rule, list setter.
-- Spec: docs/specs/site-timed-checkpoints.spec.md (FR-STC-001/002/050..052, NFR-STC-001). Proven by supabase/tests/1385_site_timed_checkpoints.test.sql.
--   §1 site_checkpoint_templates: the organisation's whole list (0 to 12 items). No name or time is built in; an empty list means the feature is off.
--   §2 site_checkpoints: one copy per (work order, crew, date), created by the job in 1387; recorded through 1386; no client write grant.
--   §3 site_checkpoint_today(), site_checkpoint_may_read(), site_checkpoint_may_record(): the access rule, one place.
--   §4 set_site_checkpoint_list(jsonb): Admin only, replaces the whole list; day rows already created are not touched.
-- ── REVERSE (also rollback/1385_site_checkpoint_tables_down.sql) ───────────────────────────────────────
--   drop the functions, then site_checkpoints, then site_checkpoint_templates (reverse 1386..1388 first).

create table public.site_checkpoint_templates (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  position         smallint not null check (position between 1 and 12),
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  marks_work_start boolean not null default false,
  due_time         time not null,
  grace_minutes    smallint not null default 0 check (grace_minutes between 0 and 120),
  photo_required   boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (org_id, position)
);
-- FR-STC-001: at most one checkpoint per list marks the start of work.
create unique index site_checkpoint_templates_one_start on public.site_checkpoint_templates (org_id) where marks_work_start;
create trigger site_checkpoint_templates_stamp_org_id before insert on public.site_checkpoint_templates
  for each row execute function public.stamp_org_id();

create table public.site_checkpoints (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  work_order_id    uuid not null references public.work_orders(id),
  crew_id          uuid not null references public.crews(id),
  work_date        date not null,
  position         smallint not null check (position between 1 and 12),
  name             text not null,
  marks_work_start boolean not null default false,
  due_at           timestamptz not null,
  grace_minutes    smallint not null default 0 check (grace_minutes between 0 and 120),
  photo_required   boolean not null default true,
  recorded_at      timestamptz,
  recorded_by      uuid references public.profiles(id),
  note             text check (note is null or char_length(note) <= 500),
  photo_path       text,
  late_notified_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (work_order_id, crew_id, work_date, position),
  constraint site_checkpoints_recorded_pair check ((recorded_at is null) = (recorded_by is null)),
  constraint site_checkpoints_photo_kept check (recorded_at is null or not photo_required or photo_path is not null)
);
create index site_checkpoints_wo_date on public.site_checkpoints (work_order_id, work_date);
create index site_checkpoints_crew_date on public.site_checkpoints (crew_id, work_date);
-- NFR-STC-001: the reminder job scans only rows still waiting for a record and a reminder.
create index site_checkpoints_unrecorded_due on public.site_checkpoints (due_at)
  where recorded_at is null and late_notified_at is null;
create trigger site_checkpoints_stamp_org_id before insert on public.site_checkpoints
  for each row execute function public.stamp_org_id();

-- ── §3 the access rule (FR-STC-050): one security-definer helper per question, called as plain functions in policies ──
-- Today in the caller's organisation (the organisation's own clock, NFR-STC-004).
create function public.site_checkpoint_today() returns date
  language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce(
            (select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC'))::date
$$;
revoke all on function public.site_checkpoint_today() from public, anon;
grant execute on function public.site_checkpoint_today() to authenticated;

-- Read: Admin, Executive, Engineer, the work order's project manager, or the crew's own field controller.
create function public.site_checkpoint_may_read(p_work_order uuid, p_crew uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.work_orders w join public.projects p on p.id = w.project_id
     where w.id = p_work_order and w.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Executive', 'Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid())
            or exists (select 1 from public.crews c
                        where c.id = p_crew and c.org_id = w.org_id and c.field_controller_id = auth.uid()))), false)
$$;
-- Record: the crew's field controller, Admin, Engineer, or the work order's project manager (Executive reads only).
create function public.site_checkpoint_may_record(p_work_order uuid, p_crew uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.work_orders w join public.projects p on p.id = w.project_id
     where w.id = p_work_order and w.org_id = public.auth_org_id()
       and (public.auth_role() in ('Admin', 'Engineer')
            or (public.auth_role() = 'Project Manager' and p.project_manager_id = auth.uid())
            or exists (select 1 from public.crews c
                        where c.id = p_crew and c.org_id = w.org_id and c.field_controller_id = auth.uid()))), false)
$$;
revoke all on function public.site_checkpoint_may_read(uuid, uuid) from public, anon;
revoke all on function public.site_checkpoint_may_record(uuid, uuid) from public, anon;
grant execute on function public.site_checkpoint_may_read(uuid, uuid) to authenticated;
grant execute on function public.site_checkpoint_may_record(uuid, uuid) to authenticated;

-- ── RLS: reads only; no client write grant (FR-STC-051) ───────────────────────────────────────────────
alter table public.site_checkpoint_templates enable row level security;
alter table public.site_checkpoints enable row level security;
revoke all on public.site_checkpoint_templates from anon, authenticated;
revoke all on public.site_checkpoints from anon, authenticated;
grant select on public.site_checkpoint_templates to authenticated;
grant select on public.site_checkpoints to authenticated;

-- The list is read by Admin (the editor); everyone else reads the day rows, which carry their own copy.
create policy site_checkpoint_templates_select on public.site_checkpoint_templates for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy site_checkpoints_select on public.site_checkpoints for select
  using (org_id = (select public.auth_org_id()) and public.site_checkpoint_may_read(work_order_id, crew_id));

-- ── §4 FR-STC-001/002/052: replace the whole list (the shape of set_billing_stage_template) ──────────────
create function public.set_site_checkpoint_list(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_item  jsonb;
  v_pos   int := 0;
  v_starts int := 0;
  v_time  time;
  v_grace int;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the checkpoint list' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 12 then
    raise exception 'the checkpoints are a list of at most 12' using errcode = '22023', detail = 'checkpoints-shape';
  end if;
  perform 1 from public.organizations o where o.id = v_org for update;

  -- Validate everything before the first write, so a refused list leaves the old one in place.
  for v_item in select x from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(v_item) <> 'object' or char_length(btrim(coalesce(v_item ->> 'name', ''))) not between 1 and 120 then
      raise exception 'every checkpoint needs a name of 1 to 120 characters' using errcode = '23514', detail = 'checkpoint-name-invalid';
    end if;
    begin
      v_time := (v_item ->> 'due_time')::time;
      v_grace := coalesce((v_item ->> 'grace_minutes')::int, 0);
      perform coalesce((v_item ->> 'marks_work_start')::boolean, false), coalesce((v_item ->> 'photo_required')::boolean, true);
    exception when others then
      raise exception 'every checkpoint needs a valid time, grace and flags' using errcode = '23514', detail = 'checkpoint-field-invalid';
    end;
    if v_time is null then
      raise exception 'every checkpoint needs a time' using errcode = '23514', detail = 'checkpoint-time-missing';
    end if;
    if v_grace not between 0 and 120 then
      raise exception 'grace is 0 to 120 minutes' using errcode = '23514', detail = 'checkpoint-grace-invalid';
    end if;
    if coalesce((v_item ->> 'marks_work_start')::boolean, false) then v_starts := v_starts + 1; end if;
  end loop;
  if v_starts > 1 then
    raise exception 'only one checkpoint can mark the start of work' using errcode = '23514', detail = 'checkpoint-work-start-duplicate';
  end if;

  delete from public.site_checkpoint_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    insert into public.site_checkpoint_templates (org_id, position, name, marks_work_start, due_time, grace_minutes, photo_required)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'marks_work_start')::boolean, false),
            (v_item ->> 'due_time')::time, coalesce((v_item ->> 'grace_minutes')::int, 0),
            coalesce((v_item ->> 'photo_required')::boolean, true));
  end loop;
  perform public.log_audit('site_checkpoint_list.set', v_org, auth.uid(), null, jsonb_build_object('count', v_pos));
  return v_pos;
end; $$;
revoke all on function public.set_site_checkpoint_list(jsonb) from public, anon;
grant execute on function public.set_site_checkpoint_list(jsonb) to authenticated;
