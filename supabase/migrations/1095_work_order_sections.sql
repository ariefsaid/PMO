-- 1095_work_order_sections.sql — #2576 (map #2516): the section master, an optional child of one work order.
-- Spec docs/specs/work-order-sections.spec.md (FR-WOS-001..007, 019, 023, 024); plan docs/plans/2026-11-20-work-order-sections.md.
-- Proven by supabase/tests/1095_work_order_sections.test.sql.
--
-- A section divides a work order. It carries no value, invoice, acceptance or status of its own. It names a code (unique
-- per work order), a name, an optional note, an optional foreman (a user of the organisation), a held readiness value
-- with a note, and a sort order. Archived (ADR-0018), never hard-deleted by anyone but an Admin, and only while
-- nothing references it (the foreign keys of 1096..1098 and 1099 block it, 23503).
--
-- Writers: Admin, Executive, Finance and Project Manager (the roles that write plan figures, 0997) write structure
-- through RLS and column grants; the section's own foreman may update readiness and its note ONLY (a guard trigger
-- refuses every other column from a caller who is not one of those roles). Readers: every active member of the org.
--
-- Composite-key seam for the children (1096+): unique (id, work_order_id), so a child's
-- (section_id, work_order_id) foreign key makes a section of another work order impossible whichever path writes.
--
-- ── REVERSE (also supabase/migrations/rollback/1095_work_order_sections_down.sql) ────────────────────────────
--   drop 1099..1096 first; then drop table work_order_section_readiness_events, work_order_sections and the guard functions.

create table public.work_order_sections (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                      references public.organizations(id) on delete cascade,
  project_id        uuid not null references public.projects(id),
  work_order_id     uuid not null references public.work_orders(id),
  code              text not null check (char_length(btrim(code)) between 1 and 20),
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  location_note     text check (location_note is null or char_length(location_note) <= 500),
  -- The only profiles FK on this table: a second one makes every unqualified `profiles` embed ambiguous
  -- (postgrest_embed_ambiguity_guard), so the actor columns below are plain uuids.
  foreman_id        uuid references public.profiles(id),
  readiness         text not null default 'not_ready' check (readiness in ('not_ready', 'ready', 'blocked')),
  readiness_note    text check (readiness_note is null or char_length(readiness_note) <= 500),
  readiness_set_by  uuid,
  readiness_set_at  timestamptz,
  sort_order        integer not null default 0 check (sort_order between 0 and 100000),
  archived_at       timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  constraint work_order_sections_id_wo unique (id, work_order_id)
);
-- AC-WOS-004: a code is reserved for the work order's life; an archived section frees nothing.
create unique index work_order_sections_code_uniq on public.work_order_sections (work_order_id, lower(btrim(code)));
create index work_order_sections_wo_idx on public.work_order_sections (work_order_id, sort_order, code);
create index work_order_sections_org_idx on public.work_order_sections (org_id, project_id);
create index work_order_sections_foreman_idx on public.work_order_sections (foreman_id) where foreman_id is not null;
create trigger work_order_sections_stamp_org_id before insert on public.work_order_sections
  for each row execute function public.stamp_org_id();

-- FR-WOS-019: every readiness change (and the creation) leaves one history row: actor, time, note. Append-only.
create table public.work_order_section_readiness_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id),
  section_id    uuid not null references public.work_order_sections(id) on delete cascade,
  readiness     text not null check (readiness in ('not_ready', 'ready', 'blocked')),
  note          text check (note is null or char_length(note) <= 500),
  set_by        uuid,
  set_at        timestamptz not null default now()
);
create index work_order_section_readiness_events_idx on public.work_order_section_readiness_events (section_id, set_at, id);
create trigger work_order_section_readiness_events_stamp_org_id before insert on public.work_order_section_readiness_events
  for each row execute function public.stamp_org_id();

