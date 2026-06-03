-- 0001_init_schema.sql — PMO Portal schema (target-architecture.spec.md §5, de-O&G'd).
-- Single forward migration; re-runnable via `supabase db reset` (plan D-4). Create-only, no destructive steps.
-- Reversibility (charter Data/Schema DoD): the schema has never been deployed (cloud deferred, ADR-0006),
-- so there is no production state to preserve. No `down` migration is shipped for a pre-production schema;
-- idempotent `supabase db reset` is the reversibility contract (plan D-4). Once deployed, future issues ship
-- forward-only additive migrations with documented rollback.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Enums (spec §5.1; de-O&G: incident_* not HSE)
create type user_role          as enum ('Executive','Project Manager','Finance','Engineer','Admin');
create type company_type       as enum ('Internal','Client','Vendor');
create type project_status     as enum (
  'Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation',
  'Won, Pending KoM','Ongoing Project','On Hold','Close Out','Loss Tender','Internal Project');
create type procurement_status as enum (
  'Draft','Requested','Approved','Rejected','Vendor Quoted','Quote Selected',
  'Ordered','Received','Vendor Invoiced','Paid','Cancelled');
create type budget_category    as enum (
  'Labor','Materials','Subcontractors','Equipment','Permits & Fees','Overheads','Contingency');
create type budget_status      as enum ('Draft','Active','Archived');
create type timesheet_status   as enum ('Draft','Submitted','Approved','Rejected');
create type task_status        as enum ('To Do','In Progress','Done','Blocked');
create type incident_severity  as enum ('Low','Medium','High','Critical');
create type incident_status    as enum ('Open','Investigating','Closed');
create type doc_status         as enum ('Draft','Issued','Approved','Rejected','Closed');

-- §5.2 organizations (tenancy root). The default-org id is a fixed literal so the column default
-- and seed agree without a lookup (plan D-2). Created here so FK targets exist before any insert.
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);
insert into organizations (id, name)
  values ('00000000-0000-0000-0000-000000000001', 'Default Organization')
  on conflict (id) do nothing;

-- §5.4 companies
create table companies (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  name       text not null,
  type       company_type not null,
  created_at timestamptz not null default now()
);
create index companies_org_id_idx on companies (org_id);

-- §5.3 profiles (1:1 with auth.users; replaces mock User)
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  company_id  uuid references companies(id),
  full_name   text not null,
  email       text not null,
  avatar_url  text,
  role        user_role not null default 'Engineer',
  title       text,
  location    text,                          -- DE-O&G: free-text (baseline §8.1)
  skills      text[] not null default '{}',  -- DE-O&G: was certifications (baseline §8.1)
  utilization smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_org_id_idx on profiles (org_id);
create index profiles_company_id_idx on profiles (company_id);

-- §5.5 projects
create table projects (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  code               text,
  name               text not null,
  status             project_status not null default 'Leads',
  client_id          uuid references companies(id),
  project_manager_id uuid references profiles(id),
  contract_value     numeric(14,2) not null default 0,
  budget             numeric(14,2) not null default 0,  -- header budget; authority DEFERRED §14
  spent              numeric(14,2) not null default 0,  -- DEFERRED: stored vs derived §14
  start_date         date,
  end_date           date,
  last_update        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (org_id, code)
);
create index projects_org_id_idx on projects (org_id);
create index projects_org_status_idx on projects (org_id, status);
create index projects_pm_idx on projects (project_manager_id);
create index projects_client_idx on projects (client_id);

-- §5.6 procurement aggregate
create table procurements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  code            text,
  title           text not null,
  project_id      uuid references projects(id),
  requested_by_id uuid references profiles(id),
  status          procurement_status not null default 'Draft',
  total_value     numeric(14,2) not null default 0,
  vendor_id       uuid references companies(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, code)
);
create index procurements_org_id_idx on procurements (org_id);
create index procurements_org_status_idx on procurements (org_id, status);
create index procurements_project_idx on procurements (project_id);
create index procurements_requested_by_idx on procurements (requested_by_id);

create table procurement_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  name           text not null,
  description    text,
  quantity       numeric(14,2) not null default 0,
  rate           numeric(14,2) not null default 0,
  amount         numeric(14,2) generated always as (quantity * rate) stored
);
create index procurement_items_procurement_idx on procurement_items (procurement_id);

create table procurement_quotations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  vendor_id      uuid not null references companies(id),
  reference      text,
  total_amount   numeric(14,2) not null default 0,
  received_date  date,
  is_selected    boolean not null default false,
  file_url       text
);
create index procurement_quotations_procurement_idx on procurement_quotations (procurement_id);
create unique index procurement_quotations_one_selected_idx
  on procurement_quotations (procurement_id) where is_selected;

create table procurement_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  type             text not null,
  reference_number text,
  status           doc_status not null default 'Draft',
  date             date,
  link             text
);
create index procurement_documents_procurement_idx on procurement_documents (procurement_id);

-- §5.7 budget aggregate
create table budget_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid not null references projects(id) on delete cascade,
  version     int not null,
  name        text not null,
  status      budget_status not null default 'Draft',
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);
create index budget_versions_project_idx on budget_versions (project_id);
create unique index budget_versions_one_active_idx
  on budget_versions (project_id) where status = 'Active';

create table budget_line_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  budget_version_id uuid not null references budget_versions(id) on delete cascade,
  category          budget_category not null,
  description       text,
  budgeted_amount   numeric(14,2) not null default 0,
  actual_amount     numeric(14,2) not null default 0
);
create index budget_line_items_version_idx on budget_line_items (budget_version_id);

-- §5.8 timesheet aggregate
create table timesheets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  user_id         uuid not null references profiles(id),
  week_start_date date not null,
  status          timesheet_status not null default 'Draft',
  submitted_at    timestamptz,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  constraint week_is_monday check (extract(dow from week_start_date) = 1),
  unique (user_id, week_start_date)
);
create index timesheets_org_id_idx on timesheets (org_id);
create index timesheets_user_week_idx on timesheets (user_id, week_start_date);
create index timesheets_org_status_idx on timesheets (org_id, status);

create table timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  project_id   uuid not null references projects(id),
  entry_date   date not null,
  hours        numeric(5,2) not null default 0 check (hours >= 0 and hours <= 24),
  notes        text
);
create index timesheet_entries_timesheet_idx on timesheet_entries (timesheet_id);
create index timesheet_entries_project_idx on timesheet_entries (project_id);

-- §5.9 tasks + dependencies
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  start_date  date,
  end_date    date,
  assignee_id uuid references profiles(id),
  status      task_status not null default 'To Do',
  created_at  timestamptz not null default now()
);
create index tasks_project_idx on tasks (project_id);

create table task_dependencies (
  task_id       uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

-- §5.10 incident_reports (de-O&G; schema-only MVP)
create table incident_reports (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  incident_date date not null,
  type          text not null,
  severity      incident_severity not null,
  location      text,                 -- DE-O&G: free-text (baseline §8.1)
  description   text,
  status        incident_status not null default 'Open',
  reported_by   uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index incident_reports_org_id_idx on incident_reports (org_id);

-- §5.11 project_documents
create table project_documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id uuid not null references projects(id) on delete cascade,
  code       text,
  category   text not null,
  title      text not null,
  revision   text,
  status     doc_status not null default 'Draft',
  doc_date   date,
  author_id  uuid references profiles(id),
  file_path  text,
  created_at timestamptz not null default now()
);
create index project_documents_project_idx on project_documents (project_id);
