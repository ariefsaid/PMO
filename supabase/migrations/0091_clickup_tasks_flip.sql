-- 0091_clickup_tasks_flip.sql
-- Purpose: Generalize the external-ownership flip onto tasks with per-command RLS, add the tasks
-- tombstone/source-mod columns, add adopt-mode dedupe on external_refs, add external_project_bindings,
-- and extend the task triggers so service-role mirror writes bypass the shipped user-only pin only while
-- tasks are externally-owned.
-- Reversibility: pre-prod via `supabase db reset`. Manual reverse block (forward-only if promoted):
--   -- tasks policies
--   drop policy if exists tasks_insert on public.tasks;
--   drop policy if exists tasks_update on public.tasks;
--   drop policy if exists tasks_delete on public.tasks;
--   create policy tasks_write on tasks for all
--     using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
--     with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
--       and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()));
--   drop policy if exists tasks_update_own_status on public.tasks;
--   create policy tasks_update_own_status on tasks
--     for update
--     using (org_id = auth_org_id() and assignee_id = (select auth.uid()))
--     with check (org_id = auth_org_id() and assignee_id = (select auth.uid()));
--   -- task triggers
--   create or replace function enforce_assignee_status_only()
--     returns trigger language plpgsql set search_path = public as $$
--   begin
--     if auth_role() in ('Admin','Executive','Project Manager','Finance') then
--       return new;
--     end if;
--     if new.name        is distinct from old.name
--        or new.assignee_id is distinct from old.assignee_id
--        or new.project_id  is distinct from old.project_id
--        or new.org_id      is distinct from old.org_id
--        or new.start_date  is distinct from old.start_date
--        or new.end_date    is distinct from old.end_date
--        or new.id          is distinct from old.id
--        or new.created_at  is distinct from old.created_at
--     then
--       raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
--     end if;
--     return new;
--   end; $$;
--   create or replace function stamp_task_completed_at() returns trigger
--     language plpgsql set search_path = public as $$
--   begin
--     if tg_op = 'INSERT' then
--       new.completed_at := case when new.status = 'Done' then now() else null end;
--     elsif new.status = 'Done' and old.status is distinct from 'Done' then
--       new.completed_at := now();
--     elsif new.status is distinct from 'Done' and old.status = 'Done' then
--       new.completed_at := null;
--     else
--       new.completed_at := old.completed_at;
--     end if;
--     return new;
--   end $$;
--   -- tasks columns + refs + bindings
--   alter table public.tasks drop column if exists tombstoned_at;
--   alter table public.tasks drop column if exists source_updated_at;
--   alter table public.external_refs drop constraint if exists external_refs_org_domain_extid_key;
--   create index external_refs_org_domain_ext_idx on public.external_refs (org_id, domain, external_record_id);
--   drop policy if exists external_project_bindings_select on public.external_project_bindings;
--   drop table if exists public.external_project_bindings;

-- Per-command split (OD-CUA-1): tasks_write (0002) is FOR ALL — a wholesale USING guard would kill
-- the user's UPDATE path AND milestone_id writability. Replace it with INSERT/UPDATE/DELETE policies:
--   INSERT + DELETE guarded by `not domain_externally_owned(auth_org_id(),'tasks')` (denied while flipped);
--   UPDATE left permissive (the enforce_assignee_status_only trigger column-pins it while flipped).
drop policy tasks_write on tasks;

create policy tasks_insert on tasks for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));

create policy tasks_update on tasks for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()));

create policy tasks_delete on tasks for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));

-- The assignee status-only path (0016) is fully denied while flipped (status is ClickUp-owned).
drop policy tasks_update_own_status on tasks;
create policy tasks_update_own_status on tasks for update
  using (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'))
  with check (org_id = auth_org_id() and assignee_id = (select auth.uid())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));

create or replace function enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  -- (a) Service-role bypass ONLY for flipped orgs, matching the policy split above: non-flipped orgs
  -- keep the exact original trigger path even for a service-role caller. Hardened (review 7a): the
  -- bypass is gated on an EXPLICIT service_role JWT claim (not the bare `auth.uid() is null`, which
  -- also matched any no-JWT context) — still conjoined with domain_externally_owned.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'tasks') then
    return new;
  end if;
  -- (b) While tasks externally-owned: pin EVERY user role to enhancement columns only
  -- (milestone_id; future weight). Native-field change → 42501. Manager exemption suspended.
  if public.domain_externally_owned(new.org_id, 'tasks') then
    if new.name         is distinct from old.name
       or new.status       is distinct from old.status
       or new.assignee_id  is distinct from old.assignee_id
       or new.project_id   is distinct from old.project_id
       or new.org_id       is distinct from old.org_id
       or new.start_date   is distinct from old.start_date
       or new.end_date     is distinct from old.end_date
       or new.id           is distinct from old.id
       or new.created_at   is distinct from old.created_at
    then
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;
  -- (c) NOT externally-owned: byte-for-byte the ORIGINAL live 0016/0017 behavior (unchanged).
  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;
  if new.name         is distinct from old.name
     or new.assignee_id  is distinct from old.assignee_id
     or new.project_id   is distinct from old.project_id
     or new.org_id       is distinct from old.org_id
     or new.start_date   is distinct from old.start_date
     or new.end_date     is distinct from old.end_date
     or new.id           is distinct from old.id
     or new.created_at   is distinct from old.created_at
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function stamp_task_completed_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Mirrored (service-role) write on a flipped org: trust the incoming completed_at (ClickUp truth);
  -- do NOT re-stamp with now(). Guarded on BOTH service_role AND externally-owned so PMO-owned
  -- service writes (if any) and every user write stay byte-for-byte the original (review 7a: explicit
  -- service_role claim, not the bare auth.uid()-is-null predicate).
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'tasks') then
    return new;
  end if;
  -- ORIGINAL 0034 behavior (unchanged for every non-mirrored path):
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'Done' then now() else null end;
  elsif new.status = 'Done' and old.status is distinct from 'Done' then
    new.completed_at := now();
  elsif new.status is distinct from 'Done' and old.status = 'Done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end $$;

-- Soft-tombstone marker (OD-CUA-2) + per-row source-modification guard (FR-CUA-049).
alter table tasks add column tombstoned_at timestamptz;
alter table tasks add column source_updated_at timestamptz;

-- Atomic adopt dedupe (FR-CUA-064): the unique constraint replaces 0088's non-unique helper index.
drop index if exists public.external_refs_org_domain_ext_idx;
alter table external_refs add constraint external_refs_org_domain_extid_key
  unique (org_id, domain, external_record_id);

-- Generic per-project external binding (List + status/member maps) — domain-generic names so no
-- ClickUp vocabulary enters the schema (FR-CUA-012). config jsonb holds { statusMap, memberMap }.
create table public.external_project_bindings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                          references public.organizations(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  external_tier         text not null,
  external_container_id text not null,
  config                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (org_id, project_id, external_tier)
);
alter table public.external_project_bindings enable row level security;
alter table public.external_project_bindings force row level security;
create policy external_project_bindings_select on public.external_project_bindings
  for select using (org_id = public.auth_org_id() and public.is_active_member());

grant select on public.external_project_bindings to authenticated;
grant select on public.external_project_bindings to anon;

-- Webhook adopt hot path (review fix #2): the webhook resolves an inbound task's binding by its
-- ClickUp List id (the adopt path) — index the (tier, container) lookup so the adopt query is an
-- index scan, not a seq scan, as bindings grow.
create index external_project_bindings_tier_container_idx
  on public.external_project_bindings (external_tier, external_container_id);
