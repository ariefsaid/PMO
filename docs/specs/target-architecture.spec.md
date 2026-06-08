# Target-Architecture Specification: PMO Portal (TO-BE)

> **Status:** TO-BE target-architecture spec. Design only — no production code is changed by this
> document. Companion to the AS-IS `docs/specs/baseline.spec.md`; cite `OBS-*` / `NFR-*` / `F-*` / `§`
> references from the baseline where they motivate a decision.
> Conforms to house conventions (`CLAUDE.md`, `docs/product-expectations.md`): EARS for requirements,
> `FR-###` / `NFR-###` / `AC-###` IDs, Given/When/Then for acceptance criteria.
>
> **Locked decisions honored verbatim:** Supabase backend; keep the Vite + React 19 SPA (no separate
> API server for MVP); single-tenant MVP with a forward-compatible `org_id` seam on every business
> table; 5 roles via a role claim + RLS; domain generalized off oil & gas (`IncidentReport`, free-text
> location/skills, generic professional-services seed); MVP modules = Auth + Projects + Procurement +
> Timesheets + Executive Dashboard (others stay placeholders); real Tailwind via `@tailwindcss/vite`;
> typed data-access layer under `pmo-portal/src/lib/db/*`.
>
> **Assumptions are flagged `[ASSUMPTION]`.** Module-detail decisions are explicitly **DEFERRED** to
> their module specs in §14.

---

## 1. Overview & goals