create function public.wos_events_append_only() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  -- A cascade from deleting the (unreferenced) section is the one legitimate removal.
  if tg_op = 'DELETE' and not exists (select 1 from public.work_order_sections s where s.id = old.section_id) then
    return old;
  end if;
  raise exception 'WOS_IMMUTABLE: readiness history cannot be changed' using errcode = 'P0001';
end $$;
revoke all on function public.wos_events_append_only() from public, anon, authenticated;
create trigger work_order_section_readiness_events_append_only before update or delete on public.work_order_section_readiness_events
  for each row execute function public.wos_events_append_only();

-- What stops a section being archived. Null = nothing. Replaced by later migrations as each child table arrives
-- (1097: tasks; 1099: material requests). Definer: it reads rows whatever the caller's RLS. Never client-callable.
create function public.wos_archive_blockers(p_section_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select null::text
$$;
revoke all on function public.wos_archive_blockers(uuid) from public, anon, authenticated;

-- ── guard: the work order, the foreman, immutability, frozen states, the foreman's column limit, archive ───────
-- SECURITY: definer so it can see a foreign row's org/status whatever the caller's RLS. It guards every writer.
create function public.guard_work_order_section() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_sections := case when tg_op = 'DELETE' then old else new end;
  v_org uuid; v_project uuid; v_status public.work_order_status;
  v_writer boolean := coalesce(public.auth_role() in ('Admin', 'Executive', 'Finance', 'Project Manager'), false);
  v_blockers text;
  v_structure_changed boolean;
begin
  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = v_row.work_order_id;
  if v_org is null or v_org is distinct from v_row.org_id then
    raise exception 'WOS_WO: the work order is not in your organisation' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    if v_status = 'Cancelled' then
      raise exception 'WOS_CANCELLED: a cancelled work order''s sections are frozen' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.project_id := v_project;
    if v_status in ('Cancelled', 'Closed') then
      raise exception 'WOS_STATUS: a % work order takes no new sections', lower(v_status::text) using errcode = '23514';
    end if;
    if (select count(*) from public.work_order_sections s where s.work_order_id = new.work_order_id) >= 200 then
      raise exception 'WOS_LIMIT: a work order has 200 sections at most' using errcode = '23514';
    end if;
    -- A section is created not ready, with no readiness author yet; the creation is the first history row.
    new.readiness := 'not_ready'; new.readiness_note := null;
    new.readiness_set_by := auth.uid(); new.readiness_set_at := now();
    new.archived_at := null;
    new.created_by := auth.uid(); new.updated_by := auth.uid(); new.created_at := now(); new.updated_at := now();
  else
    -- FR-WOS-007: where it lives is fixed once created.
    if new.work_order_id is distinct from old.work_order_id or new.project_id is distinct from old.project_id
       or new.org_id is distinct from old.org_id then
      raise exception 'WOS_KEY: a section keeps its work order and project' using errcode = '23514';
    end if;
    if v_status = 'Cancelled' then
      raise exception 'WOS_CANCELLED: a cancelled work order''s sections are frozen' using errcode = '23514';
    end if;
    v_structure_changed := (new.code, new.name, new.location_note, new.foreman_id, new.sort_order)
                           is distinct from (old.code, old.name, old.location_note, old.foreman_id, old.sort_order);
    -- FR-WOS-023: a caller who is not a structure role (the foreman) may change readiness and its note only.
    if auth.uid() is not null and not v_writer
       and (v_structure_changed or new.archived_at is distinct from old.archived_at) then
      raise exception 'WOS_FOREMAN_COLUMNS: a foreman may set readiness and its note only' using errcode = '42501';
    end if;
    if v_status = 'Closed' and v_structure_changed then
      raise exception 'WOS_STATUS: a closed work order''s sections allow readiness and archive only' using errcode = '23514';
    end if;
    if new.archived_at is not null and old.archived_at is null then
      v_blockers := public.wos_archive_blockers(new.id);
      if v_blockers is not null then
        raise exception 'WOS_ARCHIVE_BLOCKED: %', v_blockers using errcode = '23514';
      end if;
    end if;
    -- Readiness author and time are stamped here, never taken from the client.
    if (new.readiness, new.readiness_note) is distinct from (old.readiness, old.readiness_note) then
      new.readiness_set_by := auth.uid(); new.readiness_set_at := now();
    else
      new.readiness_set_by := old.readiness_set_by; new.readiness_set_at := old.readiness_set_at;
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_by := auth.uid(); new.updated_at := now();
  end if;

  -- FR-WOS-002: the foreman is an active user of the same organisation.
  if new.foreman_id is not null and (tg_op = 'INSERT' or new.foreman_id is distinct from old.foreman_id)
     and not exists (select 1 from public.profiles p
                      where p.id = new.foreman_id and p.org_id = new.org_id and p.status = 'active') then
    raise exception 'WOS_FOREMAN: the foreman must be an active user of this organisation' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_work_order_section() from public, anon, authenticated;
create trigger zz_work_order_sections_guard before insert or update or delete on public.work_order_sections
  for each row execute function public.guard_work_order_section();

-- History after the write: the readiness event, and the audit row for structure (FR-WOS-003).
create function public.audit_work_order_section() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.work_order_sections := case when tg_op = 'DELETE' then old else new end;
  pick constant text[] := array['code', 'name', 'location_note', 'foreman_id', 'sort_order', 'archived_at'];
  v_before jsonb; v_after jsonb;
begin
  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or (new.readiness, new.readiness_note) is distinct from (old.readiness, old.readiness_note)) then
    insert into public.work_order_section_readiness_events (org_id, work_order_id, section_id, readiness, note, set_by, set_at)
    values (new.org_id, new.work_order_id, new.id, new.readiness, new.readiness_note, auth.uid(), now());
  end if;
  if tg_op <> 'INSERT' then
    select jsonb_object_agg(k, to_jsonb(old) -> k) into v_before from unnest(pick) k;
  end if;
  if tg_op <> 'DELETE' then
    select jsonb_object_agg(k, to_jsonb(new) -> k) into v_after from unnest(pick) k;
    if tg_op = 'UPDATE' and v_after = v_before then return null; end if;
  end if;
  perform public.log_audit('work_order_section.' || lower(tg_op), v_row.org_id, auth.uid(), v_row.work_order_id,
    jsonb_build_object('section_id', v_row.id, 'before', v_before, 'after', v_after));
  return null;
