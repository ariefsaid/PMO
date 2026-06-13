# Plan — CRM: Contacts + Activity log (v1)

**Date:** 2026-06-14 · **Branch base:** `dev` (Wave 0/1/2 merged) · **Migration number:** `0030` (deconflicted; current head = 0029)
**Author:** eng-planner · **Status:** build-ready (grill/mockup skipped per Director — KANNA-parity on `dev`)

---

## 1. Context & design (one decision at a time)

CRM v1 adds two net-new business entities that follow the **shipped CRUD/RBAC foundation** verbatim — the
**Companies slice is the reference template** (`pages/Companies.tsx` + `src/lib/db/companies.ts` +
`src/hooks/useCompanies.ts` + `repositories.company`). No new architecture; this is "another entity on
the established rails", so **no ADR** is required (the entity-on-pattern test fails the ADR threshold;
ADR-0017/0018/0016/0019 already govern the seam, soft-archive, `can()`, and SoD).

### 1.1 Entities & relationships
- `contacts` — a person at a company. `company_id` is **NOT NULL** (Director: every contact has an
  employer). Soft-archive (ADR-0018). Belongs to one org; one company.
- `crm_activities` — a timeline of touchpoints on a contact. `contact_id` **NOT NULL `on delete cascade`**
  (deleting a contact removes its activity history — consistent with `crm_activities` being purely
  child timeline data, mirroring `procurement_*_files` cascade in 0028). Optional `company_id` /
  `project_id` denormalized links (nullable) for future cross-surfacing. `logged_by_id → profiles(id)`
  stamped from the caller. **No soft-archive in v1** (activities are append-only log entries; defer edit/delete).

### 1.2 org_id seam (verified against the repo)
`companies` (0001) and `project_documents` (0002) both use the **column-default + RLS-WITH-CHECK** seam:
`org_id uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'`, and
the client **never sends org_id**. `contacts` uses exactly this (a top-level entity like `companies`,
so the column default + `auth_org_id()` WITH CHECK is sufficient — **no stamp trigger needed**, matching
`companies`). `crm_activities` is a **child of contacts**, so it adds a **BEFORE INSERT stamp trigger**
that inherits `org_id` from the parent contact when the client left it null/at the seed default —
mirroring `stamp_procurement_quotation_file_org()` (0028 §6) — plus the parent-org guard in its write policy.

### 1.3 Writer-role set (aligned to `companies`)
`companies_write` (0002_rls.sql:56) = `('Admin','Executive','Project Manager','Finance')` — i.e. `can()`'s
**MASTER_DATA** set. CRM is master data (a directory of people, like the company directory), so **both
CRM tables use the same writer set** for INSERT/UPDATE. Reads = org-wide (`org_id = auth_org_id()`),
matching `companies_select`. Soft-archive on contacts stays open to all four writer roles server-side
(ADR-0018); the FE `archive` gate narrows to Admin·Exec (ARCHIVE_ROLES) and `delete` to Admin (mirrors
companies §D convention). **Activities: any of the 4 writer roles may log** (logging a touchpoint is a
routine master-data write, no SoD axis).

`can()` entries (new entities `contact`, `contactActivity`):

| entity | view | create | edit | archive | delete |
|---|---|---|---|---|---|
| `contact` | MASTER_DATA | MASTER_DATA | MASTER_DATA | ARCHIVE_ROLES | ADMIN |
| `contactActivity` | MASTER_DATA | MASTER_DATA | — | — | — |

### 1.4 UI architecture (v1, tight)
- **Contacts module** — top-level route `/contacts` (list + create/edit modal + soft-archive), a direct
  clone of `pages/Companies.tsx` minus the type-pill/type-filter; adds a **Company** column + a
  **company filter** + a **search**. Rail + ⌘K registration mirror Companies (Sales group, Exec·PM·Finance·Admin).
- **Contact quick-view Drawer** — reuses the Companies `Drawer` pattern; its body hosts the **activity
  timeline** (newest-first list) + a **"Log activity" form** (kind / subject / body / occurred_at).
- **Company-detail touch (cheap)** — add a read-only **"Contacts" count + list** to the Companies
  quick-view Drawer (`pages/Companies.tsx`), reading `repositories.contact.listByCompany(companyId)`.
  This is the only existing-file behavior touch.
