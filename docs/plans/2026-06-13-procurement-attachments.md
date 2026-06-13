# Plan — Procurement attachments (ERP-grade, per-phase child tables)

- **Feature:** Procurement attachments — many files per phase row (quotation / GR / VI).
- **Branch:** `dev` (KANNA-parity stream; grill + mockup skipped per Director).
- **Date:** 2026-06-13
- **Scope owner:** procurement. Touches ONLY procurement-file tables, `src/lib/db/procurementFiles.ts`,
  the repository seam, `useProcurementFiles` hook, and `pages/ProcurementDetails.tsx` + its
  `pages/procurement/*` sub-sections. **No change** to migrations 0001–0027, the procurement lifecycle
  RPCs, `documents.ts`, or any other stream. **Reuse #78 upload infra unchanged** (bucket-agnostic).
- **Locked decisions (do NOT re-open):** per-phase child tables (NOT polymorphic); new private bucket
  `procurement-files`; RLS is the enforcement authority + `can()` for UX gating; deletes = soft-archive
  (`archived_at`); legacy `procurement_quotations.file_url` untouched (deprecated); v1 phases =
  quotation, GR, VI only (PR/PO header attachments = future, not built); Admin-only hard delete = out of scope.

---

## 1. Design

### 1.1 Architecture (3 layers + repository seam, ADR-0017)

```
ProcurementDetails (page)
  └─ QuotationsSection / GR rows / VI rows  →  <ProcurementFilesSubsection phase=... parentId=.../>
        └─ FileCell (#78, unchanged)  +  useProcurementFiles(procurementId)  [new hook]
              └─ repositories.procurementFiles.*  [new repo slice]
                    └─ src/lib/db/procurementFiles.ts  [new DAL]
                          └─ Supabase: 3 child tables + private bucket  [new migration 0028]
```

The DAL never takes `org_id`/`procurement_id` from the client — it fetches the parent row server-side and
RLS + the column default stamp `org_id`. This mirrors `documents.ts` exactly.

### 1.2 Data model — 3 per-phase child tables (migration 0028)

One table per phase. Each has the **same column shape** (org_id default + stamping pattern of 0006 child
tables `procurement_receipts`/`procurement_invoices`), differing only in the parent FK:

| Table | Parent FK (`on delete cascade`) |
|---|---|
| `procurement_quotation_files` | `quotation_id → procurement_quotations(id)` |
| `procurement_receipt_files` | `receipt_id → procurement_receipts(id)` |
| `procurement_invoice_files` | `invoice_id → procurement_invoices(id)` |

Columns (all three): `id uuid pk default gen_random_uuid()`, `org_id uuid not null references
organizations(id) default '00000000-0000-0000-0000-000000000001'`, `<phase>_id uuid not null references
<phase>(id) on delete cascade`, `title text`, `file_path text`, `uploaded_by_id uuid references
profiles(id)`, `created_at timestamptz not null default now()`, `archived_at timestamptz` (ADR-0018).

RLS on each (force RLS, ADR-0004): `select` = `org_id = auth_org_id()`; `for all` write = `org_id =
auth_org_id() AND auth_role() in ('Admin','Executive','Project Manager','Finance') AND <parent-org guard>`
— exact shape of `procurement_receipts_write` in 0006 (HIGH-BV-1 parent-org guard).

### 1.3 Storage — private bucket `procurement-files` (migration 0028)

- Bucket: private, 5 MB limit, **same MIME allowlist as 0025** (reuse `ALLOWED_MIME_TYPES`).
- Object path (6-segment): `{org_id}/{procurement_id}/{phase}/{file_id}/{filename}` where
  `phase ∈ {quotation,receipt,invoice}` and `file_id` = the child-table row id.
