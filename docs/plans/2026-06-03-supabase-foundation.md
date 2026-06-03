# Implementation Plan — Issue #2: Supabase backend foundation (schema + RLS + org_id seam + seed)

> **Status:** Ready for build (TDD).
> **Spec:** `docs/specs/target-architecture.spec.md` §4.2, §5, §6, §8.4 (stubs), Phase 2 (§13);
> `docs/specs/baseline.spec.md` §4, §8.
> **ADRs:** 0001 (org_id seam), 0002 (Supabase), 0003 (data-access layer), 0006 (hosting — cloud deferred).
> **Scope:** local-dev only (Docker Supabase stack). Cloud project deferred to deploy time (ADR-0006).
> **Writes under:** `supabase/` (init, migrations, seed, tests) + exactly one file under `pmo-portal/`
> (`src/lib/db/types.ts`, generated). No app wiring, no auth, no data-access modules (later issues).
>
> **Charter lenses carried (Architecture / Existing-repo / Performance):** schema is minimal for one org
> yet partitioned by `org_id` for horizontal tenant scaling (ADR-0001); every hot-path FK indexed to kill
> the prototype's O(n) render-time joins (`F-7`/`NFR-004`); enums replace free-text status (`NFR-011`);
> migration is single forward file but fully re-runnable via `db reset` (the reversibility contract for a
> pre-production, never-deployed schema — see Decision D-4).

---

## 1. Design (brainstormed, one decision at a time)

### D-1 — Migration file layout: one schema migration + one RLS migration, plus seed
**Decision:** Three SQL artifacts under `supabase/`:
- `migrations/0001_init_schema.sql` — extensions, enums, all tables, indexes, partial unique indexes, the
  `DEFAULT_ORG_ID` mechanism.
- `migrations/0002_rls.sql` — `auth_org_id()`/`auth_role()` helpers, `enable row level security` + policies
  on every business table.