- **States:** loading (`ListState variant="loading"`), empty (`ListState variant="empty"`), error
  (`ListState variant="error" onRetry`), and the timeline's own empty ("No activity logged yet").

### 1.5 DESIGN.md tokens (binding)
Reuse the shared primitives only — no raw hex. `Toolbar`/`SearchMini`/`ViewToggle`/`DataTable`/`ListState`/
`Drawer`/`EntityFormModal`/`TextField`/`SelectField`/`Combobox`/`FormSection`/`FormGrid`/`FieldError`/
`ConfirmDialog`/`StatusPill`/`Button`/`Icon` from `@/src/components/ui`. Root font 16px → 32px controls.
Activity `kind` renders as a `StatusPill` (Call=`open` blue, Email=`violet`, Meeting=`won` green,
Note=neutral `muted`), matching the company-type-pill precedent.

### 1.6 Scaling / performance notes
- Index `contacts (company_id, full_name) where archived_at is null` (list-by-company hot path) +
  `contacts (org_id)` (tenancy scans) + a `contacts (full_name)` for the org-wide list order.
- Index `crm_activities (contact_id, occurred_at desc)` (the timeline hot path — newest-first per contact).
- Reads are org-scoped by RLS; no N+1 — the Contacts list is one query, the timeline one query per open drawer.
- All FKs are real + indexed; `crm_activities.contact_id` cascade is intentional (child log data).

### 1.7 Collision assessment (Wave-3 parallel streams)
**Net-new + one small company-detail Drawer touch.** CRM is isolated:
- **Import/export stream** touches **list toolbars** (`ExportButton`, toolbar layout). CRM adds its OWN
  new page (`pages/Contacts.tsx`) with its own toolbar — no shared edit. The only shared FE file is
  `App.tsx` (route add), `routeMatch.ts` (MODULES add), `Rail.tsx` (nav add) — **append-only one-line
  additions**, trivially mergeable. Flag: if Import also edits `App.tsx`/`Rail.tsx`, expect a 1-line
  merge, no logic conflict.
- **Gantt stream** touches **project-detail** (`pages/project-detail/*`). CRM does **not** touch
  project-detail. Zero overlap.
- **Migration numbering:** CRM claims **0030**. If another Wave-3 stream also lands a migration, the
  later-merged stream renumbers — flagged to the Director.
- `src/auth/policy.ts` (add 2 entities), `src/lib/repositories/index.ts` + `types.ts` (add `contact`
  repo): shared files, **append-only** — low conflict, but coordinate ordering if Import also edits them.

---

## 2. Requirements (EARS) + Acceptance criteria (Given/When/Then)

### Functional (FR) / Non-functional (NFR)
- **FR-CRM-001** When a writer-role user submits the contact form with a name and a company, the system
  shall create a contact in the caller's org (org_id never sent).
- **FR-CRM-002** When a writer-role user edits a contact, the system shall update its fields in the caller's org.
- **FR-CRM-003** When an archive-role user archives a contact, the system shall stamp `archived_at` so it
  drops out of the default list.
- **FR-CRM-004** When an Admin hard-deletes a contact, the system shall remove it and cascade its activities.
- **FR-CRM-005** While viewing `/contacts`, the system shall list the org's non-archived contacts ordered
  by name, filterable by company and searchable by name/email.
- **FR-CRM-006** When a writer-role user logs an activity on a contact, the system shall create a
  `crm_activities` row (org_id stamped from the parent contact; logged_by_id from the caller).
- **FR-CRM-007** While viewing a contact, the system shall list its activities newest-first by `occurred_at`.
- **FR-CRM-008** While viewing a company, the system shall list that company's non-archived contacts.
- **OBS-CRM-009** Where the caller's role is not a CRM writer, the FE shall hide create/edit/archive/delete
  affordances (UX projection; RLS is the authority).
- **NFR-CRM-010** Contacts and activities shall be org-isolated: a cross-org user sees zero rows (RLS).
- **NFR-CRM-011** A non-writer's direct INSERT shall be rejected by RLS (42501); a non-writer UPDATE/archive
  shall be a 0-row no-op (USING hides the row).
