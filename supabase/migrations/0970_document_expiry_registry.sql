-- 0970_document_expiry_registry.sql — #2527 (map #2516): expiry-tracked documents for people and equipment.
-- Minimal person record (`people`): docs/specs/employee-roster.spec.md is proposed and unbuilt, so no PMO person table exists;
-- this is the smallest one the feature needs (code, name, optional profile link, optional manager). The roster increment can
-- adopt or extend it; nothing here is payroll data. Medical documents hold a status (fit/unfit) and a date only.
-- Reverse: supabase/migrations/rollback/0970_document_expiry_registry_down.sql

alter table public.organizations
  add column document_warning_days integer[] not null default '{30,14,7}'
  check (cardinality(document_warning_days) between 1 and 5 and document_warning_days <@ array(select generate_series(1, 365)));

create table public.people (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 40),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  profile_id  uuid references public.profiles(id),
  manager_id  uuid references public.profiles(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create unique index people_code_live on public.people (org_id, lower(btrim(code))) where archived_at is null;
create unique index people_profile_live on public.people (profile_id) where profile_id is not null and archived_at is null;
create index people_manager_idx on public.people (manager_id) where manager_id is not null;
create trigger people_stamp_org_id before insert on public.people for each row execute function public.stamp_org_id();

create table public.document_types (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                 references public.organizations(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  applies_to   text not null check (applies_to in ('person','equipment')),
  is_medical   boolean not null default false,
  -- per-type recipient filter: roles notified besides the person's manager. NULL on insert = default for applies_to (trigger).
  notify_roles text[] not null default '{}'
                 check (notify_roles <@ array['Admin','Project Manager','Finance','Executive','Engineer']),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint document_types_medical_person check (not is_medical or applies_to = 'person')
);
create unique index document_types_name_live on public.document_types (org_id, applies_to, lower(btrim(name))) where archived_at is null;
create trigger document_types_stamp_org_id before insert on public.document_types for each row execute function public.stamp_org_id();

create table public.expiry_documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                    references public.organizations(id) on delete cascade,
  subject_kind    text not null check (subject_kind in ('person','equipment')),
  person_id       uuid references public.people(id) on delete restrict,
  asset_id        uuid references public.equipment_assets(id) on delete restrict,
  type_id         uuid not null references public.document_types(id) on delete restrict,
  number          text check (number is null or char_length(number) <= 80),
  issued_on       date,
  expires_on      date not null,
  location_note   text check (location_note is null or char_length(location_note) <= 200),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 500),
  medical_status  text check (medical_status in ('fit','unfit')),
  is_medical      boolean not null default false,   -- stamped from the type; never client-written
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  constraint expiry_documents_subject check (
    (subject_kind = 'person' and person_id is not null and asset_id is null) or
    (subject_kind = 'equipment' and asset_id is not null and person_id is null)),
  constraint expiry_documents_dates check (issued_on is null or issued_on <= expires_on),
  -- medical data is a status and a date only (never results, numbers, notes or files)
  constraint expiry_documents_medical_shape check (
    (is_medical and medical_status is not null and number is null and location_note is null and attachment_path is null)
    or (not is_medical and medical_status is null))
);
create index expiry_documents_due on public.expiry_documents (org_id, expires_on) where archived_at is null;
create index expiry_documents_person on public.expiry_documents (person_id) where person_id is not null;
create index expiry_documents_asset on public.expiry_documents (asset_id) where asset_id is not null;
create trigger expiry_documents_stamp_org_id before insert on public.expiry_documents for each row execute function public.stamp_org_id();

-- default recipient roles per kind; HR is the Admin role (no separate HR role exists)
create function public.document_types_defaults() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(cardinality(new.notify_roles), 0) = 0 and tg_op = 'INSERT' then
    new.notify_roles := case new.applies_to when 'person' then array['Admin'] else array['Admin','Project Manager'] end;
  end if;
  return new;
end $$;
create trigger document_types_defaults_trg before insert on public.document_types
  for each row execute function public.document_types_defaults();

-- stamp is_medical from the type and keep type/subject/org consistent (same-org, matching kind)
create function public.expiry_documents_guard() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare t record;
begin
  select * into t from public.document_types where id = new.type_id;
  if not found or t.org_id <> new.org_id or t.applies_to <> new.subject_kind then
    raise exception 'document type does not match this subject' using errcode = '22023';
  end if;
  if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id) then
    raise exception 'person not found' using errcode = '22023';
  end if;
  if new.asset_id is not null and not exists (select 1 from public.equipment_assets a where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'equipment asset not found' using errcode = '22023';
  end if;
  new.is_medical := t.is_medical;
  return new;
end $$;
create trigger expiry_documents_guard_trg before insert or update on public.expiry_documents
  for each row execute function public.expiry_documents_guard();

alter table public.people enable row level security;           alter table public.people force row level security;
alter table public.document_types enable row level security;   alter table public.document_types force row level security;
alter table public.expiry_documents enable row level security; alter table public.expiry_documents force row level security;

-- people: planners read all; a manager reads their reports; a linked person reads themself. Admin manages.
create policy people_select on public.people for select using (
  org_id = public.auth_org_id() and public.is_active_member()
  and (public.auth_role() in ('Admin','Project Manager','Finance','Executive') or manager_id = auth.uid() or profile_id = auth.uid()));
create policy people_insert on public.people for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
create policy people_update on public.people for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin')
  with check (org_id = public.auth_org_id());

create policy document_types_select on public.document_types for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy document_types_insert on public.document_types for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
create policy document_types_update on public.document_types for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin')
  with check (org_id = public.auth_org_id());

-- documents: audience reads; a manager/self reads a person's non-medical docs (via people RLS); medical = Admin only.
create policy expiry_documents_select on public.expiry_documents for select using (
  org_id = public.auth_org_id() and public.is_active_member()
  and (not is_medical or public.auth_role() = 'Admin')
  and (public.auth_role() in ('Admin','Project Manager','Finance','Executive')
       or (person_id is not null and exists (select 1 from public.people p where p.id = person_id))));
-- Admin keeps every document; a Project Manager keeps equipment documents only
create policy expiry_documents_insert on public.expiry_documents for insert with check (
  org_id = public.auth_org_id() and public.is_active_member()
  and (public.auth_role() = 'Admin' or (public.auth_role() = 'Project Manager' and subject_kind = 'equipment')));
create policy expiry_documents_update on public.expiry_documents for update using (
  org_id = public.auth_org_id() and public.is_active_member()
  and (public.auth_role() = 'Admin' or (public.auth_role() = 'Project Manager' and subject_kind = 'equipment')))
  with check (org_id = public.auth_org_id());

revoke all on public.people, public.document_types, public.expiry_documents from public, anon, authenticated;
grant select on public.people, public.document_types, public.expiry_documents to authenticated;
grant insert (code, name, profile_id, manager_id) on public.people to authenticated;
grant update (code, name, profile_id, manager_id, archived_at) on public.people to authenticated;
grant insert (name, applies_to, is_medical, notify_roles) on public.document_types to authenticated;
grant update (name, notify_roles, archived_at) on public.document_types to authenticated;
grant insert (subject_kind, person_id, asset_id, type_id, number, issued_on, expires_on, location_note, attachment_path, medical_status)
  on public.expiry_documents to authenticated;
grant update (number, issued_on, expires_on, location_note, attachment_path, medical_status, archived_at)
  on public.expiry_documents to authenticated;
grant all on public.people, public.document_types, public.expiry_documents to service_role;