- `seed.sql` — one `organizations` row (the default-org id), 5 profiles, companies, projects, and one
  representative row per remaining table (generic professional-services, de-O&G'd).

**Why split schema vs RLS:** RLS is a distinct review surface (security-auditor reads `0002` in isolation);
keeping DDL and policy in separate files makes the security diff legible and lets the RLS migration be
re-authored without touching table shapes. Both are applied in lexical order by `supabase db reset`.

### D-2 — The `DEFAULT_ORG_ID` seam (how the single-org default is wired)
The spec's DDL writes `default <DEFAULT_ORG_ID>` as a placeholder. We make it real and non-spoofable:
- Seed the one org with a **fixed, hard-coded UUID literal** `00000000-0000-0000-0000-000000000001`
  (constant, so the column default and seed agree without a lookup).
- Every business table declares `org_id uuid not null references organizations(id) default
  '00000000-0000-0000-0000-000000000001'`.
- The org row itself is inserted by the **migration** (not only seed.sql), because the column default's FK
  target must exist before any insert — including seed inserts and app inserts on a fresh `db reset`. Seed
  data for the *other* tables lives in `seed.sql`; the canonical org and the two RLS-test orgs are created
  where each is needed (org row in `0001`; the second test-org is created inside the pgTAP test, not seeded
  into the app's seed.sql, so app seed stays single-tenant — see D-3).

This satisfies FR-RLS-003 / §6.4: the client never sends `org_id`; the default fills it; `with check
(org_id = auth_org_id())` rejects a spoofed differing value.

### D-3 — RLS proof mechanism: **pgTAP via `supabase test db`** (chosen)
**Decision: pgTAP** in `supabase/tests/`, run by `supabase test db`. Rationale vs the Vitest-two-clients
alternative:
- `auth_org_id()` resolves the caller's org from **`profiles.org_id` keyed on `auth.uid()`** (§6.2), not
  from a JWT claim. pgTAP can set the caller identity precisely with
  `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'` and `set local role
  authenticated`, then assert `select`/`insert` results under that identity — exercising the *real* policy
  path with no network and no JWT-secret minting.
- It runs **in-transaction and rolls back**, so it never pollutes seed data and is deterministic on every
  `db reset`.
- It is the Supabase-native RLS test surface; the security-auditor and CI can run `supabase test db` as one
  command. The Vitest approach would need to mint HS256 JWTs against the local stack's JWT secret, create
  `auth.users` rows via the admin API, and clean up across runs — more moving parts, more flake, and it
  tests the same predicate less directly.

The pgTAP test seeds **two orgs (A and B)** and **two profiles** (one per org) inside the test transaction,
then asserts: (a) a session as org-A's user reads only org-A rows; (b) the same session reading org-B rows
returns **0 rows** (isolation on SELECT); (c) an insert by org-A's user with a spoofed `org_id = B` is
**rejected** by `with check` (isolation on WRITE); (d) a coarse role gate (Engineer cannot write
`projects`) is enforced. This proves the seam works even though production seed is single-org.

### D-4 — Reversibility contract (charter Data/Schema DoD)
The schema has **never been deployed** (cloud deferred, ADR-0006), so there is no production state to
preserve. The reversibility requirement is satisfied by **`supabase db reset` being idempotent**: it drops
the local DB, replays `0001`→`0002`, then loads `seed.sql`, every time with zero errors. We do **not** ship
`down` migrations for a pre-production schema (they would be dead code). This is documented here as the
explicit DoD interpretation; once the schema is deployed to a shared/cloud env, subsequent issues MUST ship
forward-only additive migrations with documented rollback. **Irreversible-step note:** none in this issue
(no data backfill, no destructive ALTER) — the whole migration is create-only.

### D-5 — Coarse RLS now, full matrices deferred
Per §6.3 the full role×status authorization matrices are DEFERRED to module specs. This issue implements:
- **Org isolation** on every table (`org_id = auth_org_id()` on USING and WITH CHECK) — FR-RLS-002/003.
- **Coarse role gates** matching §6.3 intent: read-in-org for all authenticated; writes for
  `Admin/Executive/Project Manager/Finance` on projects/companies/budgets/tasks/documents; member-insert on
  procurements + incidents; own-row writes on profiles/timesheets. Each policy carries an inline
  `-- DEFERRED §14:` comment naming the module spec that will tighten it.

### D-6 — Generated types path
The issue brief mandates `pmo-portal/src/lib/db/types.ts`. The target-arch spec §3.1 illustrates
`src/lib/supabase/database.types.ts`. **Follow the issue brief** (`src/lib/db/types.ts`) and record the path
divergence as an open question for the Director (see §6). This is the only `pmo-portal/` file this issue
adds; no `client.ts`, no db modules, no imports — so typecheck must pass with an unreferenced generated file.

### Error handling / edge cases in scope
- FK ordering: `companies` referenced by `profiles.company_id` and `projects.client_id`; `profiles`
  referenced by many. Resolve by creating `organizations` → `companies` → `profiles` → `projects` → rest,
  OR create all tables then add the `profiles.company_id` FK last. **Chosen:** declare tables in dependency
  order; the one cycle (`profiles.company_id → companies` while nothing in `companies` needs `profiles`) has
  no true cycle, so plain ordering works (companies before profiles).
- `procurement_items.amount` is a generated stored column — never inserted by seed.
- `timesheets.week_is_monday` CHECK: seed week_start_date must be a Monday.
- Partial unique indexes (one Active budget/project, one selected quote/procurement) must not be violated by
  seed.

### Testing approach
- **RED first:** write the pgTAP RLS test before `0002_rls.sql` exists (it will fail because RLS is off /
  policies absent), then make it green.
- A second pgTAP test asserts **every business table has `rowsecurity = true`** by enumerating `pg_tables`.
- Typecheck gate covers the generated types file.

---

## 2. Recommended issue split

**Recommendation: keep as ONE issue** (do not split). Rationale: the RLS proof (D-3) is meaningless without
the schema, the schema is incomplete without RLS per the DoD, and the types-gen is a 2-task tail. Splitting
would create three PRs that cannot be independently accepted (2b's test needs 2a's tables; 2c's typecheck
needs 2a's schema). The task list below is sequenced so that if the Director *does* want checkpoints, the
natural cut points are after Task 9 (schema applies clean), after Task 18 (RLS proven), and after Task 21
(types green) — but they ship together as one PR per the one-PR-per-issue policy.

---

## 3. Acceptance criteria (this issue)

| AC | Given / When / Then |
|---|---|
| **AC-100** | Given a clean checkout with Docker running, When `supabase start` runs, Then the local stack comes up and applies `0001`+`0002` with zero errors. |
| **AC-101** | Given the running stack, When `supabase db reset` runs, Then it drops, replays both migrations, and loads `seed.sql` with zero errors and a single seeded org. |
| **AC-102** | Given the seeded schema, When the pgTAP RLS test runs under `supabase test db`, Then a session scoped to org A reads only org-A rows and reading org-B rows returns 0 rows (tenant isolation on SELECT). |
| **AC-103** | Given the seeded schema, When org-A's user attempts an insert carrying `org_id = <org B>`, Then RLS `with check` rejects it (tenant isolation on WRITE; the org_id seam is not client-spoofable). |
| **AC-104** | Given the seeded schema, When a user whose role is `Engineer` attempts to write a `projects` row, Then the RLS write policy rejects it (coarse role gate). |
| **AC-105** | Given the migrations applied, When a test enumerates `pg_tables` for the business tables, Then `rowsecurity = true` for every one of them. |
| **AC-106** | Given the running stack, When `supabase gen types typescript` runs, Then it writes `pmo-portal/src/lib/db/types.ts` and `npm run typecheck` reports zero errors. |
| **AC-107** | Given the schema, When `0001` is inspected, Then every business table has a non-null `org_id` FK to `organizations(id)` defaulted to the seeded org id (FR-DB-001 / FR-RLS-002). |
| **AC-108** | Given a project with two budget versions, When a second version is set `Active`, Then the partial unique index forbids two `Active` versions per project (FR-DB-005); likewise at most one selected quote per procurement (FR-DB-006). |

Each `e2e/`-style acceptance for this backend issue is realized as a **pgTAP test** (`supabase/tests/*.sql`)
or a **CLI verification command**, not a Playwright spec (there is no UI in this issue). The AC→test mapping
is in each task's Verify line.

---

## 4. Tasks (2–5 min each; exact paths, SQL, commands)

> Run all `supabase` commands from the **repo root** `/Users/ariefsaid/Coding/PMO`. If the `supabase`
> binary is not on PATH, substitute `npx supabase` for every `supabase` below.

### Task 0 — Verify the Supabase CLI + Docker are available `[AC-100 precondition]`
No file change. Confirm tooling before authoring.
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase --version && docker info >/dev/null 2>&1 && echo OK
```
Expect a version string and `OK`. If `supabase` is missing, use `npx supabase --version`.

### Task 1 — Initialize Supabase config `[AC-100]`
Run `supabase init` at repo root to create `supabase/config.toml` (and `supabase/.gitignore`).
**Command:**
```
cd /Users/ariefsaid/Coding/PMO && supabase init
```
Then open `supabase/config.toml` and confirm `[db] major_version = 15` (or 17, whatever the CLI defaults to —
record it). Set `project_id = "pmo-portal"` if prompted/blank.
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && test -f supabase/config.toml && echo OK
```

### Task 2 — Add repo-root `.gitignore` entries for Supabase local volumes `[hygiene]`
Edit `/Users/ariefsaid/Coding/PMO/supabase/.gitignore` (created by `init`) and ensure it contains:
```
# Supabase
.branches
.temp
.env
```
If `supabase init` already wrote these, leave as-is. Do not ignore `migrations/`, `seed.sql`, or `tests/`.
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q ".temp" supabase/.gitignore && echo OK
```

### Task 3 — Create the schema migration: extensions + enums `[AC-100, AC-107]`
Create `/Users/ariefsaid/Coding/PMO/supabase/migrations/0001_init_schema.sql` starting with:
```sql
-- 0001_init_schema.sql — PMO Portal schema (target-architecture.spec.md §5, de-O&G'd).
-- Single forward migration; re-runnable via `supabase db reset` (plan D-4). Create-only, no destructive steps.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Enums (spec §5.1; de-O&G: incident_* not HSE)
create type user_role         as enum ('Executive','Project Manager','Finance','Engineer','Admin');
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
```
**Verify:** (deferred to Task 9 first full apply.) For now:
```
cd /Users/ariefsaid/Coding/PMO && grep -c "create type" supabase/migrations/0001_init_schema.sql
```
Expect `11`.

### Task 4 — Append `organizations` + seed the default org id `[AC-101, AC-107]`
Append to `0001_init_schema.sql`:
```sql
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
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "00000000-0000-0000-0000-000000000001" supabase/migrations/0001_init_schema.sql && echo OK
```

### Task 5 — Append `companies` + `profiles` (FK order: companies before profiles) `[AC-107]`
Append to `0001_init_schema.sql`:
```sql
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
  location    text,                 -- DE-O&G: free-text (baseline §8.1)
  skills      text[] not null default '{}',  -- DE-O&G: was certifications (baseline §8.1)
  utilization smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_org_id_idx on profiles (org_id);
create index profiles_company_id_idx on profiles (company_id);
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "references auth.users(id)" supabase/migrations/0001_init_schema.sql && echo OK
```

### Task 6 — Append `projects` + indexes `[AC-107, FR-DB-004]`
Append to `0001_init_schema.sql`:
```sql
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
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "projects_org_status_idx" supabase/migrations/0001_init_schema.sql && echo OK
```

### Task 7 — Append procurement aggregate (4 tables + partial unique index) `[AC-107, AC-108, FR-DB-006]`
Append to `0001_init_schema.sql`:
```sql
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
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "procurement_quotations_one_selected_idx" supabase/migrations/0001_init_schema.sql && echo OK
```

### Task 8 — Append budget + timesheet + tasks + incident + project_documents `[AC-107, AC-108, FR-DB-005]`
Append to `0001_init_schema.sql`:
```sql
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
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "budget_versions_one_active_idx" supabase/migrations/0001_init_schema.sql && grep -q "week_is_monday" supabase/migrations/0001_init_schema.sql && echo OK
```

### Task 9 — First full apply: `supabase start` `[AC-100]`
Bring up the local stack; it applies `0001` (no RLS yet).
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase start
```
Expect "Started supabase local development setup" with no SQL errors. If a migration error appears, fix the
offending DDL in `0001` and re-run `supabase db reset` (Task does not advance until this is clean).
**AC-100 covered** (schema half; RLS migration added next).

### Task 10 — Confirm `db reset` re-applies schema cleanly `[AC-101]`
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase db reset
```
Expect "Applying migration 0001_init_schema.sql..." then "Seeding data..." (seed is empty/absent until
Task 17) with zero errors. Confirm exactly one org:
```
cd /Users/ariefsaid/Coding/PMO && supabase db reset && echo '\n--- org count ---' && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "select count(*) from organizations;"
```
Expect `1`. (If `psql` is unavailable, use `supabase db reset` clean exit as the gate and defer the count to
the pgTAP test in Task 16.)

### Task 11 — Write the RLS helpers migration (header + helpers) `[AC-102, AC-103]`
Create `/Users/ariefsaid/Coding/PMO/supabase/migrations/0002_rls.sql`:
```sql
-- 0002_rls.sql — RLS helpers + per-table policies (target-architecture.spec.md §6).
-- Coarse role gates now; full role×status matrices DEFERRED to module specs (plan D-5, spec §14).

-- §6.2 caller's org (MVP: from profiles; later: from JWT app_metadata.org_id — spec §6.5)
create or replace function auth_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

-- §6.2 caller's role: JWT claim first, fall back to profiles.role
create or replace function auth_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role','')::user_role,
    (select role from profiles where id = auth.uid()))
$$;
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "function auth_org_id" supabase/migrations/0002_rls.sql && grep -q "function auth_role" supabase/migrations/0002_rls.sql && echo OK
```
> Note: `security definer` + `set search_path` on the helpers prevents the policy predicate from recursing
> into RLS on `profiles` and pins the schema (injection-hardening the security-auditor will check).

### Task 12 — Enable RLS + write profiles & organizations policies `[AC-104, AC-105]`
Append to `0002_rls.sql`:
```sql
alter table organizations enable row level security;
-- read your own org only; no client writes to organizations in MVP (provisioning DEFERRED §6.5)
create policy organizations_select on organizations for select
  using (id = auth_org_id());

alter table profiles enable row level security;
-- read profiles in your org; update your own row; Admin updates any in org. Role-change scope DEFERRED §14.
create policy profiles_select on profiles for select
  using (org_id = auth_org_id());
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (org_id = auth_org_id());
create policy profiles_admin_write on profiles for all
  using (org_id = auth_org_id() and auth_role() = 'Admin')
  with check (org_id = auth_org_id());
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "profiles enable row level security" supabase/migrations/0002_rls.sql && echo OK
```

### Task 13 — Policies for projects/companies/budgets/tasks/project_documents (read-in-org; write Admin/Exec/PM/Finance) `[AC-104]`
Append to `0002_rls.sql`:
```sql
-- Shared coarse write gate: org-mutating roles. Finance scope to budgets DEFERRED to Budget module spec §14.
-- Engineer is read-only here except own task status DEFERRED to Schedule module spec §14.
alter table companies enable row level security;
create policy companies_select on companies for select using (org_id = auth_org_id());
create policy companies_write on companies for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table projects enable row level security;
create policy projects_select on projects for select using (org_id = auth_org_id());
create policy projects_write on projects for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table budget_versions enable row level security;
create policy budget_versions_select on budget_versions for select using (org_id = auth_org_id());
create policy budget_versions_write on budget_versions for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table budget_line_items enable row level security;
create policy budget_line_items_select on budget_line_items for select using (org_id = auth_org_id());
create policy budget_line_items_write on budget_line_items for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table tasks enable row level security;
create policy tasks_select on tasks for select using (org_id = auth_org_id());
create policy tasks_write on tasks for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table task_dependencies enable row level security;
create policy task_dependencies_select on task_dependencies for select using (org_id = auth_org_id());
create policy task_dependencies_write on task_dependencies for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table project_documents enable row level security;
create policy project_documents_select on project_documents for select using (org_id = auth_org_id());
create policy project_documents_write on project_documents for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -c "for all" supabase/migrations/0002_rls.sql
```
Expect at least `6` here (plus profiles_admin_write from Task 12 = 7+ total at this point).

### Task 14 — Policies for procurement aggregate (read-in-org; member insert; transitions via RPC DEFERRED) `[AC-103, AC-105]`
Append to `0002_rls.sql`:
```sql
-- procurements + children: read in org; any member may insert (raise a request).
-- Status transitions go through RPC (spec §8.4) authored in the Procurement module — full matrix DEFERRED §14.
alter table procurements enable row level security;
create policy procurements_select on procurements for select using (org_id = auth_org_id());
create policy procurements_insert on procurements for insert with check (org_id = auth_org_id());
create policy procurements_update on procurements for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table procurement_items enable row level security;
create policy procurement_items_select on procurement_items for select using (org_id = auth_org_id());
create policy procurement_items_write on procurement_items for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table procurement_quotations enable row level security;
create policy procurement_quotations_select on procurement_quotations for select using (org_id = auth_org_id());
create policy procurement_quotations_write on procurement_quotations for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());

alter table procurement_documents enable row level security;
create policy procurement_documents_select on procurement_documents for select using (org_id = auth_org_id());
create policy procurement_documents_write on procurement_documents for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "procurements_insert" supabase/migrations/0002_rls.sql && echo OK
```

### Task 15 — Policies for timesheets + entries + incident_reports `[AC-105]`
Append to `0002_rls.sql`:
```sql
-- timesheets: own rows readable/writable while Draft; managers read submitted (rule DEFERRED §14);
-- approve/reject via RPC (spec §8.4). MVP coarse gate: own-row writes + read-in-org.
alter table timesheets enable row level security;
create policy timesheets_select on timesheets for select
  using (org_id = auth_org_id() and (user_id = auth.uid()
         or auth_role() in ('Admin','Executive','Project Manager','Finance')));
create policy timesheets_insert on timesheets for insert
  with check (org_id = auth_org_id() and user_id = auth.uid());
create policy timesheets_update_own on timesheets for update
  using (org_id = auth_org_id() and user_id = auth.uid() and status = 'Draft')
  with check (org_id = auth_org_id() and user_id = auth.uid());

alter table timesheet_entries enable row level security;
create policy timesheet_entries_select on timesheet_entries for select
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and (t.user_id = auth.uid() or auth_role() in ('Admin','Executive','Project Manager','Finance'))));
create policy timesheet_entries_write on timesheet_entries for all
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft'))
  with check (org_id = auth_org_id());