- **NFR-CRM-012** A writer inserting an activity whose parent contact is in another org shall be rejected
  by the parent-org guard (42501).

### Acceptance criteria (GWT) + traceability (ADR-0010: one owning layer per AC)

| AC | Given / When / Then | Owning layer | File |
|---|---|---|---|
| **AC-CRM-001** | Given a PM in org-A, When they INSERT a contact (no org_id sent), Then it is stamped org-A | pgTAP | `supabase/tests/0072_crm_rls.test.sql` |
| **AC-CRM-002** | Given a PM, When they UPDATE a contact in their org, Then it persists | pgTAP | 0072 |
| **AC-CRM-003** | Given a PM, When they archive a contact (set archived_at), Then it persists | pgTAP | 0072 |
| **AC-CRM-004** | Given an Engineer, When they INSERT a contact, Then RLS WITH CHECK denies (42501) | pgTAP | 0072 |
| **AC-CRM-005** | Given an Engineer, When they UPDATE a contact, Then USING hides it (0-row no-op) | pgTAP | 0072 |
| **AC-CRM-006** | Given a cross-org PM-B, When they SELECT contacts, Then 0 rows (org isolation) | pgTAP | 0072 |
| **AC-CRM-007** | Given an Admin, When they hard-delete a contact, Then it and its activities are gone (cascade) | pgTAP | 0072 |
| **AC-CRM-008** | Given a PM-B, When they hard-delete an org-A contact, Then 0-row no-op (Admin-only + USING) | pgTAP | 0072 |
| **AC-CRM-009** | Given a PM, When they INSERT a crm_activity on an in-org contact (no org_id sent), Then org stamped from parent + lives_ok | pgTAP | `supabase/tests/0073_crm_activity_rls.test.sql` |
| **AC-CRM-010** | Given a PM, When they INSERT an activity on an org-B contact, Then parent-org guard denies (42501) | pgTAP | 0073 |
| **AC-CRM-011** | Given a cross-org PM-B, When they SELECT crm_activities, Then 0 rows | pgTAP | 0073 |
| **AC-CRM-012** | Given an Engineer, When they INSERT a crm_activity, Then RLS denies (42501) | pgTAP | 0073 |
| **AC-CRM-013** | Given deleting a contact, When the cascade runs, Then its crm_activities are deleted | pgTAP | 0073 |
| **AC-CRM-020** | `listContacts()` selects non-archived, ordered by name; org_id never sent | Vitest (DAL) | `src/lib/db/contacts.test.ts` |
| **AC-CRM-021** | `listContactsByCompany(id)` filters company_id + non-archived | Vitest (DAL) | `src/lib/db/contacts.test.ts` |
| **AC-CRM-022** | `createContact/updateContact/archiveContact/deleteContact` issue the right query; org_id never sent | Vitest (DAL) | `src/lib/db/contacts.test.ts` |
| **AC-CRM-023** | `listActivities(contactId)` orders occurred_at desc; `createActivity` sends contact_id+kind+logged_by | Vitest (DAL) | `src/lib/db/crmActivities.test.ts` |
| **AC-CRM-024** | `can('create','contact')` = MASTER_DATA; `archive` = ARCHIVE_ROLES; `delete` = ADMIN; deny-by-default | Vitest (policy) | `src/auth/policy.test.ts` |
| **AC-CRM-025** | `can('create','contactActivity')` = MASTER_DATA; Engineer denied | Vitest (policy) | `src/auth/policy.test.ts` |
| **AC-CRM-030** | Contacts page renders loading→empty→error→rows; a non-writer sees no "New contact" button | Vitest (RTL) | `pages/Contacts.test.tsx` |
| **AC-CRM-031** | Logging an activity in the drawer prepends it to the timeline; empty state shows "No activity logged yet" | Vitest (RTL) | `pages/Contacts.test.tsx` |
| **AC-CRM-032** | A user can open Contacts, create a contact, log an activity, and see it in the timeline (real cross-stack) | E2E (Playwright) | `e2e/AC-CRM-032-contacts-activity.spec.ts` |

**pgTAP-owned ACs:** AC-CRM-001..013 (13). **Vitest-owned:** AC-CRM-020..031 (10). **E2E-owned:** AC-CRM-032 (1). **Total ACs = 24.**

---