The baseline (`baseline.spec.md §1`) is a **frontend-only prototype**: hard-coded mock data, no backend,
no persistence, mock role-simulation auth (`OBS-AUTH-004`), no tenancy seam (`NFR-003`), un-shippable
lint (`NFR-010`), and an 804 KB single bundle (`NFR-004`). This spec defines the **TO-BE** target: a
production-grade SaaS MVP that is **minimal for one client but architected to scale to millions of
users**, matching the charter (`product-expectations.md` Part A — Architecture: "build the minimal
implementation that could realistically scale").

### 1.1 Goals (tie to charter)
- **G-1 Durable, multi-user, secure.** Replace in-memory mock state with Supabase Postgres + Auth + RLS;
  no client-bypassable authorization (resolves `F-2`, `NFR-001/002`).
- **G-2 Tenancy-ready without a rewrite.** `org_id` on every business table, defaulted to one org now,
  flips to B2B multi-tenant later (resolves `NFR-003`; ADR-0001).
- **G-3 Industry-neutral domain.** De-oil-&-gas the model per `baseline §8` (`IncidentReport`, free-text
  location/skills, generic professional-services seed).
- **G-4 Maintainable, decomposed frontend.** Break the 1390-line `ProjectDetails` god-file (`F-5`),
  centralize duplicated logic (`F-6`), kill `O(n)` render-time joins (`F-7`).
- **G-5 Fast.** Route-level code-splitting + lazy charts to break the single bundle (`F-3`, `NFR-004`).
- **G-6 Production hygiene.** Real Tailwind build (`F-12`), green lint/typecheck, BDD `AC-###` coverage.

### 1.2 Non-goals (MVP)
- No separate API/backend server (SPA → Supabase directly via RLS-protected typed client; §2.4 marks
  where an edge layer slots in later).
- No B2B multi-tenant onboarding UI, billing, SSO/SAML, or org self-service (seam only — ADR-0001).
- Tasks/Schedule, Companies, Work Orders, Reports, Administration, Incident register UI stay
  **placeholders** beyond the schema seam (`baseline §5.10`). `[ASSUMPTION]` Incident register is
  schema-only in MVP (deferred per `baseline §10`).

### 1.3 Scale posture
Minimal-but-scalable: a single Supabase project, single default org, RLS by user/role. The seams that
let it scale 1000× without a rewrite are: `org_id` on every table (horizontal tenant partitioning),
indexed FKs (kills `O(n)` joins), a typed data-access layer (swap transport without touching
components), and a place for an edge-function layer (secrets, webhooks, heavy transactions).

---

## 2. System architecture

### 2.1 Text diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser — Vite + React 19 SPA (BrowserRouter)                         │
│                                                                       │
│  Pages (route-lazy) ── Feature components ── Shared UI library        │
│        │                                                              │
│        │ calls typed hooks (TanStack Query)                           │
│        ▼                                                              │
│  src/lib/db/*  ── typed data-access layer (one module per aggregate)  │
│        │           ── TENANCY SEAM lives here (org_id injection)      │
│        ▼                                                              │
│  src/lib/supabase  ── singleton supabase-js client (anon key + JWT)   │
└────────────────────────────────┬──────────────────────────────────────┘
                                  │ HTTPS (PostgREST / GoTrue / Storage)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Supabase (managed)                                                    │
│  • Auth (GoTrue): email/password + magic link → JWT w/ role claim     │
│  • PostgREST: auto REST over Postgres, RLS-enforced                   │
│  • Postgres: schema + ENUMS + RLS policies + views/RPC for KPIs       │
│  • Storage: procurement/project document files (RLS-scoped buckets)   │
│                                                                       │
│  ▼ [FUTURE — not MVP] Edge Functions (Deno): secrets, webhooks,       │
│     multi-step transactions, server-side PDF, scheduled jobs          │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Client/server boundary
The **client boundary** is `src/lib/supabase` (the only place that holds the supabase-js client and the
anon key). Everything above it is UI; everything below it is enforced by Postgres RLS. The anon key is
**public by design** — security is RLS, not key secrecy (ADR-0002). No service-role key ever reaches the
browser.

### 2.3 Auth/session → role claim → data-access → RLS (request path)
1. User authenticates via Supabase Auth (email/password or magic link) → receives a JWT.
2. The JWT carries the user's role in `app_metadata.role` (the **role claim**; §7) and `sub` = auth uid.
3. supabase-js attaches the JWT to every PostgREST/Storage request.
4. The typed data-access layer (`src/lib/db/*`) issues queries; it never trusts the client for `org_id`
   on writes (server default fills it) and never trusts role for authorization (RLS does).
5. Postgres evaluates RLS policies using `auth.uid()`, the role claim, and `org_id` before any row is
   read/written. Authorization is **non-bypassable from the client** (resolves `NFR-002`).

### 2.4 Where a server/edge layer slots in later (deferred)
A Supabase **Edge Function** layer is the future seam for anything the SPA cannot safely do:
- Secrets / third-party API calls (email provider, payment, ERP sync).
- Multi-statement transactions that must be atomic beyond a single RPC (e.g. PO generation that writes a
  procurement transition + a document + a numbered sequence).
- Inbound webhooks (vendor portals, e-signature callbacks).
- Server-rendered artifacts (PDF POs/invoices) and scheduled jobs (timesheet reminders).

For MVP these are either out of scope or handled by Postgres RPC (§8.4). The data-access layer's module
boundary means swapping a direct query for an edge-function call later is a one-file change.

### 2.5 Architecture requirements (EARS)
- **FR-ARCH-001** (ubiquitous) The system shall serve the UI as a Vite-built React 19 SPA with no
  separate application server for the MVP.
- **FR-ARCH-002** (ubiquitous) The SPA shall access all persistent data exclusively through the typed
  data-access layer in `src/lib/db/*`; no component shall import the supabase client directly.
- **FR-ARCH-003** (event-driven) When the SPA issues any data request, the system shall enforce
  authorization in Postgres via RLS, independent of any client-side check.
- **FR-ARCH-004** (state-driven) While a user is unauthenticated, the system shall expose no business
  data and shall route the user to the sign-in screen.

---

## 3. Target component & file structure

> ⚠️ **CURRENT STATE (2026-06-08) ≠ this target tree — see ADR-0007.** The app is in the *pre-`src`-migration*
> hybrid state: the app shell + screens live at the **package root** (`pmo-portal/App.tsx`, `index.tsx`,
> `pages/`, `components/`, `data/mockData.ts`; routing is inline in `App.tsx`, there is **no `routes.tsx`**),
> while the newer infrastructure (`auth/`, `hooks/`, `lib/db/`, `lib/repositories/`, `components/shell/`,
> `components/ui/`) lives under `src/` and is imported via the `@/src/...` alias. The tree below is the
> **aspirational target**, not where files are today — a newcomer should look at the package root for screens.

### 3.1 Target tree (`pmo-portal/`)
Introduce a `src/` root (the prototype has files at package root; `baseline §2.2`). Feature-folder layout:

```
pmo-portal/
├── index.html                       # cleaned: no CDN Tailwind, no importmap, no /index.css (F-12)
├── vite.config.ts                   # + @tailwindcss/vite plugin; manualChunks (F-3)
├── src/
│   ├── main.tsx                     # React root (was index.tsx); QueryClientProvider + AuthProvider
│   ├── App.tsx                      # BrowserRouter (was HashRouter, OBS-NAV-003); route-lazy
│   ├── index.css                    # real Tailwind entry (@import "tailwindcss";) + tokens
│   ├── routes.tsx                   # route table; React.lazy(() => import(...)) per page
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            # singleton supabase-js (anon key from env)
│   │   │   └── database.types.ts    # GENERATED by `supabase gen types typescript`
│   │   ├── db/                      # TYPED DATA-ACCESS LAYER — one module per aggregate
│   │   │   ├── _tenant.ts           # org_id seam helper (resolveOrgId); single import point
│   │   │   ├── projects.ts          # listProjects/getProject/createProject/updateProject...
│   │   │   ├── procurements.ts      # incl. items/quotations/documents + transition RPC calls
│   │   │   ├── budgets.ts           # budget_versions + budget_line_items
│   │   │   ├── timesheets.ts        # timesheets + entries + approve/submit
│   │   │   ├── tasks.ts
│   │   │   ├── companies.ts
│   │   │   ├── profiles.ts          # user profiles + role
│   │   │   ├── documents.ts         # project_documents + Storage upload
│   │   │   ├── incidents.ts         # incident_reports (schema-only MVP)
│   │   │   └── dashboard.ts         # reads KPI views / RPCs (replaces in-memory aggregation)
│   │   ├── format.ts                # currency/date formatters (F-6: was dup ~7×; NFR-007 currency)
│   │   └── procurement-lifecycle.ts # canonical 9-step pipeline + progress (F-6: was dup 3×)
│   ├── auth/
│   │   ├── AuthProvider.tsx         # replaces mock UserContext (OBS-AUTH-*); real session
│   │   ├── useAuth.ts               # { user, profile, role, signIn, signOut }
│   │   ├── RequireAuth.tsx          # route guard (fixes cosmetic-only gating, baseline §5.2 note)
│   │   └── RequireRole.tsx          # role-gated route guard
│   ├── hooks/                       # TanStack Query hooks wrapping db modules
│   │   ├── useProjects.ts · useProject.ts · useProcurements.ts · useTimesheets.ts ...
│   ├── components/                  # shared, reusable UI library (Storybook in Phase 3)
│   │   ├── ui/                      # Card, Button, Badge, Modal, Drawer, EmptyState, Spinner...
│   │   ├── layout/                  # Sidebar, Header, AppShell
│   │   ├── status/                  # ProjectStatusBadge, ProcurementStatusBadge, TimesheetStatusBadge
│   │   └── charts/                  # LazyBarChart, LazyLineChart, LazyPieChart (recharts behind lazy)
│   ├── features/
│   │   ├── projects/                # Projects list, ProjectKanbanBoard, filters
│   │   ├── project-details/         # DECOMPOSED god-file (see §3.2)
│   │   ├── procurement/             # Procurement list + details + pipeline + drawer
│   │   ├── timesheets/              # weekly matrix + approvals
│   │   ├── dashboard/               # role-branched dashboards (Exec/PM/Finance/Engineer)
│   │   └── sales/                   # SalesPipeline (Projects in sales statuses)
│   └── pages/                       # thin route components composing features
│       └── PlaceholderPage.tsx      # Tasks/Companies/WorkOrders/Reports/Administration
├── e2e/                             # Playwright AC-###.spec.ts (BDD layer)
└── test/                            # Vitest unit/component tests
supabase/
├── migrations/                      # timestamped SQL (schema + RLS + enums + views/RPC)
├── seed.sql                         # neutral professional-services seed (de-O&G'd, baseline §8)
└── config.toml
```

### 3.2 Decomposing the `ProjectDetails` god-file (`F-5`, `OBS-PROJ-DETAIL-*`)
The 1390-line file defines 8+ sub-components inline (`baseline §2.3`). Target → `features/project-details/`:

```
features/project-details/
├── ProjectDetails.tsx          # shell: tab nav + <Outlet/>-style tab switch; ALL hooks at top (fixes F-1)
├── OverviewTab.tsx             # MetricCard, TimelineItem (OBS-PROJ-022)
├── BudgetTab.tsx               # version selector + line items + category pie (OBS-PROJ-023/024)
├── ScheduleTab.tsx             # task list + Gantt (OBS-SCHED-*)
│   ├── GanttChart.tsx          # SVG bars; dependency paths computed in render, not state (fixes F-14)
│   └── TaskModal.tsx           # add/edit/delete task (OBS-SCHED-004)
├── TimesheetsTab.tsx           # project timesheet rollup
├── ProcurementTab.tsx          # project procurements list (OBS-PROJ-025)
│   └── ProcurementDrawer.tsx   # slide-over
└── DocumentsTab.tsx            # category filter + real upload to Storage (OBS-PROJ-026)
```
The three status badges and the procurement lifecycle helper move to `components/status/` and
`lib/procurement-lifecycle.ts` respectively (shared; `F-6`).

### 3.3 Structure requirements (EARS)
- **FR-STRUCT-001** (ubiquitous) The system shall organize UI by feature folder under `src/features/`,
  with cross-feature reusable components under `src/components/`.
- **FR-STRUCT-002** (ubiquitous) `ProjectDetails` shall be decomposed so that no single source file
  defines more than one screen-level component (target < 300 lines/file). [ASSUMPTION] 300-line soft cap.
- **FR-STRUCT-003** (ubiquitous) Shared formatting and procurement-lifecycle logic shall exist in exactly
  one module each (`lib/format.ts`, `lib/procurement-lifecycle.ts`).

---

## 4. Data flow

### 4.1 Read path
```
Component → useX() hook (TanStack Query) → src/lib/db/x.ts → supabase-js → PostgREST → RLS → Postgres
                                   ▲                                                            │
                                   └──────────────── cached rows (queryKey incl. org_id) ◄──────┘
```
- Queries are keyed `[aggregate, org_id, ...params]` so the tenancy seam is part of the cache identity.
- Joins are resolved **in SQL** (FK joins / views), not by render-time `.find()` (kills `F-7`/`NFR-004`
  quadratic lookups). Dashboard KPIs come from SQL views/RPC, not in-memory aggregation (`OBS-DASH-*`).

### 4.2 Write path
```
Component → mutation hook → db.x.create/update(...) → PostgREST insert/update (RLS-checked)
          → onSuccess: queryClient.invalidateQueries([aggregate, org_id]) → UI refetches
```
- **Optimistic updates** for low-risk, high-frequency edits where snappiness matters: timesheet hour
  cells (`OBS-TIME-006`) and task drag/edit (`OBS-SCHED-004`). Rollback on error.
- **Server-confirmed (pessimistic)** for state-machine transitions where correctness > snappiness:
  procurement lifecycle transitions (`OBS-PROC-011/014`), timesheet submit/approve (`OBS-TIME-008/010`),
  budget version activation. These go through RPC (§8.4) and reflect the server's authoritative result.
- `org_id` is **never sent by the client on insert**; the column default (§6) fills it. This is the seam.

### 4.3 Loading / error / empty / edge (Frontend DoD, `product-expectations.md` Part B)
Every data-bound view shall handle four states (the prototype handles none — there was no async,
`NFR-008`):
- **Loading:** skeleton/spinner from the query `isLoading` (shared `<Spinner/>` / skeletons).
- **Error:** inline error surface with retry; React error boundaries per route (replaces global error
  suppression in `index.tsx`, `NFR-008`).
- **Empty:** shared `<EmptyState/>` with a primary action (generalizes `OBS-PROJ-009`'s "Clear filters").
- **Edge:** not-found → friendly 404 within the SPA (replaces silent redirects `OBS-PROJ-020`/
  `OBS-PROC-008`); over-budget, zero-hours, archived-budget banners preserved (`OBS-PROJ-007/024`,
  `OBS-TIME-008`).

### 4.4 Data-flow requirements (EARS)
- **FR-FLOW-001** (event-driven) When a query is pending, the system shall render a loading state.
- **FR-FLOW-002** (event-driven) When a query fails, the system shall render an error state with a retry
  action and shall not crash the route.
- **FR-FLOW-003** (event-driven) When a query returns zero rows, the system shall render an empty state.
- **FR-FLOW-004** (event-driven) When a mutation succeeds, the system shall invalidate the affected
  query keys so dependent views reflect the change without a full reload.
- **FR-FLOW-005** (state-driven) While an optimistic mutation is in flight, the system shall show the
  predicted result and shall roll back to server truth if the mutation fails.

---

## 5. Database schema (Postgres DDL-level)

Conventions: **`uuid` PKs** (`gen_random_uuid()`) — standardizes the prototype's mixed numeric/string ids
(`F-13`); `timestamptz` for instants, `date` for calendar dates; `numeric(14,2)` for money (no floats);
Postgres **enums** for closed state machines, **CHECK** for small open sets; **`org_id uuid` on every
business table** (§6); FK indexes on every hot-path FK (`F-7`); `created_at`/`updated_at` audit columns.

> DDL below is **illustrative target shape**, not the final migration (migrations are authored + reviewed
> in the build phase per `product-expectations.md` Data/Schema DoD). Money/`spent` authority and a few
> module specifics are **DEFERRED** (§14).

### 5.1 Enums (state machines from `baseline §4.2`, de-O&G'd)
```sql
create type user_role        as enum ('Executive','Project Manager','Finance','Engineer','Admin');
create type company_type      as enum ('Internal','Client','Vendor');
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
-- ProcurementDocument.status was free-text (NFR-011/F-13): tighten to enum
create type doc_status         as enum ('Draft','Issued','Approved','Rejected','Closed');
```

### 5.2 `organizations` (tenancy root — ADR-0001)
```sql
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);
-- Single-tenant MVP: exactly one seeded row; its id is the default for every org_id below.
```

### 5.3 `profiles` (replaces mock `User`; 1:1 with `auth.users`)
```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  company_id  uuid references companies(id),
  full_name   text not null,
  email       text not null,
  avatar_url  text,
  role        user_role not null default 'Engineer',   -- mirrors JWT claim (§7)
  title       text,
  location    text,            -- DE-O&G: free-text, was 'Onshore/Offshore' union (baseline §8.1)
  skills      text[] default '{}',  -- DE-O&G: was certifications (BOSIET/H2S...) (baseline §8.1)
  utilization smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on profiles (org_id);
create index on profiles (company_id);
```

### 5.4 `companies`
```sql
create table companies (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  name       text not null,
  type       company_type not null,
  created_at timestamptz not null default now()
);
create index on companies (org_id);
```

### 5.5 `projects`
```sql
create table projects (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  code               text,                  -- human ref (was 'P001'); unique per org
  name               text not null,
  status             project_status not null default 'Leads',
  client_id          uuid references companies(id),
  project_manager_id uuid references profiles(id),
  contract_value     numeric(14,2) not null default 0,
  budget             numeric(14,2) not null default 0,  -- header budget; authority DEFERRED (§14)
  spent              numeric(14,2) not null default 0,  -- DEFERRED: stored vs derived (§14)
  start_date         date,
  end_date           date,
  last_update        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (org_id, code)
);
create index on projects (org_id);
create index on projects (org_id, status);          -- hot path: tab grouping (OBS-PROJ-002)
create index on projects (project_manager_id);       -- hot path: "My Projects" (OBS-PROJ-003)
create index on projects (client_id);
```

### 5.6 Procurement aggregate
```sql
create table procurements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  code            text,                    -- was 'PROC-2024-004'; unique per org
  title           text not null,
  project_id      uuid references projects(id),       -- optional (baseline §4.1)
  requested_by_id uuid references profiles(id),
  status          procurement_status not null default 'Draft',
  total_value     numeric(14,2) not null default 0,
  vendor_id       uuid references companies(id),       -- auto-set from selected quote (OBS-PROC-011)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, code)
);
create index on procurements (org_id);
create index on procurements (org_id, status);          -- hot path: To-Approve/Active tabs (OBS-PROC-003)
create index on procurements (project_id);              -- hot path: project's procurement tab
create index on procurements (requested_by_id);          -- hot path: My Requests (OBS-PROC-002)

create table procurement_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  procurement_id uuid not null references procurements(id) on delete cascade,
  name           text not null,
  description    text,
  quantity       numeric(14,2) not null default 0,
  rate           numeric(14,2) not null default 0,
  amount         numeric(14,2) generated always as (quantity * rate) stored
);
create index on procurement_items (procurement_id);

create table procurement_quotations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  procurement_id uuid not null references procurements(id) on delete cascade,
  vendor_id      uuid not null references companies(id),
  reference      text,
  total_amount   numeric(14,2) not null default 0,
  received_date  date,
  is_selected    boolean not null default false,
  file_url       text                                   -- Supabase Storage object path
);
create index on procurement_quotations (procurement_id);
-- at most one selected quote per procurement:
create unique index on procurement_quotations (procurement_id) where is_selected;

create table procurement_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  procurement_id   uuid not null references procurements(id) on delete cascade,
  type             text not null,           -- PR/RFQ/Supplier Quotation/PO/Receipt/Invoice/Payment
  reference_number text,
  status           doc_status not null default 'Draft',   -- tightened from free-text (NFR-011)
  date             date,
  link             text
);
create index on procurement_documents (procurement_id);
```

### 5.7 Budget aggregate
```sql
create table budget_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  project_id  uuid not null references projects(id) on delete cascade,
  version     int not null,
  name        text not null,
  status      budget_status not null default 'Draft',
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);
create index on budget_versions (project_id);
-- at most one Active version per project:
create unique index on budget_versions (project_id) where status = 'Active';

create table budget_line_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  budget_version_id uuid not null references budget_versions(id) on delete cascade,
  category          budget_category not null,
  description       text,
  budgeted_amount   numeric(14,2) not null default 0,
  actual_amount     numeric(14,2) not null default 0
);
create index on budget_line_items (budget_version_id);
```

### 5.8 Timesheet aggregate
```sql
create table timesheets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  user_id         uuid not null references profiles(id),
  week_start_date date not null,                       -- always a Monday (app-enforced + CHECK)
  status          timesheet_status not null default 'Draft',
  submitted_at    timestamptz,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  constraint week_is_monday check (extract(dow from week_start_date) = 1),
  unique (user_id, week_start_date)
);
create index on timesheets (org_id);
create index on timesheets (user_id, week_start_date);  -- hot path: my week (OBS-TIME-002)
create index on timesheets (org_id, status);             -- hot path: approvals queue (OBS-TIME-009)

create table timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  timesheet_id uuid not null references timesheets(id) on delete cascade,
  project_id   uuid not null references projects(id),
  entry_date   date not null,
  hours        numeric(5,2) not null default 0 check (hours >= 0 and hours <= 24),
  notes        text
);
create index on timesheet_entries (timesheet_id);
create index on timesheet_entries (project_id);          -- hot path: PM-relevant hours (OBS-TIME-009)
```

### 5.9 `tasks` (self-referential dependencies via join table)
```sql
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  start_date  date,
  end_date    date,
  assignee_id uuid references profiles(id),
  status      task_status not null default 'To Do',
  created_at  timestamptz not null default now()
);
create index on tasks (project_id);

-- dependencies[] (string[] in prototype) normalized to a join table (avoids array-FK integrity gaps):
create table task_dependencies (
  task_id       uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  org_id        uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
```

### 5.10 `incident_reports` (de-O&G `HSEIncident` → `IncidentReport`; schema-only MVP)
```sql
create table incident_reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  incident_date date not null,
  type        text not null,            -- tenant-configurable categories (baseline §8.1)
  severity    incident_severity not null,
  location    text,                     -- DE-O&G: free-text (baseline §8.1)
  description text,
  status      incident_status not null default 'Open',
  reported_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index on incident_reports (org_id);
```

### 5.11 `project_documents` (document control)
```sql
create table project_documents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) default <DEFAULT_ORG_ID>,
  project_id uuid not null references projects(id) on delete cascade,
  code       text,
  category   text not null,             -- RFI/Transmittal/Submittal/Drawing/Specification (tenant-cfg)
  title      text not null,
  revision   text,
  status     doc_status not null default 'Draft',
  doc_date   date,
  author_id  uuid references profiles(id),
  file_path  text,                      -- Supabase Storage object path
  created_at timestamptz not null default now()
);
create index on project_documents (project_id);
```

### 5.12 Schema requirements (EARS)
- **FR-DB-001** (ubiquitous) Every business table shall have a non-null `org_id` referencing
  `organizations(id)` (§6, ADR-0001).
- **FR-DB-002** (ubiquitous) Every primary key shall be a `uuid`; money columns shall be `numeric`.
- **FR-DB-003** (ubiquitous) Project status, procurement status, budget status, timesheet status, task
  status, and document status shall be constrained to their enum domains (no free-text status; fixes
  `NFR-011`).
- **FR-DB-004** (ubiquitous) Every foreign key used in a list/filter/join hot path shall be indexed
  (fixes `F-7`/`NFR-004`).
- **FR-DB-005** (state-driven) While a project has budget versions, at most one version shall be `Active`
  (partial unique index).
- **FR-DB-006** (state-driven) While a procurement has quotations, at most one shall be selected.

---

## 6. RLS & tenancy

### 6.1 Strategy
RLS is enabled on **every** business table (`product-expectations.md` Data/Schema DoD: "RLS enabled on
every business table"). Two predicate dimensions compose:
1. **Tenant isolation:** `org_id = auth_org_id()` — a SQL helper that returns the caller's org. In MVP it
   resolves to the single default org via the caller's `profiles` row.
2. **Role/ownership:** per-table predicates keyed on `auth.uid()` and the role claim (§7).

### 6.2 Helper functions
```sql
-- caller's org (MVP: single org; later: from JWT app_metadata.org_id — see §6.5)
create function auth_org_id() returns uuid language sql stable security definer as $$
  select org_id from profiles where id = auth.uid()
$$;

create function auth_role() returns user_role language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role')::user_role,
    (select role from profiles where id = auth.uid()))
$$;
```

### 6.3 Per-table policy pattern (illustrative)
```sql
alter table projects enable row level security;

-- READ: any authenticated member of the org may read projects in their org.
create policy projects_select on projects for select
  using (org_id = auth_org_id());

-- WRITE: Admin/Executive/PM/Finance may write; Engineer is read-mostly. (Authority matrix DEFERRED §14)
create policy projects_write on projects for all
  using (org_id = auth_org_id()
         and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id());
```
Representative per-table intent (full matrices DEFERRED to module specs, §14):
- **profiles:** read own org; update own row; Admin updates any in org; role changes Admin-only.
- **projects / companies / budgets / tasks / project_documents:** read in org; write by
  Admin/Exec/PM/Finance (Finance scoped to budgets). Engineer read-only except own task status
  `[ASSUMPTION]`.
- **procurements + children:** read in org; insert by any member (raise a request); **transitions via
  RPC only** (§8.4) so the role×status authorization matrix lives in one audited place (DEFERRED §14).
- **timesheets + entries:** a user reads/writes **own** rows while `Draft`; managers read submitted
  timesheets for projects they manage; approve/reject via RPC (rule DEFERRED §14).
- **incident_reports:** read in org; insert by any member.

### 6.4 Single-tenant-now mechanism
- Exactly one `organizations` row is seeded; its id is the **column default** for every `org_id`
  (`default <DEFAULT_ORG_ID>`), so the client never sends `org_id` and cannot spoof it (§4.2).
- `auth_org_id()` reads the caller's `profiles.org_id`; every new profile defaults to the single org.
- Net effect: all data is in one tenant, isolation predicate is a no-op today but **structurally present
  and enforced**.

### 6.5 The exact change to go B2B multi-tenant (ADR-0001)
No schema rewrite. The flip is additive:
1. Stop defaulting `org_id`; set it at signup from the org the user joins (invite/onboarding flow).
2. Put `org_id` into the JWT `app_metadata.org_id` at login; change `auth_org_id()` to read the claim
   instead of (or validated against) `profiles.org_id`. All existing RLS predicates
   (`org_id = auth_org_id()`) keep working unchanged.
3. Add org-scoped unique constraints already present (`unique (org_id, code)`) — already in place.
4. Add org provisioning UI + membership table if users can belong to multiple orgs.
Because every table already filters by `org_id`, the data plane needs **zero** structural change.

### 6.6 RLS requirements (EARS)
- **FR-RLS-001** (ubiquitous) Row-level security shall be enabled and enforced on every business table.
- **FR-RLS-002** (ubiquitous) Every policy shall include the predicate `org_id = auth_org_id()` so no
  query can read or write rows outside the caller's organization.
- **FR-RLS-003** (event-driven) When a client attempts an insert, the system shall derive `org_id` from
  the column default / caller context and shall reject any client-supplied `org_id` that differs from the
  caller's org (`with check`).
- **FR-RLS-004** (event-driven) When a non-authorized role attempts a write, the RLS policy shall reject
  it regardless of any client-side UI gating.

---

## 7. Auth model

### 7.1 Mechanism
Supabase Auth (GoTrue): **email/password + magic link** (passwordless email) for MVP. This replaces the
mock `UserContext` role-simulation dropdown entirely (`OBS-AUTH-001..006`). A first-run sign-in screen
gates the app (`FR-ARCH-004`); the role-switch dropdown is removed (or, `[ASSUMPTION]`, retained
**Admin-only** as an impersonation tool — DEFERRED to the Auth module spec).

### 7.2 Where the role lives
- **Source of truth:** `profiles.role` (a `user_role` enum column), editable by Admin.
- **Fast-path claim:** the role is also mirrored into the JWT `app_metadata.role` so RLS can read it
  without a profiles lookup on every request. A small trigger/Edge hook keeps `app_metadata.role` in sync
  when `profiles.role` changes (`[ASSUMPTION]` sync mechanism; finalize in Auth module spec).
- RLS reads the claim first, falling back to `profiles.role` (`auth_role()`, §6.2). The role is **never
  trusted from the client**.

### 7.3 Session & client wiring
- `AuthProvider` (replaces `UserContext`) subscribes to `supabase.auth.onAuthStateChange`, exposes
  `{ session, user, profile, role, signIn, signInWithMagicLink, signOut }` via `useAuth()`.
- `RequireAuth` / `RequireRole` route guards replace the **cosmetic-only** nav gating (`baseline §5.2`
  note: routes were directly reachable by URL regardless of role). Now both nav visibility *and* route
  access *and* RLS agree.
- Session persists across reloads (Supabase stores the JWT) — fixes `OBS-AUTH-006` (reset-on-refresh).
- Timesheets sources the user from `useAuth()`, removing the hard-coded `CURRENT_USER_ID = 1`
  (`F-8`/`OBS-TIME-001`).

### 7.4 Auth requirements (EARS)
- **FR-AUTH-001** (event-driven) When a user submits valid credentials or completes a magic-link flow,
  the system shall establish an authenticated session and route to the dashboard.
- **FR-AUTH-002** (ubiquitous) The system shall store each user's role in `profiles.role` and mirror it
  into the JWT role claim used by RLS.
- **FR-AUTH-003** (state-driven) While unauthenticated, the system shall block access to every business
  route and redirect to sign-in.
- **FR-AUTH-004** (event-driven) When a user signs out, the system shall clear the session and revoke
  client access to business data.
- **FR-AUTH-005** (event-driven) When the application reloads, the system shall restore the existing
  session without re-prompting (replaces `OBS-AUTH-006`).

---

## 8. API surface / data-access layer

### 8.1 Pattern (ADR-0003)
One typed module per aggregate under `src/lib/db/`. Each function returns typed rows from
`database.types.ts` (generated by `supabase gen types typescript`). Components never touch supabase-js;
they call hooks (`src/hooks/`) that wrap these modules with TanStack Query.

```ts
// src/lib/db/projects.ts (illustrative)
import { supabase } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';
export type Project = Tables<'projects'>;

export async function listProjects(params?: { status?: Project['status']; pmId?: string }) {
  let q = supabase.from('projects')
    .select('*, client:companies(name), pm:profiles(full_name)');  // joins in SQL, not .find() (F-7)
  if (params?.status) q = q.eq('status', params.status);
  if (params?.pmId)   q = q.eq('project_manager_id', params.pmId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
// create/update never pass org_id — server default fills it (the tenancy seam, §6.4)
```

### 8.2 Modules (one per aggregate)
`projects`, `procurements` (+ items/quotations/documents + transition calls), `budgets`, `timesheets`
(+ entries + submit/approve), `tasks`, `companies`, `profiles`, `documents` (+ Storage), `incidents`,
`dashboard` (KPI reads). `_tenant.ts` centralizes the org seam.

### 8.3 Supabase client patterns
- Single client instance (`src/lib/supabase/client.ts`); never instantiated per-call.
- Reads use `.select()` with embedded resource joins (PostgREST) to replace render-time joins (`F-7`).
- Errors are thrown (not swallowed) so TanStack Query surfaces them to the error state (§4.3).

### 8.4 Views / RPC for dashboard KPIs and transitions (replaces in-memory aggregation)
The prototype computes KPIs, weighted pipeline, margins, and utilization **in render** (`OBS-DASH-*`,
`OBS-SALES-002`), with hard-coded fakes (`F-11`). Target: compute in SQL.
- **Views** for read-only aggregates: `v_dashboard_exec_kpis` (active projects, ongoing contract value,
  avg gross margin from `(budget-spent)/budget`, projects-at-risk), `v_sales_pipeline` (weighted forecast
  Σ contract_value × stage probability), `v_pm_dashboard`, `v_finance_dashboard`, `v_engineer_workload`.
  Views inherit RLS from base tables.
- **RPC (`security definer` Postgres functions)** for state-machine transitions, so the authorization
  matrix and side-effects live server-side in one audited place:
  - `procurement_transition(p_id uuid, p_action text)` — validates current status + caller role, applies
    next status, on quote-select copies vendor/total (`OBS-PROC-011`), writes a document/audit row.
  - `submit_timesheet(p_id uuid)` / `approve_timesheet(p_id uuid)` / `reject_timesheet(...)`
    (`OBS-TIME-008/010`).
  - `activate_budget_version(p_id uuid)` (enforces single-Active invariant, FR-DB-005).
  Stage-probability weights (`SalesPipeline` .1/.2/.4/.6/.8/1.0) move into the view/a lookup table.

### 8.5 Data-access requirements (EARS)
- **FR-API-001** (ubiquitous) The data-access layer shall expose typed functions per aggregate generated
  from the live schema; the build shall fail if generated types drift from usage (typecheck gate).
- **FR-API-002** (ubiquitous) Relationship resolution shall occur in SQL joins/views, not by client-side
  `.find()` over full collections (resolves `F-7`).
- **FR-API-003** (event-driven) When a dashboard view is requested, the system shall return aggregates
  computed in SQL (views/RPC), not computed in the browser.
- **FR-API-004** (event-driven) When a state-machine transition is requested, the system shall execute it
  via an RPC that validates the current state and caller authorization server-side.

---

## 9. Caching strategy

**Recommendation: TanStack Query (React Query) v5** as the server-state cache/sync layer (ADR-0005).
Rationale:
- The prototype recomputes everything on every render and loses all state on navigation (`baseline §3`).
  TanStack Query gives caching, background refetch, request dedup, stale-while-revalidate,
  loading/error/empty status flags (directly powers §4.3), optimistic updates with rollback (§4.2), and
  query invalidation on mutation — exactly the gaps `NFR-008` flags.
- It is server-state only; UI state stays in component `useState`/`useReducer` (no Redux needed for MVP).
- `queryKey` includes `org_id`, so the tenancy seam is part of cache identity (no cross-tenant bleed when
  multi-tenant lands).

Conventions: default `staleTime` ~30s for lists, `gcTime` 5m; mutations call `invalidateQueries` on the
affected aggregate key; optimistic only for timesheet cells and task edits (§4.2). Flagged as ADR-0005.

- **NFR-CACHE-001** The system shall cache server reads client-side and revalidate in the background,
  deduplicating concurrent identical requests.

---

## 10. UI/CSS architecture

- **Tailwind via Vite (ADR-0004):** adopt `@tailwindcss/vite`; `src/index.css` = `@import "tailwindcss";`
  plus the ported **primary color palette** from the prototype's inline CDN config (`index.html:9-21`).
  Remove CDN Tailwind `<script>`, the `aistudiocdn` importmap, and the dead `/index.css` reference
  (`F-12`/`NFR-012`). Real CSS is emitted at build (CSP-safe, offline-capable).
- **Routing:** `BrowserRouter` replaces `HashRouter` (`OBS-NAV-003`); clean URLs. Catch-all → a real 404
  page (was silent dashboard fallback, `OBS-NAV-005`). Requires host SPA-rewrite config (§12).
- **Component library:** `src/components/ui/*` (Card, Button, Badge, Modal, Drawer, EmptyState, Spinner,
  Table, Tabs, FormField) — reusable, accessible (WCAG AA; fixes clickable-`<div>` a11y gaps `NFR-005`
  with proper `role=button`/keyboard handlers). **Storybook** introduced in Phase 3 per
  `product-expectations.md` Part C, for the state matrix + a11y checks.
- **State matrix:** every data view documents loading / empty / error / populated / over-limit states
  (e.g. budget >100% red `OBS-PROJ-007`, archived-version banner `OBS-PROJ-024`, zero-hours disabled
  submit `OBS-TIME-008`).
- **Design system:** `DESIGN.md` at repo root (design.md format) is authored in Phase 3 via
  `/design-consultation`; this spec only mandates Tailwind-via-Vite + the token seam.

- **FR-UI-001** (ubiquitous) The system shall use a bundled Tailwind pipeline (no CDN) and `BrowserRouter`.
- **FR-UI-002** (ubiquitous) Interactive elements shall be keyboard-operable and meet WCAG AA.

---

## 11. Performance

Resolve `NFR-004`/`F-3` (single 804 KB bundle):
- **Route-level code-splitting:** `React.lazy(() => import('./pages/...'))` + `<Suspense>` per route in
  `routes.tsx`. Each MVP module ships as its own chunk.
- **Lazy charts:** recharts behind `components/charts/Lazy*` so it loads only on dashboard/budget routes,
  not in the initial bundle.
- **`manualChunks`** in `vite.config.ts`: split vendor (react/router), recharts, supabase-js, and
  TanStack Query into separate cacheable chunks.
- **SQL-side aggregation + indexes** (§5, §8.4) eliminate the quadratic render-time joins (`F-7`).
- **Gantt:** compute dependency paths during render (memoized), not stored in state (`F-14`).

- **NFR-PERF-001** The initial JS payload shall be code-split such that no single route's initial chunk
  approaches the prototype's 804 KB; recharts shall not load on routes that do not chart.
- **NFR-PERF-002** List/table joins shall be O(1) per row via SQL joins or memoized `Map` lookups, not
  O(n) `.find()` per render.

---

## 12. Deployment / DevOps (aspirational per charter)

Marked **deferred** — owner decides at deploy time (ADR-0006, Proposed/Deferred).
- **Host (proposed):** SPA on **Vercel or Netlify** (static + SPA rewrite for `BrowserRouter`), backend on
  **Supabase Cloud**. `[ASSUMPTION]` final host TBD by owner.
- **Env management:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` via host env vars; **no service-role
  key in the client**; `.env.local` git-ignored; separate Supabase projects per environment.
- **CI gates (block merge, per `product-expectations.md` Part C):** `npm run typecheck` (0 errors),
  ESLint `--max-warnings=0`, `npm test` (Vitest, ≥80% changed-line coverage), `npx playwright test`
  (AC-### green). Migrations applied via Supabase CLI in CI against a preview DB.
- **Monitoring (later):** Sentry (frontend errors), Supabase logs/metrics, uptime check. Aspirational —
  tracked, not blocking MVP.

- **NFR-DEPLOY-001** The build shall consume Supabase config from environment variables only; no secrets
  shall be committed (security-auditor verifies — `product-expectations.md` Security DoD).

---

## 13. Migration strategy (phased, shippable)

Each phase is independently shippable, behind spec + TDD + BDD (`product-expectations.md` Part B). Ordered
to de-risk: green the repo and lay foundations before touching data, swap module-by-module behind stable
component APIs (extends `baseline §11`).

- **Phase 0 — Green + de-cruft (P0).** Fix `F-1` (hooks-order crash), `F-4` (21 lint errors), remove CDN
  Tailwind/importmap/`/index.css` (`F-12`), de-O&G the types + seed (`baseline §8`:
  `HSEIncident→IncidentReport`, `location`/`certifications→skills` free-text). Behavior-preserving.
- **Phase 1 — Foundations.** Introduce `src/` layout, `@tailwindcss/vite`, `BrowserRouter`, TanStack
  Query provider, route-level lazy + `manualChunks` (`F-3`). Still on mock data behind the new structure.
- **Phase 2 — Schema + RLS.** Author `supabase/migrations/*` (§5), enable RLS on every table (§6), seed
  one org + neutral professional-services data. Generate `database.types.ts`. Reviewed + reversible.
- **Phase 3 — Auth.** Supabase Auth + `AuthProvider` + route guards replace mock `UserContext` (§7);
  role claim wired to RLS. Security-auditor pass before exposing auth.
- **Phase 4 — Data-access layer.** Build `src/lib/db/*` typed modules + hooks (§8). One module per
  aggregate.
- **Phase 5 — Swap mock→real per module** (one PR each, behind the same component APIs):
  Projects → Procurement → Timesheets → Executive Dashboard. Wire previously-dead placeholder actions
  (`F-10`: New Project, transitions, approvals) to real RPC/mutations as each module lands.
- **Phase 6 — Decompose god-files.** Split `ProjectDetails` (§3.2, `F-5`); centralize `lib/format.ts` +
  `lib/procurement-lifecycle.ts` (`F-6`); fix Gantt render (`F-14`).
- **Phase 7 — BDD lock-in (ongoing).** Implement each `AC-###` as `e2e/AC-###.spec.ts`; re-derive the
  baseline AC set against real auth/persistence.

- **NFR-MIG-001** Each migration phase shall be reversible and shall not regress any locked `AC-###`.

---

## 14. NFRs & open decisions (DEFERRED to module specs)

### 14.1 Consolidated NFRs
| ID | Category | Target |
|---|---|---|
| NFR-CACHE-001 | Caching | Client server-state cache w/ background revalidation + dedup (TanStack Query). |
| NFR-PERF-001 | Performance | Route code-split; recharts lazy; no single 804 KB bundle. |
| NFR-PERF-002 | Performance | O(1)-per-row joins via SQL/memoized maps (kills `F-7`). |
| NFR-SEC-001 | Security | RLS on every business table; org isolation + role enforced server-side, not client-bypassable (`NFR-002`). |
| NFR-SEC-002 | Security | No service-role key client-side; no secrets committed. |
| NFR-TENANT-001 | Tenancy | `org_id` on every business table; single-org default now; additive flip to B2B (ADR-0001). |
| NFR-DATA-001 | Data integrity | `uuid` PKs; `numeric` money; enum-constrained statuses; FK indexes (fixes `F-13`/`NFR-011`). |
| NFR-A11Y-001 | Accessibility | WCAG AA; keyboard-operable interactive elements (fixes `NFR-005`). |
| NFR-DEPLOY-001 | DevOps | Env-var config; CI gates (typecheck/lint/unit≥80%/e2e) block merge. |
| NFR-I18N-001 | i18n/currency | Single formatter module; currency configurable (was USD-hardcoded ×7, `NFR-007`). `[ASSUMPTION]` single-currency MVP. |

### 14.2 Open decisions — explicitly DEFERRED to module specs
These are **module-detail** questions; this architecture spec deliberately does not resolve them (each
goes to its module spec under `docs/specs/`, citing `baseline §10`):
- **Procurement transition authorization matrix** — exact role×status permissions for each lifecycle
  transition (`OBS-PROC-014`). → *Procurement module spec.* Architecture only fixes that transitions go
  through RPC (§8.4) so the matrix lives in one server-side place.
- **Budget authority: header vs line-item** — is `projects.budget/spent` authoritative, or derived from
  budget line items + procurement + timesheet actuals? (`baseline §10`, divergence noted P001.)
  → *Budget module spec.* Schema keeps both columns; derivation rule TBD.
- **Timesheet approval rule** — per-project PM vs line-manager vs configurable approver chain; whole-sheet
  vs per-entry approval (`OBS-TIME-009`, `baseline §10`). → *Timesheets module spec.*
- **Admin role semantics** — real role with screens vs internal super-user / impersonation only
  (`baseline §10`; affects whether the role-switch dropdown survives as an Admin tool, §7.1).
  → *Auth/Admin module spec.*
- **Incident register scope** — MVP module vs schema-only (this spec assumes schema-only, §1.2).
  → *Incident module spec.*
- **Work Orders** — in/out of MVP (routed-but-unbuilt; `baseline §10`). → product backlog.
- **Win-rate definition** — counting Ongoing+CloseOut as "won" (`OBS-SALES-003`). → *Dashboard module spec.*
- **`location`/`skills` model** — free-text now (§5.3); fixed enum vs tenant-configurable lookup later.
  → *Profiles/Admin module spec.*
- **Multi-currency** — single-currency USD MVP vs multi-currency from day one (`baseline §10`).
  → product decision.

---

## 15. Traceability summary

| Concern | Baseline finding | This spec |
|---|---|---|
| No backend/persistence/auth | `F-2`, `NFR-001/002`, `OBS-AUTH-*` | §2, §6, §7 |
| No tenancy seam | `NFR-003` | §6, ADR-0001 |
| O&G framing | `§8` | §5.3/5.10, Phase 0 |
| God-file | `F-5`, `OBS-PROJ-DETAIL-*` | §3.2 |
| Duplicated logic | `F-6` | §3.1 (`lib/*`), §8 |
| O(n) joins | `F-7`, `NFR-004` | §5 indexes, §8.4 views |
| 804 KB bundle | `F-3`, `NFR-004` | §11 |
| Hooks-order crash | `F-1` | §3.2, Phase 0 |
| CDN Tailwind residue | `F-12`, `NFR-012` | §10, ADR-0004 |
| Free-text doc status | `F-13`, `NFR-011` | §5.1/5.6 enums |
| No async states | `NFR-008` | §4.3, §9 |
| a11y gaps | `NFR-005` | §10 |
| USD hardcoded | `NFR-007` | `lib/format.ts`, NFR-I18N-001 |