-- incident_reports: read in org; any member may insert (schema-only MVP).
alter table incident_reports enable row level security;
create policy incident_reports_select on incident_reports for select using (org_id = auth_org_id());
create policy incident_reports_insert on incident_reports for insert with check (org_id = auth_org_id());
create policy incident_reports_update on incident_reports for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "timesheets_update_own" supabase/migrations/0002_rls.sql && echo OK
```

### Task 16 — RED: write the pgTAP "every business table has RLS" test `[AC-105]`
Create `/Users/ariefsaid/Coding/PMO/supabase/tests/0001_rls_enabled.test.sql`:
```sql
begin;
select plan(16);

-- AC-105: every business table has rowsecurity = true.
select results_eq(
  $$ select tablename from pg_tables
     where schemaname = 'public'
       and tablename = any (array[
         'organizations','profiles','companies','projects','procurements','procurement_items',
         'procurement_quotations','procurement_documents','budget_versions','budget_line_items',
         'timesheets','timesheet_entries','tasks','task_dependencies','incident_reports','project_documents'])
       and rowsecurity = true
     order by tablename $$,
  $$ select unnest(array[
         'budget_line_items','budget_versions','companies','incident_reports','organizations',
         'procurement_documents','procurement_items','procurement_quotations','procurements',
         'profiles','project_documents','projects','task_dependencies','tasks',
         'timesheet_entries','timesheets']) order by 1 $$,
  'RLS enabled on all 16 business tables');