## 3. Tasks (TDD-first; 2–5 min each; exact paths + code + verify)

> Run all `npm`/`vitest`/`tsc` commands **inside `pmo-portal/`**. Run `supabase`/pgTAP from the **repo root**.
> Convention: write the failing test FIRST (red), then the implementation (green).

### Phase A — Migration (schema + RLS + indexes)

**Task A1 — write the pgTAP RLS test for contacts (RED).** `supabase/tests/0072_crm_rls.test.sql`.
Clone `supabase/tests/0051_companies_crud.test.sql` structure (two orgs, owner-inserted fixtures, JWT
`set local request.jwt.claims`). Use namespace `00720000-…`. Cover AC-CRM-001..008 exactly. Each
`select`'s description **leads with its `AC-CRM-00X`** (e.g. `'AC-CRM-001: in-org PM can insert a contact (org_id defaulted, never sent)'`).
Required rows: org-A + org-B, a PM/Engineer/Admin in org-A, a PM in org-B; a `companies` row per org
(contacts.company_id FK). Assertions: `lives_ok` insert (no org_id), `lives_ok` update, `lives_ok` archive,
`throws_ok(…, '42501')` Engineer insert, `lives_ok`+`is` 0-row no-op Engineer update, `results_eq(count,0)`
cross-org select, Admin cascade delete `lives_ok`+activities gone, PM-B delete 0-row no-op. `select plan(N)`.
**Verify:** `supabase test db 2>&1 | grep 0072` → fails (table missing).

**Task A2 — write the pgTAP RLS test for crm_activities (RED).** `supabase/tests/0073_crm_activity_rls.test.sql`.
Mirror `0070_procurement_files_rls.test.sql`. Namespace `00730000-…`. Cover AC-CRM-009..013. Insert an
org-A contact + an org-B contact (owner-inserted). Assertions: PM inserts activity on in-org contact
(no org_id) `lives_ok`; PM inserts on org-B contact `throws_ok '42501'` (parent-org guard); PM-B select
`results_eq(count,0)`; Engineer insert `throws_ok '42501'`; delete parent contact (owner) → activities
`results_eq(count,0)` (cascade). Each description leads with `AC-CRM-00X`.
**Verify:** `supabase test db 2>&1 | grep 0073` → fails.

**Task A3 — write the migration (GREEN).** `supabase/migrations/0030_crm_contacts_activity.sql`. Exact DDL:

```sql
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
```

**Verify:** `supabase db reset && supabase test db 2>&1 | grep -E '0072|0073'` → both pass (green). All AC-CRM-001..013 satisfied.

**Task A4 — regenerate typed client.** Run `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`
(ADR-0003 R3 posture; if the local stack is up). Adds `contacts` + `crm_activities` to `Tables<>`.
**Verify (from `pmo-portal/`):** `npm run typecheck` → 0 errors AND `grep -c "crm_activities" src/lib/supabase/database.types.ts` → ≥1.

### Phase B — DAL (`src/lib/db/`)

**Task B1 — write `contacts.test.ts` (RED).** `pmo-portal/src/lib/db/contacts.test.ts`. Clone the
`vi.hoisted` chainable-builder mock from `src/lib/db/companies.test.ts`. Cover AC-CRM-020/021/022:
`listContacts` asserts `from('contacts')` + `.is('archived_at', null)` + `.order('full_name')`;
`listContactsByCompany` adds `.eq('company_id', id)`; `createContact` asserts `.insert` payload has NO
`org_id` key; `updateContact`/`archiveContact`/`deleteContact` assert the right verb. Title each `it()`
with its AC id (e.g. `it('lists non-archived contacts ordered by name (AC-CRM-020)', …)`).
**Verify (from `pmo-portal/`):** `npx vitest run src/lib/db/contacts.test.ts` → fails (module missing).

**Task B2 — implement `contacts.ts` (GREEN).** `pmo-portal/src/lib/db/contacts.ts`. Clone the shape of
`src/lib/db/companies.ts` (same `throwWrite`/`AppError` pattern). Exact exports + signatures:

```ts
export type ContactRow = Tables<'contacts'>;
export interface ContactInput {            // org_id is NEVER among these — RLS stamps it.
  company_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}
export async function listContacts(): Promise<ContactRow[]>;                 // .is('archived_at', null).order('full_name')
export async function listContactsByCompany(companyId: string): Promise<ContactRow[]>; // + .eq('company_id', companyId)
export async function getContact(id: string): Promise<ContactRow | null>;    // .maybeSingle()
export async function createContact(input: ContactInput): Promise<ContactRow>;
export async function updateContact(id: string, input: ContactInput): Promise<void>;
export async function archiveContact(id: string): Promise<void>;             // update archived_at = now ISO
export async function deleteContact(id: string): Promise<void>;
```
**Verify (from `pmo-portal/`):** `npx vitest run src/lib/db/contacts.test.ts` → passes. AC-CRM-020/021/022 green.

**Task B3 — write `crmActivities.test.ts` (RED).** `pmo-portal/src/lib/db/crmActivities.test.ts`. Same
mock harness. Cover AC-CRM-023: `listActivities(contactId)` asserts `from('crm_activities')` +
`.eq('contact_id', contactId)` + `.order('occurred_at', { ascending: false })`; `createActivity` asserts
the insert payload contains `contact_id`/`kind`/`subject`/`body`/`occurred_at`/`logged_by_id` and **no
`org_id`**. Title `it()`s with AC-CRM-023.
**Verify (from `pmo-portal/`):** `npx vitest run src/lib/db/crmActivities.test.ts` → fails.

**Task B4 — implement `crmActivities.ts` (GREEN).** `pmo-portal/src/lib/db/crmActivities.ts`. Exact exports:

```ts
export type CrmActivityRow = Tables<'crm_activities'>;
export type CrmActivityKind = CrmActivityRow['kind'];   // 'Call'|'Email'|'Meeting'|'Note'
export interface CrmActivityInput {        // org_id NEVER sent — trigger stamps from parent contact.
  contact_id: string;
  kind: CrmActivityKind;
  subject: string | null;
  body: string | null;
  occurred_at: string;                     // ISO; defaults to now() at the form
  company_id: string | null;
  project_id: string | null;
}
export async function listActivities(contactId: string): Promise<CrmActivityRow[]>;
export async function createActivity(input: CrmActivityInput, loggedById: string | null): Promise<CrmActivityRow>;
```
`createActivity` inserts `{ ...input, logged_by_id: loggedById }`.
**Verify (from `pmo-portal/`):** `npx vitest run src/lib/db/crmActivities.test.ts` → passes. AC-CRM-023 green.

### Phase C — Repository seam + hooks

**Task C1 — add `ContactRepository` to `types.ts`.** `pmo-portal/src/lib/repositories/types.ts`.
Add imports + interface + add `contact: ContactRepository;` to `Repositories`:
```ts
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityRow, CrmActivityInput } from '@/src/lib/db/crmActivities';
export interface ContactRepository {
  list(): Promise<ContactRow[]>;
  listByCompany(companyId: string): Promise<ContactRow[]>;
  get(id: string): Promise<ContactRow | null>;
  create(input: ContactInput): Promise<ContactRow>;
  update(id: string, input: ContactInput): Promise<void>;
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  listActivities(contactId: string): Promise<CrmActivityRow[]>;
  createActivity(input: CrmActivityInput, loggedById: string | null): Promise<CrmActivityRow>;
}
```
**Verify (from `pmo-portal/`):** `npm run typecheck` → fails only at `index.ts` (contact not yet assembled) — expected next task.

**Task C2 — wire `contact` in `index.ts`.** `pmo-portal/src/lib/repositories/index.ts`. Import the 8 DAL
fns from `contacts`/`crmActivities`, build a `const contact: ContactRepository = { list: () => wrap(() =>
listContacts()), listByCompany: (id) => wrap(() => listContactsByCompany(id)), get: (id) => wrap(() =>
getContact(id)), create: (i) => wrap(() => createContact(i)), update: (id, i) => wrap(() =>
updateContact(id, i)), archive: (id) => wrap(() => archiveContact(id)), delete: (id) => wrap(() =>
deleteContact(id)), listActivities: (id) => wrap(() => listActivities(id)), createActivity: (i, by) =>
wrap(() => createActivity(i, by)) };` and add `contact` to the exported `repositories` object + the
re-exported types list.
**Verify (from `pmo-portal/`):** `npm run typecheck` → 0 errors.

