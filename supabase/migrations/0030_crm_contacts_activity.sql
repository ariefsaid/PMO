-- 0030_crm_contacts_activity.sql — CRM v1: contacts + crm_activities. Forward-only, additive.
-- Reversibility (pre-prod): supabase db reset. Forward rollback:
--   drop table if exists crm_activities;            -- cascades its stamp-org trigger
--   drop function if exists stamp_crm_activity_org();
--   drop table if exists contacts;
--   drop type if exists crm_activity_kind;
-- Pattern: contacts mirrors companies (0001) — top-level master-data entity, org_id column
-- default + companies-parity RLS, NO stamp trigger. crm_activities mirrors the 0028 procurement
-- file child tables — parent-org guard + BEFORE INSERT org stamp from the parent contact.

create type crm_activity_kind as enum ('Call','Email','Meeting','Note');

-- ── §1 contacts ──────────────────────────────────────────────────────────────
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid not null references companies(id),
  full_name   text not null,
  title       text,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index contacts_company_idx on contacts (company_id, full_name) where archived_at is null;
create index contacts_org_id_idx  on contacts (org_id);
create index contacts_name_idx    on contacts (full_name) where archived_at is null;

alter table contacts enable row level security;
alter table contacts force  row level security;
create policy contacts_select on contacts for select using (org_id = auth_org_id());
-- Writer set mirrors companies_write (0002): the 4 master-data roles. Parent-org guard:
-- the referenced company must be in the caller's org (HIGH-BV-1 pattern).
create policy contacts_write on contacts for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.companies c where c.id = contacts.company_id and c.org_id = auth_org_id()));
-- Hard-delete narrowed to Admin (mirrors companies 0013): a RESTRICTIVE delete-only policy.
create policy contacts_delete_admin_only on contacts as restrictive for delete
  using (auth_role() = 'Admin');

-- ── §2 crm_activities ────────────────────────────────────────────────────────
create table crm_activities (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  contact_id   uuid not null references contacts(id) on delete cascade,
  company_id   uuid references companies(id),
  project_id   uuid references projects(id),
  kind         crm_activity_kind not null,
  subject      text,
  body         text,
  occurred_at  timestamptz not null default now(),
  logged_by_id uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index crm_activities_contact_idx on crm_activities (contact_id, occurred_at desc);
create index crm_activities_org_id_idx  on crm_activities (org_id);

alter table crm_activities enable row level security;
alter table crm_activities force  row level security;
create policy crm_activities_select on crm_activities for select using (org_id = auth_org_id());
-- Parent-org guard: the parent contact must be in the caller's org (mirrors 0028 file *_write).
create policy crm_activities_write on crm_activities for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.contacts ct where ct.id = crm_activities.contact_id and ct.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.contacts ct where ct.id = crm_activities.contact_id and ct.org_id = auth_org_id()));

-- ── §3 org_id stamp trigger (mirror 0028 stamp_procurement_quotation_file_org) ──
-- The client NEVER sends org_id; the column default is the seed org. A BEFORE INSERT trigger
-- inherits org_id from the parent contact whenever the client left it null / at the seed
-- default, so the *_write WITH CHECK (org_id = auth_org_id()) passes for any org. An
-- EXPLICITLY-sent org_id is preserved untouched, so a cross-org spoof still hits WITH CHECK
-- rather than being silently rewritten. search_path pinned + schema-qualified (LOW-BV-1).
create or replace function stamp_crm_activity_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select ct.org_id into new.org_id from public.contacts ct where ct.id = new.contact_id;
  end if;
  return new;
end; $$;
create trigger crm_activities_stamp_org
  before insert on crm_activities
  for each row execute function stamp_crm_activity_org();