- Storage RLS mirrors 0025 (`storage_objects_project_doc_*`) but with a **6-segment** path and the
  procurement role gate. There is **no Draft-status gate** (procurement files attach at any phase the
  parent row exists). Write policy verifies segment 1 = `auth_org_id()` and segment 2 references a
  procurement in the caller's org (the existence check binds the path's procurement_id to an in-org row).

### 1.4 Reuse vs net-new

| Reused unchanged (#78 / #25 infra) | Net-new this feature |
|---|---|
| `FileCell`, `uploadWithProgress`, `classifyUploadError` | `src/lib/db/procurementFiles.ts` (DAL) |
| `fileConstants.ts` (MIME/size/ext/expiry) | `procurementFiles` repository slice + types |
| `sanitizeFilename` (storageKey.ts) | `buildProcurementFilePath` helper |
| signed prepare/confirm shape | `useProcurementFiles` hook (per-phase list/upload/archive) |
| `ConfirmDialog`, `classifyMutationError`, `can()` | `ProcurementFilesSubsection` component |
| | migration `0028` + pgTAP `0070` |

`useFileUpload` (#78) is **project-documents-specific** (invalidates `['project-documents']`, calls
`repositories.document.*`). We write a parallel `useProcurementFiles` rather than generalize it — keeps
streams isolated, no behavior change to the documents register.

### 1.5 Collision risk

**Isolated.** Export/Calendar (other Wave-1 streams) touch neither procurement files, ProcurementDetails,
nor the storage bucket. Only shared file is `src/lib/repositories/index.ts` (additive slice — append one
const + one key; no edits to existing slices) and `repositories/types.ts` (append one interface). Migration
number `0028` is the next free slot — coordinate so Export/Calendar take `0029+`.

---

## 2. Requirements (EARS)

- **FR-PF-001** (ubiquitous) The system SHALL store procurement file attachments in three per-phase child
  tables (`procurement_quotation_files`, `procurement_receipt_files`, `procurement_invoice_files`), each
  cascading on parent delete.
- **FR-PF-002** (ubiquitous) The system SHALL stamp `org_id` on every file row from the column default and
  the parent-org guard; the client SHALL NEVER supply `org_id`.
- **FR-PF-003** (event) When an authenticated user in the writer role set
  (Admin/Executive/Project Manager/Finance) uploads a file to a phase row in their org, the system SHALL
  create a row and a storage object at `{org_id}/{procurement_id}/{phase}/{file_id}/{filename}`.
- **FR-PF-004** (event) When a user requests a phase's files, the system SHALL return the org's non-archived
  rows for that parent, newest first.
- **FR-PF-005** (event) When a writer archives a file, the system SHALL set `archived_at = now()`
  (soft-archive, ADR-0018) and the row SHALL no longer appear in the default list.
- **FR-PF-006** (event) When a user requests a download, the system SHALL return a signed URL
  (`SIGNED_URL_EXPIRY_SECONDS`) scoped to their org.
- **FR-PF-007** (state) While a procurement record is open, the UI SHALL show a files sub-section under each
  applicable phase, gated for write by `can('create','procFile')`.
- **OBS-PF-010** (observed) The legacy `procurement_quotations.file_url` column remains untouched and
  deprecated; the child table is the source of truth for multiple files.
- **NFR-PF-001** Cross-org reads/writes of any file table or storage object SHALL be denied by RLS
  (enforcement authority), independently of the FE `can()` gate.
- **NFR-PF-002** Files SHALL obey the shared 5 MB cap + MIME allowlist (`fileConstants.ts` / bucket).

---

## 3. Acceptance criteria (Given/When/Then) + traceability (ADR-0010)

| AC | Statement (abbrev.) | Owning layer | Test file |
|---|---|---|---|
| **AC-PF-001** | Given an in-org PM, When upload to a quotation row, Then a `procurement_quotation_files` row is created with `org_id` stamped + `uploaded_by_id` set | pgTAP | `supabase/tests/0070_procurement_files_rls.test.sql` |
| **AC-PF-002** | Given a cross-org user, When selecting another org's file rows, Then 0 rows (RLS denies) | pgTAP | `0070_...` |
| **AC-PF-003** | Given an Engineer (non-writer), When insert a file row, Then 42501 (role gate) | pgTAP | `0070_...` |
| **AC-PF-004** | Given a file stamped with caller's org but a parent in another org, When insert, Then denied (parent-org guard) | pgTAP | `0070_...` |
| **AC-PF-005** | Given a parent quotation row, When the parent is deleted, Then its file rows are deleted (cascade) | pgTAP | `0070_...` |
| **AC-PF-006** | Given an in-org PM, When write a storage object at the 6-seg procurement path, Then allowed; cross-org path → 42501 | pgTAP | `0071_procurement_files_storage_rls.test.sql` |
| **AC-PF-007** | Given anon, When read procurement-files objects, Then 0 rows | pgTAP | `0071_...` |
| **AC-PF-008** | Given `listProcurementFiles('quotation', id)`, When called, Then DAL queries `procurement_quotation_files` filtered to non-archived, newest-first | Vitest | `src/lib/db/procurementFiles.test.ts` |
| **AC-PF-009** | Given `prepareUpload`, When called for a phase+id+filename, Then it builds the 6-seg path + returns the signed URL shape `{signedUrl,path}` | Vitest | `src/lib/db/procurementFiles.test.ts` |
| **AC-PF-010** | Given `archiveProcurementFile`, When called, Then it updates `archived_at` on the right table | Vitest | `src/lib/db/procurementFiles.test.ts` |
| **AC-PF-011** | Given `buildProcurementFilePath`, When called, Then returns `{org}/{proc}/{phase}/{fileId}/{sanitized}` | Vitest | `src/lib/db/procurementFiles.test.ts` |
| **AC-PF-012** | Given a writer, When the files sub-section renders, Then an Upload affordance shows; given a non-writer, Then read-only (download only, no upload/archive) | Vitest | `pages/procurement/ProcurementFilesSubsection.test.tsx` |
| **AC-PF-013** | Given files exist, When the sub-section renders, Then each file shows a name + download; archive prompts a `ConfirmDialog` before write | Vitest | `pages/procurement/ProcurementFilesSubsection.test.tsx` |

**Layer rationale:** RLS/tenancy/role/cascade → pgTAP (AC-PF-001..007, **7 ACs**). DAL/path/UI logic →
Vitest (AC-PF-008..013, **6 ACs**). **No e2e** — no net-new cross-stack journey beyond what #78 already
covers; the upload transport is reused and already e2e-proven. **Total: 13 ACs (7 pgTAP, 6 Vitest).**

---

## 4. Tasks (TDD; 2–5 min each; exact paths + verify commands)

Run all `npm`/`vitest` from `pmo-portal/`; all `supabase` from repo root. `tsc`/Vitest reference paths
use the `@/` alias (= `pmo-portal/`).

### Migration

**T1 — Write migration 0028 (3 tables + RLS + bucket + storage RLS).**
File: `supabase/migrations/0028_procurement_files.sql`. Content:

```sql
-- 0028_procurement_files.sql — Procurement attachments: 3 per-phase child file tables +
-- private storage bucket procurement-files + storage RLS. Forward-only, additive.
-- Reversibility (pre-prod): supabase db reset. Forward rollback:
--   drop policy if exists storage_objects_proc_file_read  on storage.objects;
--   drop policy if exists storage_objects_proc_file_write on storage.objects;
--   delete from storage.buckets where id = 'procurement-files';
--   drop table if exists procurement_invoice_files;
--   drop table if exists procurement_receipt_files;
--   drop table if exists procurement_quotation_files;

-- ── §1 quotation files ──────────────────────────────────────────────────────
create table procurement_quotation_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  quotation_id  uuid not null references procurement_quotations(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index procurement_quotation_files_parent_idx on procurement_quotation_files (quotation_id);
alter table procurement_quotation_files enable row level security;
alter table procurement_quotation_files force  row level security;
create policy procurement_quotation_files_select on procurement_quotation_files for select using (org_id = auth_org_id());
create policy procurement_quotation_files_write on procurement_quotation_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_quotations q where q.id = procurement_quotation_files.quotation_id and q.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_quotations q where q.id = procurement_quotation_files.quotation_id and q.org_id = auth_org_id()));

-- ── §2 receipt files (GR) ───────────────────────────────────────────────────
create table procurement_receipt_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  receipt_id    uuid not null references procurement_receipts(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index procurement_receipt_files_parent_idx on procurement_receipt_files (receipt_id);
alter table procurement_receipt_files enable row level security;
alter table procurement_receipt_files force  row level security;
create policy procurement_receipt_files_select on procurement_receipt_files for select using (org_id = auth_org_id());
create policy procurement_receipt_files_write on procurement_receipt_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_receipts r where r.id = procurement_receipt_files.receipt_id and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_receipts r where r.id = procurement_receipt_files.receipt_id and r.org_id = auth_org_id()));

-- ── §3 invoice files (VI) ───────────────────────────────────────────────────
create table procurement_invoice_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  invoice_id    uuid not null references procurement_invoices(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create index procurement_invoice_files_parent_idx on procurement_invoice_files (invoice_id);
alter table procurement_invoice_files enable row level security;
alter table procurement_invoice_files force  row level security;
create policy procurement_invoice_files_select on procurement_invoice_files for select using (org_id = auth_org_id());
create policy procurement_invoice_files_write on procurement_invoice_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_invoices v where v.id = procurement_invoice_files.invoice_id and v.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_invoices v where v.id = procurement_invoice_files.invoice_id and v.org_id = auth_org_id()));

-- ── §4 storage bucket procurement-files (private, 5 MB, same MIME allowlist as 0025) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'procurement-files', 'procurement-files', false, 5242880,
    array[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/vnd.dxf', 'application/dxf', 'application/acad',
      'text/csv', 'text/plain'
    ]
  ) on conflict (id) do nothing;

-- ── §5 storage RLS: 6-segment path {org}/{proc}/{phase}/{file_id}/{filename} ──
-- Read: in-org + 5-segment shape (org/proc/phase/fileid/filename).
create policy storage_objects_proc_file_read on storage.objects
  for select
  using (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
  );
-- Write: in-org + writer role + 5-segment shape + segment-2 references an in-org procurement.
create policy storage_objects_proc_file_write on storage.objects
  for all
  using (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
      where p.id::text = split_part(name, '/', 2) and p.org_id = auth_org_id())
  )
  with check (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
      where p.id::text = split_part(name, '/', 2) and p.org_id = auth_org_id())
  );
```

> Path is `{org}/{proc}/{phase}/{file_id}/{filename}` = **5 slash-segments** (`string_to_array` length 5).
Verify: `cd /Users/ariefsaid/Coding/PMO && supabase db reset` → exits 0 (all migrations apply).

### pgTAP (write red, then make green is N/A — migration already authored; pgTAP proves it)

**T2 — pgTAP: file-table RLS (AC-PF-001..005).**
File: `supabase/tests/0070_procurement_files_rls.test.sql`. Model on `0018_procurement_new_table_rls.test.sql`
(write role gate + parent-org guard) and `0067` (idiom). `plan(5)`. Seed 2 orgs, a PM+Engineer in org A, a
PM in org B, a procurement + quotation/receipt/invoice in org A. Assertions:
`AC-PF-001` PM-A `lives_ok` insert into `procurement_quotation_files` (org_id from default);
`AC-PF-002` PM-B `results_eq … count = 0`;
`AC-PF-003` Engineer-A `throws_ok … '42501'`;
`AC-PF-004` PM-A `throws_ok` insert with `quotation_id` = an org-B quotation → denied;
`AC-PF-005` delete the parent quotation (as owner) then `results_eq` child count = 0.
Each test description **leads with its AC-id**.
Verify: `cd /Users/ariefsaid/Coding/PMO && supabase test db 2>&1 | grep 0070` → all pass.

**T3 — pgTAP: storage RLS (AC-PF-006, AC-PF-007).**
File: `supabase/tests/0071_procurement_files_storage_rls.test.sql`. Model on `0067`. `plan(4)`. Seed org A/B +
PM-A + a procurement in org A. `AC-PF-006`: PM-A `lives_ok` insert `storage.objects` at
`{orgA}/{procA}/quotation/{uuid}/q.pdf`; cross-org path (`{orgB}/...`) by PM-A `throws_ok '42501'`.
`AC-PF-007`: anon `results_eq count = 0`. In-org read of a seeded object `results_eq count = 1`.
Verify: `cd /Users/ariefsaid/Coding/PMO && supabase test db 2>&1 | grep 0071` → all pass.

### DAL (Vitest red → green)

**T4 — Write failing DAL tests (AC-PF-008..011).**
File: `pmo-portal/src/lib/db/procurementFiles.test.ts`. Mock `@/src/lib/supabase/client` (vi.hoisted chainable
builder, as in `documents.test.ts`). Tests, each titled with its AC-id:
`AC-PF-008 listProcurementFiles('quotation', id) selects procurement_quotation_files, filters archived_at is null, orders created_at desc`;
`AC-PF-009 prepareUpload returns {signedUrl, path} with a 5-segment path`;
`AC-PF-010 archiveProcurementFile('invoice', id) updates archived_at on procurement_invoice_files`;
`AC-PF-011 buildProcurementFilePath returns {org}/{proc}/{phase}/{fileId}/{sanitized-name}`.
Verify (red): `cd pmo-portal && npx vitest run src/lib/db/procurementFiles.test.ts` → fails (module missing).

**T5 — Implement the DAL (make T4 green).**
File: `pmo-portal/src/lib/db/procurementFiles.ts`. Export a `ProcPhase = 'quotation' | 'receipt' | 'invoice'`
union, a `TABLE_BY_PHASE` / `PARENT_COL_BY_PHASE` map, and `buildProcurementFilePath(orgId, procurementId,
phase, fileId, filename)` (uses `sanitizeFilename` from `storageKey.ts`; returns
`${orgId}/${procurementId}/${phase}/${fileId}/${sanitizeFilename(filename)}`). Functions mirror `documents.ts`
patterns (AppError + code-preserving `throwWrite`, never send `org_id`):
- `listProcurementFiles(phase, parentId)` → `.from(TABLE_BY_PHASE[phase]).select('*').eq(PARENT_COL[phase], parentId).is('archived_at', null).order('created_at',{ascending:false})`.
- `prepareUpload(phase, parentId, procurementId, fileName)` → `validateUploadExtension`, mint a `fileId` via
  `crypto.randomUUID()`, build the path, `supabase.storage.from('procurement-files').createSignedUploadUrl(path)`,
  return `{ signedUrl, path, fileId }`.
- `confirmUpload(phase, parentId, procurementId, fileId, path, title, uploadedById)` → insert the child row
  `{ [PARENT_COL]: parentId, file_path: path, title, uploaded_by_id: uploadedById }` (org_id from default).
- `archiveProcurementFile(phase, id)` → `.update({ archived_at: new Date().toISOString() }).eq('id', id)`.
- `getSignedDownloadUrl(filePath, opts?)` → same as documents.ts but bucket `'procurement-files'`.
- `cleanupStorageObject(filePath)` → `.storage.from('procurement-files').remove([filePath])` (non-fatal).
Verify (green): `cd pmo-portal && npx vitest run src/lib/db/procurementFiles.test.ts` → passes.

### Repository seam (additive)

**T6 — Add the `procurementFiles` interface to repo types.**
File: `pmo-portal/src/lib/repositories/types.ts`. Append `export interface ProcurementFileRepository { list,
prepareUpload, confirmUpload, archive, getSignedUrl, cleanupObject }` with signatures matching T5, and add
`procurementFiles: ProcurementFileRepository` to the `Repositories` interface.
Verify: `cd pmo-portal && npm run typecheck` → 0 errors.

**T7 — Wire the `procurementFiles` slice in the repo index.**
File: `pmo-portal/src/lib/repositories/index.ts`. Import the new DAL fns, add a `const procurementFiles:
ProcurementFileRepository = { list: (phase,id)=>wrap(()=>listProcurementFiles(phase,id)), ... }` block, add
`procurementFiles` to the exported `repositories` object and the re-exported type list.
Verify: `cd pmo-portal && npm run typecheck` → 0 errors.

### Hook (Vitest red → green)

**T8 — Write failing hook test.**
File: `pmo-portal/src/hooks/useProcurementFiles.test.ts`. Mock `@/src/lib/repositories` + `uploadTransport`.
Test (titled with AC-id) `AC-PF-009 useProcurementFiles.upload calls prepareUpload → uploadWithProgress →
confirmUpload and invalidates the phase query key`. Assert the three repo calls fire in order and
`queryClient.invalidateQueries({queryKey:['procurement-files', phase, parentId]})` runs.
Verify (red): `cd pmo-portal && npx vitest run src/hooks/useProcurementFiles.test.ts` → fails.

**T9 — Implement `useProcurementFiles` (make T8 green).**
File: `pmo-portal/src/hooks/useProcurementFiles.ts`. Model on `useFileUpload.ts`. Signature
`useProcurementFiles(phase: ProcPhase, parentId: string, procurementId: string)`. Provide `list`
(`useQuery(['procurement-files', phase, parentId], () => repositories.procurementFiles.list(phase, parentId))`),
`upload` mutation (prepare → `uploadWithProgress` with `FILE_MIME_BY_EXT` content-type + AbortController →
`confirmUpload`, then invalidate), `archive` mutation, `download` (calls `getSignedUrl`), per-file `progress`
+ `uploadErrors` state via `classifyUploadError`. `uploaded_by_id` = current user id (passed from the caller).
Verify (green): `cd pmo-portal && npx vitest run src/hooks/useProcurementFiles.test.ts` → passes.

### UI sub-section (Vitest red → green)

**T10 — Write failing sub-section tests (AC-PF-012, AC-PF-013).**
File: `pmo-portal/pages/procurement/ProcurementFilesSubsection.test.tsx`. Render with a fake
`useProcurementFiles` (mock the hook). Tests:
`AC-PF-012 writer sees an Upload affordance; non-writer (canWrite=false) sees download-only, no Upload/Archive`;
`AC-PF-013 archive click opens a ConfirmDialog and only archives on confirm; each file shows name + download`.
Verify (red): `cd pmo-portal && npx vitest run pages/procurement/ProcurementFilesSubsection.test.tsx` → fails.

**T11 — Implement `ProcurementFilesSubsection` (make T10 green).**
File: `pmo-portal/pages/procurement/ProcurementFilesSubsection.tsx`. Props: `{ phase: ProcPhase, parentId:
string, procurementId: string, canWrite: boolean, uploadedById: string | null }`. Calls
`useProcurementFiles(phase, parentId, procurementId)`. Renders a compact list of files using `FileCell`
(status passed as a constant `'Issued'`-equivalent so it shows the download/preview affordance; for writers a
hidden `<input type=file accept={FILE_INPUT_ACCEPT}>` drives `upload`). Archive affordance (writers only) →
`ConfirmDialog` → `archive.mutate`. Errors via `classifyMutationError` + toast. Strict `DESIGN.md` tokens
(no raw hex; 13px label scale like the surrounding sections).
Verify (green): `cd pmo-portal && npx vitest run pages/procurement/ProcurementFilesSubsection.test.tsx` → passes.

### Page integration (no new test — composition only; covered by T10/T11 unit + #78 e2e transport)

**T12 — Mount the sub-section in QuotationsSection (quotation phase).**
File: `pmo-portal/pages/procurement/QuotationsSection.tsx`. For each quotation row, render
`<ProcurementFilesSubsection phase="quotation" parentId={q.id} procurementId={procurementId} canWrite={canManageFiles} uploadedById={currentUserId}/>`.
Thread `procurementId`, `canManageFiles`, `currentUserId` as new props from the page (no behavior change to
existing quote add/select). Verify: `cd pmo-portal && npm run typecheck` → 0 errors.

**T13 — Mount the sub-section for GR & VI rows in ProcurementDetails.**
File: `pmo-portal/pages/ProcurementDetails.tsx`. In the "Document trail" Card, under each `p.receipts.map`
row add `<ProcurementFilesSubsection phase="receipt" parentId={r.id} procurementId={p.id} canWrite={canManageFiles} uploadedById={currentUser?.id ?? null}/>`
and under each `p.invoices.map` row the same with `phase="invoice"` / `parentId={inv.id}`. Add
`const canManageFiles = may('create', 'procFile');` near the other `can*` gates (line ~328). Pass
`procurementId`/`canManageFiles`/`currentUser?.id` into `<QuotationsSection>` (T12).
Verify: `cd pmo-portal && npm run typecheck && npx vitest run` → 0 errors, all green.

### Authorization policy entry

**T14 — Add the `procFile` entity to the policy `can()` matrix.**
File: `pmo-portal/src/auth/policy.ts`. Add `procFile` to the entity union and grant
`create`/`edit`/`delete` to `Admin · Executive · Project Manager · Finance` (mirror the `procDoc` entry).
This is UX-only (RLS is the authority). Add/extend a unit test in `src/auth/policy.test.ts`:
`AC-PF-007(ux) can('create','procFile') is true for the 4 writer roles, false for Engineer`.
Verify: `cd pmo-portal && npx vitest run src/auth/policy.test.ts && npm run typecheck` → green, 0 errors.

### Full gate

**T15 — Full verification.**
Verify: `cd /Users/ariefsaid/Coding/PMO && supabase db reset && supabase test db` (all pgTAP pass) **and**
`cd pmo-portal && npm run typecheck && npx eslint . --max-warnings=0 && npx vitest run` (0 errors, all green,
≥80% lines on changed files).

---

## 5. ADR

**ADR-0023 — Procurement attachments: per-phase child tables (not polymorphic).**
File: `docs/adr/0023-procurement-attachments-per-phase-tables.md`.
- **Context:** Multiple files per procurement phase (quotation/GR/VI). Options: (a) polymorphic
  `procurement_files(parent_type, parent_id)`; (b) three per-phase child tables.
- **Decision:** (b) — three typed child tables with real FKs + `on delete cascade`, toward a future ERP
  procurement module. A new private bucket `procurement-files` with 6-component org-scoped paths.
- **Consequences:** + real referential integrity, simple RLS reusing the 0006 parent-org-guard shape,
  cascade for free, no `parent_type` dispatch; − three near-identical tables/policies (accepted: ERP
  trajectory favors typed tables). Legacy `procurement_quotations.file_url` kept (deprecated). Hard-delete +
  PR/PO header attachments deferred.

---

## 6. Open questions for the Director

None blocking. One forward note (not an escalation): PR/PO **header** attachments are explicitly deferred per
the locked direction — if the owner later wants them, that is a follow-up issue (another child table +
bucket-path phase). The legacy single `file_url` migration/backfill is intentionally **not** addressed here.