select * from finished();
rollback;
```
**Verify (must FAIL before 0002 is applied — RED):** run after a reset that applies only 0001 (temporarily),
or simply confirm the file is authored and run the full suite in Task 18.
```
cd /Users/ariefsaid/Coding/PMO && test -f supabase/tests/0001_rls_enabled.test.sql && echo OK
```
> `plan(16)` covers the single `results_eq` plus headroom; adjust the count to match actual `select`s when
> authored (one `results_eq` → `plan(1)`; keep it `plan(1)` if only this assertion exists).

### Task 17 — RED: write the pgTAP tenant-isolation + role-gate test `[AC-102, AC-103, AC-104]`
Create `/Users/ariefsaid/Coding/PMO/supabase/tests/0002_tenant_isolation.test.sql`:
```sql
begin;
select plan(5);

-- Seed two orgs + two auth users + two profiles inside the test txn (rolled back at end).
insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Org B');

-- minimal auth.users rows so profiles FK + auth.uid() resolve
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','a@example.com'),
  ('b0000000-0000-0000-0000-0000000000b1','b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','User A','a@example.com','Project Manager'),
  ('b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000002','User B','b@example.com','Engineer');

-- a project in each org (insert as table owner, bypassing RLS, to set up fixtures)
insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A','Ongoing Project'),
  ('b1111111-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Project B','Ongoing Project');