end $$;
revoke all on function public.audit_work_order_section() from public, anon, authenticated;
create trigger zz_work_order_sections_audit after insert or update or delete on public.work_order_sections
  for each row execute function public.audit_work_order_section();

-- ── RLS (every caller-context helper is a scalar sub-select: 0646) ───────────────────────────────────────────────
alter table public.work_order_sections enable row level security;
alter table public.work_order_sections force row level security;
alter table public.work_order_section_readiness_events enable row level security;
alter table public.work_order_section_readiness_events force row level security;

create policy work_order_sections_select on public.work_order_sections for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_sections_insert on public.work_order_sections for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager'));
create policy work_order_sections_update on public.work_order_sections for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager')
              or foreman_id = (select auth.uid())))
  with check (org_id = (select public.auth_org_id()));
create policy work_order_sections_delete on public.work_order_sections for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) = 'Admin');
create policy work_order_section_readiness_events_select on public.work_order_section_readiness_events for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

revoke all on public.work_order_sections, public.work_order_section_readiness_events from public, anon, authenticated;
grant select, delete on public.work_order_sections to authenticated;
grant insert (work_order_id, code, name, location_note, foreman_id, sort_order) on public.work_order_sections to authenticated;
grant update (code, name, location_note, foreman_id, sort_order, readiness, readiness_note, archived_at) on public.work_order_sections to authenticated;
grant select on public.work_order_section_readiness_events to authenticated;
grant all on public.work_order_sections, public.work_order_section_readiness_events to service_role;
