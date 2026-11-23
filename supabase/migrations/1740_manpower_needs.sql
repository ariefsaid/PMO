-- 1740_manpower_needs.sql — manpower need: a position and head count wanted by a date, with the people proposed linked to it.
-- Spec docs/specs/manpower-request.spec.md (FR-MPN-001..006, 008). Proven by supabase/tests/1740_manpower_need.test.sql.
--
--   manpower_needs        project (required), position (a discipline from the organisation's own list, cost_disciplines 0950),
--                         head count, needed-by date, optional work order (same project) and crew, note, status open | met | cancelled.
--   manpower_need_people  the people linked to a need. Progress is NOT stored: manpower_need_progress() (1741) reads the existing
--                         cleared-for-site function, so "filled" is whatever the checklist says today.
-- Writes go straight to the tables under RLS and column grants (no approval engine). Writers = manpower_can_manage(): the existing
-- crew authority (crew_can_manage, 1035) or a person the one people-documents gate answers yes for
-- (actor_has_person_documents_access, 1536). No existing policy changes. Reads: every active member of the organisation.
-- org_id is stamped by trigger, never sent.
--
-- REVERSE: supabase/migrations/rollback/1740_manpower_needs_down.sql

create function public.manpower_can_manage() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_active_member() and not public.actor_is_light()
     and (public.crew_can_manage() or public.actor_has_person_documents_access())
$$;
revoke all on function public.manpower_can_manage() from public, anon;
grant execute on function public.manpower_can_manage() to authenticated;

create table public.manpower_needs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                   references public.organizations(id) on delete cascade,
  project_id     uuid not null references public.projects(id),
  discipline_id  uuid not null references public.cost_disciplines(id),
  headcount      integer not null check (headcount between 1 and 500),
  needed_by      date not null,
  work_order_id  uuid references public.work_orders(id),
  crew_id        uuid references public.crews(id),
  note           text check (note is null or char_length(note) <= 500),
  status         text not null default 'open' check (status in ('open', 'met', 'cancelled')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index manpower_needs_org_status_idx on public.manpower_needs (org_id, status, needed_by);
create index manpower_needs_project_idx on public.manpower_needs (project_id);
create index manpower_needs_discipline_idx on public.manpower_needs (discipline_id);
create index manpower_needs_work_order_idx on public.manpower_needs (work_order_id) where work_order_id is not null;
create index manpower_needs_crew_idx on public.manpower_needs (crew_id) where crew_id is not null;
create trigger manpower_needs_stamp_org_id before insert on public.manpower_needs
  for each row execute function public.stamp_org_id();

create table public.manpower_need_people (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
               references public.organizations(id) on delete cascade,
  need_id    uuid not null references public.manpower_needs(id) on delete cascade,
  person_id  uuid not null references public.people(id),
  linked_by  uuid default auth.uid(),
  linked_at  timestamptz not null default now(),
  unique (need_id, person_id)
);
create index manpower_need_people_person_idx on public.manpower_need_people (person_id);
create trigger manpower_need_people_stamp_org_id before insert on public.manpower_need_people
  for each row execute function public.stamp_org_id();

-- Same-organisation and live references, the work order of the need's project, the head count never below the people linked.
-- SECURITY DEFINER so the check sees rows the caller may not read; the policies still decide who writes (zz_: after the org stamp).
create function public.guard_manpower_need() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.project_id is distinct from old.project_id then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id and p.archived_at is null) then
      raise exception 'MPN_PROJECT: pick a live project of your organisation' using errcode = '23514'; end if;
  end if;
  if tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id then
    if not exists (select 1 from public.cost_disciplines d where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
      raise exception 'MPN_POSITION: pick a position from your organisation''s list' using errcode = '23514'; end if;
  end if;
  if new.work_order_id is not null and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
    if not exists (select 1 from public.work_orders w where w.id = new.work_order_id and w.org_id = new.org_id and w.project_id = new.project_id) then  -- mut:work_order_project
      raise exception 'MPN_WORK_ORDER: the work order must belong to the same project' using errcode = '23514'; end if;
  end if;
  if new.crew_id is not null and (tg_op = 'INSERT' or new.crew_id is distinct from old.crew_id) then
    if not exists (select 1 from public.crews c where c.id = new.crew_id and c.org_id = new.org_id and c.archived_at is null) then
      raise exception 'MPN_CREW: pick a live crew of your organisation' using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' and new.headcount < (select count(*) from public.manpower_need_people l where l.need_id = new.id) then
    raise exception 'MPN_HEADCOUNT: the head count cannot be lower than the people already linked' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function public.guard_manpower_need() from public, anon, authenticated;
create trigger manpower_needs_zz_guard before insert or update on public.manpower_needs
  for each row execute function public.guard_manpower_need();

-- A link: the need is open, the person is live and of the organisation, once per need, never past the head count.
create function public.guard_manpower_need_person() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.manpower_needs;
begin
  select * into n from public.manpower_needs x where x.id = new.need_id and x.org_id = new.org_id for update;
  if not found then raise exception 'MPN_CLOSED: this need does not exist or is not yours to see' using errcode = '23514'; end if;
  if n.status <> 'open' then
    raise exception 'MPN_CLOSED: people can be linked only while the need is open' using errcode = '23514'; end if;
  if not exists (select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id and p.archived_at is null) then
    raise exception 'MPN_PERSON: pick a person from the register who is not archived' using errcode = '23514'; end if;
  if exists (select 1 from public.manpower_need_people l where l.need_id = new.need_id and l.person_id = new.person_id) then
    raise exception 'MPN_DUPLICATE: this person is already linked to this need' using errcode = '23505'; end if;
  if (select count(*) from public.manpower_need_people l where l.need_id = new.need_id) >= n.headcount then          -- mut:full
    raise exception 'MPN_FULL: this need already has all the people it asked for' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function public.guard_manpower_need_person() from public, anon, authenticated;
create trigger manpower_need_people_zz_guard before insert on public.manpower_need_people
  for each row execute function public.guard_manpower_need_person();

alter table public.manpower_needs enable row level security;
alter table public.manpower_needs force row level security;
alter table public.manpower_need_people enable row level security;
alter table public.manpower_need_people force row level security;

create policy manpower_needs_select on public.manpower_needs for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy manpower_needs_insert on public.manpower_needs for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.manpower_can_manage()));  -- mut:writers
create policy manpower_needs_update on public.manpower_needs for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.manpower_can_manage()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy manpower_need_people_select on public.manpower_need_people for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy manpower_need_people_insert on public.manpower_need_people for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.manpower_can_manage()));
create policy manpower_need_people_delete on public.manpower_need_people for delete
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.manpower_can_manage()));

-- A field account (Foreman, Field user) reads neither table (the 1229 shape); the functions below refuse it by body (2711, 1530).
create policy light_account_deny_select on public.manpower_needs as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
create policy light_account_deny_select on public.manpower_need_people as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);

revoke all on public.manpower_needs, public.manpower_need_people from public, anon, authenticated;
grant select on public.manpower_needs, public.manpower_need_people to authenticated;
grant insert (project_id, discipline_id, headcount, needed_by, work_order_id, crew_id, note) on public.manpower_needs to authenticated;
grant update (discipline_id, headcount, needed_by, work_order_id, crew_id, note, status) on public.manpower_needs to authenticated;
grant insert (need_id, person_id) on public.manpower_need_people to authenticated;
grant delete on public.manpower_need_people to authenticated;