-- Become org-A's authenticated user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-102: org A sees only org-A projects.
select is(
  (select count(*)::int from projects where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'AC-102: org A reads its own project');
select is(
  (select count(*)::int from projects where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'AC-102: org A cannot read org B rows (SELECT isolation)');

-- AC-103: org A cannot insert a row stamped with org B (with check rejects).
select throws_ok(
  $$ insert into projects (org_id, name, status)
     values ('bbbbbbbb-0000-0000-0000-000000000002','Spoofed','Leads') $$,
  '42501',
  'new row violates row-level security policy for table "projects"',
  'AC-103: org A cannot insert spoofed org_id (WRITE isolation)');

-- AC-103b: insert WITHOUT org_id uses the column default; but default is the canonical org, not A.
-- A PM in org A inserting via default org would be cross-org; assert default-org insert is rejected for A.
select throws_ok(
  $$ insert into projects (name, status) values ('Default-org insert','Leads') $$,
  '42501', null,
  'AC-103: default org_id differs from caller org A -> rejected by with check');

reset role;
-- AC-104: Engineer (org B user) cannot write projects.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ insert into projects (name, status) values ('Eng tries','Leads') $$,
  '42501', null,
  'AC-104: Engineer role cannot write projects');

select * from finished();
rollback;
```
**Verify (RED):**
```
cd /Users/ariefsaid/Coding/PMO && test -f supabase/tests/0002_tenant_isolation.test.sql && echo OK
```
> Implementer note: confirm the exact SQLSTATE/message PostgREST-RLS raises in the running PG version; if
> the message text differs, relax `throws_ok` to match on SQLSTATE `42501` only (pass `null` for the message
> arg as shown in the default-org cases). The AC-103b default-org assertion documents D-2: the column default
> is the *canonical* org, so an org-A caller relying on the default is correctly blocked — the seam forces
> writes through the data-access layer that sets the caller's own org context in the multi-tenant flip.

### Task 18 — GREEN: apply RLS migration + run the full pgTAP suite `[AC-102, AC-103, AC-104, AC-105]`
Reset (applies `0001`+`0002`+seed) then run tests.
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase db reset && supabase test db
```
Expect both test files to report `ok` for every assertion and a passing summary. If `auth_org_id()` recurses
or a policy is missing, fix `0002` and re-run. **AC-102/103/104/105 covered.**

### Task 19 — Write the seed (org-scoped, de-O&G, mirrors mockData shape) `[AC-101]`
Create `/Users/ariefsaid/Coding/PMO/supabase/seed.sql`. The default org already exists (inserted by
`0001`); seed the rest into that org. Use deterministic UUID literals. Generic professional-services data:
```sql
-- seed.sql — single-tenant, generic professional-services seed (de-O&G'd, baseline §8).
-- The default org ('00000000-...-001') is created by migration 0001; do not re-insert it.

-- companies
insert into companies (id, name, type) values
  ('c0000000-0000-0000-0000-000000000001','Acme Consulting Group','Internal'),
  ('c0000000-0000-0000-0000-000000000002','Innovate Corp','Client'),
  ('c0000000-0000-0000-0000-000000000003','Northwind Manufacturing','Client'),
  ('c0000000-0000-0000-0000-000000000004','Apex Supplies Ltd','Vendor'),
  ('c0000000-0000-0000-0000-000000000005','Synergy Logistics','Vendor');

-- auth users (local-dev only) so profiles FK resolves and the app has login-able accounts later
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','exec@acme.test'),
  ('00000000-0000-0000-0000-0000000000a2','pm@acme.test'),
  ('00000000-0000-0000-0000-0000000000a3','finance@acme.test'),
  ('00000000-0000-0000-0000-0000000000a4','engineer@acme.test'),
  ('00000000-0000-0000-0000-0000000000a5','admin@acme.test')
on conflict (id) do nothing;

-- profiles (5 roles incl. Admin super-user); skills = neutral creds; location = free-text
insert into profiles (id, company_id, full_name, email, role, title, location, skills, utilization) values
  ('00000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-000000000001','Bob Director','exec@acme.test','Executive','Managing Director','HQ','{"PMP"}',60),
  ('00000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-000000000001','Alice Manager','pm@acme.test','Project Manager','Senior PM','HQ','{"PMP","PMI-SP"}',85),
  ('00000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-000000000001','Carol Finance','finance@acme.test','Finance','Finance Lead','HQ','{"CPA"}',75),
  ('00000000-0000-0000-0000-0000000000a4','c0000000-0000-0000-0000-000000000001','Dave Engineer','engineer@acme.test','Engineer','Project Engineer','Regional Site B','{"PE"}',90),
  ('00000000-0000-0000-0000-0000000000a5','c0000000-0000-0000-0000-000000000001','Erin Admin','admin@acme.test','Admin','System Administrator','HQ','{}',10);

-- projects (neutral names; PM = Alice; client = Innovate Corp)
insert into projects (id, code, name, status, client_id, project_manager_id, contract_value, budget, spent, start_date, end_date) values
  ('40000000-0000-0000-0000-000000000001','P001','Innovate Corp HQ Fit-Out','Ongoing Project','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',5000000,4700000,2100000,'2026-01-06','2026-12-18'),
  ('40000000-0000-0000-0000-000000000002','P002','Northwind ERP Rollout','Tender Submitted','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',1200000,0,0,null,null),
  ('40000000-0000-0000-0000-000000000003','P010','Regional Services Program','PQ Submitted','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',800000,0,0,null,null);

-- budget versions: exactly one Active per project (satisfies partial unique index)
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,'Revised Budget','Active');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000002','Labor','Project team',2000000,1200000),
  ('50000000-0000-0000-0000-000000000002','Materials','Fit-out materials',1700000,900000),
  ('50000000-0000-0000-0000-000000000002','Contingency','Reserve',1000000,0);

-- procurement (Vendor Quoted) + items + quotations (one selected) + document
insert into procurements (id, code, title, project_id, requested_by_id, status, total_value, vendor_id) values
  ('60000000-0000-0000-0000-000000000001','PROC-2026-004','Workstations & AV','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Vendor Quoted',150000,null);
insert into procurement_items (procurement_id, name, description, quantity, rate) values
  ('60000000-0000-0000-0000-000000000001','Workstation','Desk + chair',50,1500),
  ('60000000-0000-0000-0000-000000000001','AV unit','Conference AV',5,15000);
insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected) values
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','APX-Q-101',152000,'2026-02-10',false),
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','SYN-Q-220',148000,'2026-02-11',false);
insert into procurement_documents (procurement_id, type, reference_number, status, date) values
  ('60000000-0000-0000-0000-000000000001','RFQ','RFQ-2026-004','Issued','2026-02-05');

-- timesheet (Monday week_start) + entries
insert into timesheets (id, user_id, week_start_date, status) values
  ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4','2026-06-01','Draft');  -- 2026-06-01 is a Monday
insert into timesheet_entries (timesheet_id, project_id, entry_date, hours, notes) values
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-01',8,'Site coordination'),
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-02',8,'Drawings review');

-- tasks + one dependency
insert into tasks (id, project_id, name, start_date, end_date, assignee_id, status) values
  ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Demolition','2026-01-06','2026-02-06','00000000-0000-0000-0000-0000000000a4','Done'),
  ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Fit-out','2026-02-09','2026-06-30','00000000-0000-0000-0000-0000000000a4','In Progress');
insert into task_dependencies (task_id, depends_on_id) values
  ('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001');

-- incident report (neutral; schema-only MVP)
insert into incident_reports (incident_date, type, severity, location, description, status, reported_by) values
  ('2026-03-15','Near Miss','Low','Regional Site B','Trip hazard reported and cleared','Closed','00000000-0000-0000-0000-0000000000a4');

-- project document
insert into project_documents (project_id, code, category, title, revision, status, doc_date, author_id) values
  ('40000000-0000-0000-0000-000000000001','DOC-001','Drawing','Floor Plan Rev B','B','Issued','2026-01-20','00000000-0000-0000-0000-0000000000a2');
```
**Verify (defer to Task 20 reset).** For now confirm Monday + de-O&G:
```
cd /Users/ariefsaid/Coding/PMO && grep -q "2026-06-01" supabase/seed.sql && ! grep -iq "offshore\|BOSIET\|H2S\|HSE" supabase/seed.sql && echo OK
```

### Task 20 — Full reset with seed: prove `db reset` + seed loads clean `[AC-101, AC-108]`
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase db reset
```
Expect "Seeding data..." with zero errors. The seed exercises both partial unique indexes (one Active budget
version per project; quotations with `is_selected=false` — no conflict). **AC-101 covered; AC-108** is
proven structurally by the indexes (Task 7/8) + the negative pgTAP case below.
Optionally extend `supabase/tests/0001_rls_enabled.test.sql` with two `throws_ok` asserting a second
`Active` budget version and a second selected quote both raise `unique_violation` — if added, bump `plan()`.

### Task 21 — Generate typed DB types into `pmo-portal/src/lib/db/types.ts` `[AC-106]`
Create the dir if absent, then generate from the running local stack.
**Command:**
```
cd /Users/ariefsaid/Coding/PMO && mkdir -p pmo-portal/src/lib/db && supabase gen types typescript --local > pmo-portal/src/lib/db/types.ts
```
**Verify:**
```
cd /Users/ariefsaid/Coding/PMO && grep -q "export type Database" pmo-portal/src/lib/db/types.ts && grep -q "procurement_quotations" pmo-portal/src/lib/db/types.ts && echo OK
```

### Task 22 — Confirm typecheck stays green `[AC-106]`
The generated file is self-contained and unreferenced (no app wiring this issue), but must compile under the
project's tsconfig.
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO/pmo-portal && npm run typecheck
```
Expect zero errors. If tsc flags the generated file (e.g. `--isolatedModules` re-export), the implementer
adds the minimal tsconfig include/exclude — but per scope-OUT, do NOT wire it into app code.

### Task 23 — Stop the stack (clean local state) `[hygiene]`
**Command / Verify:**
```
cd /Users/ariefsaid/Coding/PMO && supabase stop
```
Expect "Stopped supabase local development setup". (Optional; CI uses `start`/`db reset`/`test db`/`stop`.)

---

## 5. Task → AC traceability matrix

| Task | AC(s) | Notes |
|---|---|---|
| 0 | AC-100 (pre) | tooling check |
| 1, 2 | AC-100 | init + ignore |
| 3 | AC-100, AC-107 | enums |
| 4 | AC-101, AC-107 | org + default-id seam |
| 5 | AC-107 | companies, profiles |
| 6 | AC-107, FR-DB-004 | projects + indexes |
| 7 | AC-107, AC-108, FR-DB-006 | procurement + one-selected-quote index |
| 8 | AC-107, AC-108, FR-DB-005 | budgets/timesheets/tasks/incidents/docs + one-Active index + Monday CHECK |
| 9 | AC-100 | first apply |
| 10 | AC-101 | reset re-applies schema |
| 11 | AC-102, AC-103 | RLS helpers |
| 12 | AC-104, AC-105 | profiles/orgs policies + enable RLS |
| 13 | AC-104 | projects/companies/budgets/tasks/docs policies |
| 14 | AC-103, AC-105 | procurement policies |
| 15 | AC-105 | timesheets/incidents policies |
| 16 | AC-105 | RED: all-tables-RLS pgTAP |
| 17 | AC-102, AC-103, AC-104 | RED: tenant-isolation + role-gate pgTAP |
| 18 | AC-102, AC-103, AC-104, AC-105 | GREEN: apply RLS + run suite |
| 19 | AC-101 | seed |
| 20 | AC-101, AC-108 | reset + seed clean; index invariants |
| 21 | AC-106 | gen types |
| 22 | AC-106 | typecheck green |
| 23 | — | stop stack |

**Every business table referenced (FR-DB-001 / FR-RLS-001 coverage):** organizations, profiles, companies,
projects, procurements, procurement_items, procurement_quotations, procurement_documents, budget_versions,
budget_line_items, timesheets, timesheet_entries, tasks, task_dependencies, incident_reports,
project_documents (16 tables — all carry `org_id` default + RLS enable + policies).

---

## 6. Open questions for the Director

1. **Generated-types path conflict.** Issue brief mandates `pmo-portal/src/lib/db/types.ts`; target-arch
   spec §3.1 and ADR-0003 reference `src/lib/supabase/database.types.ts`. The plan follows the issue brief.
   Confirm the canonical path so the next issue's `client.ts`/db modules import the right file (and update
   the spec/ADR if `db/types.ts` wins).