**Task C3 — implement `useContacts.ts`.** `pmo-portal/src/hooks/useContacts.ts`. Clone `useCompanies.ts`.
Exports: `useContacts()` (queryKey `['contacts', orgId]`, `enabled: Boolean(orgId)`),
`useContactsByCompany(companyId)` (queryKey `['contacts','by-company', orgId, companyId]`,
`enabled: Boolean(orgId && companyId)`), `useContactActivities(contactId)` (queryKey
`['crm-activities', orgId, contactId]`), and `useContactMutations()` returning `{ create, update,
archive, remove, logActivity }` — each invalidating `['contacts']` (and `logActivity` also invalidates
`['crm-activities']`). `logActivity` calls `repositories.contact.createActivity(input, currentUser?.id ?? null)`.
**Verify (from `pmo-portal/`):** `npm run typecheck` → 0 errors.

### Phase D — Authorization (`can()`)

**Task D1 — add policy entries test (RED).** `pmo-portal/src/auth/policy.test.ts` (append). Cover
AC-CRM-024/025: `expect(can('create','contact',{realRole:'Project Manager'})).toBe(true)`;
`expect(can('archive','contact',{realRole:'Project Manager'})).toBe(false)` (ARCHIVE_ROLES);
`expect(can('archive','contact',{realRole:'Executive'})).toBe(true)`;
`expect(can('delete','contact',{realRole:'Admin'})).toBe(true)` and `…'Executive'…toBe(false)`;
`expect(can('create','contactActivity',{realRole:'Finance'})).toBe(true)` and `…'Engineer'…toBe(false)`.
Title each with its AC id.
**Verify (from `pmo-portal/`):** `npx vitest run src/auth/policy.test.ts` → fails.

**Task D2 — add `contact` + `contactActivity` to `policy.ts` (GREEN).** `pmo-portal/src/auth/policy.ts`.
Add `'contact' | 'contactActivity'` to the `Entity` union; add to `POLICY`:
```ts
contact: {
  view: allow(MASTER_DATA),
  create: allow(MASTER_DATA),
  edit: allow(MASTER_DATA),
  archive: allow(ARCHIVE_ROLES),
  delete: allow(ADMIN),
},
contactActivity: {
  view: allow(MASTER_DATA),
  create: allow(MASTER_DATA),
},
```
**Verify (from `pmo-portal/`):** `npx vitest run src/auth/policy.test.ts` → passes. AC-CRM-024/025 green.

### Phase E — Contacts page + drawer + timeline

**Task E1 — write `Contacts.test.tsx` (RED).** `pmo-portal/pages/Contacts.test.tsx`. Cover AC-CRM-030/031.
Mock `useContacts`/`useContactMutations`/`useContactActivities` + `usePermission`. Assert: loading →
6-row `ListState`; `data:[]` → empty state copy; `isError` → error + Retry; rows render the Company
column; a non-writer (`may` returns false) shows NO "New contact" button; opening the drawer and logging
an activity calls `logActivity` and prepends to the timeline; empty timeline shows "No activity logged yet".
Title `it()`s with AC ids.
**Verify (from `pmo-portal/`):** `npx vitest run pages/Contacts.test.tsx` → fails.

**Task E2 — implement `pages/Contacts.tsx` (GREEN).** Clone `pages/Companies.tsx`. Differences: title
"Contacts"; columns = Name (semibold) + Company (resolved via a `companyById` map from `useCompanies`) +
Email; filter = a Company `ViewToggle`/`SelectField` (default All) instead of the type segment; search
over `full_name`+`email`; `usePermission` gates with entity `'contact'`; the create/edit modal uses
`TextField` (full_name required, title, email, phone) + a `Combobox`/`SelectField` for company (options
from `useCompanies`) + a `notes` textarea via `TextField`. The drawer body renders `<ContactActivityPanel
contactId={drawerContact.id} />`. `validate` requires `full_name` + `company_id`.
**Verify (from `pmo-portal/`):** `npx vitest run pages/Contacts.test.tsx` → passes AC-CRM-030; `npm run typecheck` → 0 errors.