2. **`auth.users` seeding in `seed.sql`.** The seed inserts bare `auth.users` rows (id+email) so `profiles`
   FK resolves on `db reset`. These are not login-able (no encrypted password / GoTrue identity). Acceptable
   for this schema-only issue, or should the next (Auth) issue own real credentialed users and this seed only
   create orgs/companies? Recommendation: keep the bare rows now (gives parity data), let the Auth issue
   replace them with proper GoTrue users.
3. **pgTAP availability.** `supabase test db` requires the `pgtap` extension in the local image (standard in
   recent CLI images). If the installed image lacks it, fallback is a `0000_test_helpers` migration that
   `create extension if not exists pgtap;` — confirm whether the implementer may add that extension-enabling
   migration (it would also need to exist on cloud later, so flagging now).
4. **No `down` migrations (D-4).** Confirm the DoD "reversible" is satisfied by idempotent `db reset` for a
   never-deployed schema. Once deployed, future issues ship forward-only additive migrations.
5. **Coarse role gates (D-5).** Confirm it is acceptable that Engineer is globally read-only on
   projects/budgets/etc. this issue, with own-task-status and the full procurement/timesheet matrices
   DEFERRED to module specs — the policies carry inline `-- DEFERRED §14:` markers.

No blocking questions — the build can proceed on the recommendations above; the Director's answers refine
seed/test details, not the schema shape.