**Task E3 — implement `ContactActivityPanel`.** Add to `pages/Contacts.tsx` (or
`pages/contacts/ContactActivityPanel.tsx`). Reads `useContactActivities(contactId)`; renders the
timeline newest-first (each row = `StatusPill` kind + subject + relative `occurred_at` + body);
loading/empty("No activity logged yet")/error states; a "Log activity" form (`SelectField` kind,
`TextField` subject, `TextField` body, a date input for `occurred_at` defaulting to now) gated by
`can('create','contactActivity')`; on submit calls `logActivity.mutateAsync` then toasts + resets.
**Verify (from `pmo-portal/`):** `npx vitest run pages/Contacts.test.tsx` → passes AC-CRM-031.

**Task E4 — register the route + nav + ⌘K.** Three append-only edits:
- `pmo-portal/App.tsx`: add `const ContactsPage = React.lazy(() => import('./pages/Contacts'));` and
  `<Route path="/contacts" element={<ContactsPage />} />` (next to `/companies`).
- `pmo-portal/src/components/shell/Rail.tsx`: add to `ALL_ITEMS`:
  `{ to: '/contacts', text: 'Contacts', icon: 'doc', group: 'Sales', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] }`.
- `pmo-portal/src/components/shell/routeMatch.ts`: add to `MODULES`:
  `{ module: 'contacts', icon: 'doc', label: 'Contacts', path: '/contacts', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] }`.
**Verify (from `pmo-portal/`):** `npm run typecheck` → 0 errors AND `npm run build` → succeeds.

### Phase F — Company-detail touch (the one existing-file behavior change)

**Task F1 — surface a company's contacts in the Companies Drawer.** `pmo-portal/pages/Companies.tsx`.
In `CompanyDrawer`, add a read-only "Contacts" `DField` listing `useContactsByCompany(company.id)`
results (name + title), with its own loading/empty ("No contacts yet") states. (Satisfies FR-CRM-008;
covered behaviorally by AC-CRM-021 at the DAL layer — no new owning AC, this is presentational reuse.)
**Verify (from `pmo-portal/`):** `npm run typecheck` → 0 errors AND `npx vitest run pages/Companies.test.tsx` → still passes (no regression).

### Phase G — E2E (one real journey)

**Task G1 — write the E2E journey (RED→GREEN).** `pmo-portal/e2e/AC-CRM-032-contacts-activity.spec.ts`.
Title `test('AC-CRM-032: a manager creates a contact and logs an activity', …)`. Journey (the user's real
intuitive path to the goal): sign in as a PM → open Contacts via the rail → click "New contact" → fill
name + pick a company → save → open the new contact's drawer → "Log activity" (kind=Call, subject) →
**assert the activity appears in the timeline** (the goal oracle — not merely "a form exists"). Use the
serial-e2e + dedicated-fixture conventions (MEMORY: full-serial-e2e).
**Verify (from `pmo-portal/`):** `npx playwright test e2e/AC-CRM-032-contacts-activity.spec.ts` → passes.

### Phase H — Gate

**Task H1 — full gate.** From `pmo-portal/`: `npm run typecheck && npm run lint:ci && npm run test:coverage`
(≥80% changed-line coverage). From repo root: `supabase test db` (all pgTAP green).
**Verify:** all three pass; coverage on changed files ≥80%.

---

## 4. Definition of Done
- Migration 0030 applies + reverses (`supabase db reset`); RLS forced on both tables; `org_id` seam
  (contacts column-default; activities trigger); indexes on every hot path.
- All 24 AC-CRM at their owning layer (13 pgTAP, 10 Vitest, 1 E2E), each `grep`-able by AC id.
- `npm run typecheck` 0 · `lint:ci` 0 warnings · ≥80% changed-line coverage.
- Net-new files + 4 append-only existing-file touches (App.tsx, Rail.tsx, routeMatch.ts, policy.ts,
  repositories/{types,index}.ts) + 1 behavior touch (Companies.tsx Drawer).

## 5. Open questions for the Director
- **None blocking.** Confirm migration **0030** is still free at merge time (renumber if another Wave-3
  stream lands a migration first).
- v1 defers: activity edit/delete, contact↔deal/pipeline linkage, reminders, bulk ops, contact CSV
  import (the Import stream may later add a Contacts source — out of scope here).
