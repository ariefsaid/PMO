# Implementation Plan — Procurement records (case folder over ERP-canonical record tables), Issue 1

> **Authority:** `docs/specs/procurement-records.spec.md` (signed: 35 FR / 5 OBS / 12 NFR / 32 AC) +
> `docs/adr/0033-procurement-case-folder-record-tables.md` (ACCEPTED, Model C). Open Questions OQ-1..4
> RESOLVED in the spec. This plan expands the spec's Implementation TODO into 2–5-minute, no-placeholder
> tasks; it invents no scope beyond the spec.
>
> **Date:** 2026-06-19 · **Next migration number:** `0035` (highest existing = `0034`).
> **Next pgTAP test number:** `0075` (highest existing = `0074`).

## Overview

Reshape `procurements` from "the Purchase Request" into a **case folder** over seven ERP-canonical record
types (PR · RFQ · Quotation · PO · GR · VI · Payment), each its own 1:N table with a **dual identity**
(minted `*_number` + nullable `reference_number`), a user-set business `date` distinct from `created_at`,
status/amount, and per-record file uploads. Status stays **declared** via the SoD-gated
`transition_procurement()` RPC, which now writes minted PR#/PO#/PAY# onto **record rows** and upserts the
canonical PR@Requested / PO@Ordered / Payment@Paid record (OQ-3/OQ-4). The single `/procurement/:id` page
gains a progression-history timeline (transitions ∪ record-creation events) and inline per-phase
capture+upload — the JTBD P1 "operate the whole case on one page" fix.

Model C aggregate: `procurement_id` is the **mandatory** anchor on every record; the **PO** is the
commercial anchor of the settlement sub-chain via **nullable** predecessor FKs
(`procurement_receipts.po_id`, `procurement_invoices.po_id`, `payments.invoice_id`). PO-less is first-class.

### Grounding decisions (consumed as resolved)

- **OQ-1 (`procurement_documents`): KEEP** as the typed "Other / misc" catch-all — no fold/migrate.
- **OQ-2 (`pr_number`/`po_number` columns): RETAIN** denormalized for one cycle as a deprecated "latest"
  cache; the record row is authority. The `transition_procurement` RPC keeps writing the columns **and**
  additionally upserts the canonical record (so OBS reads + committed-spend + ProcurementDetails are
  untouched this issue — OBS-PR-003 / AC-PR-025).
- **OQ-3 (PR record timing): transition RPC upserts the canonical PR@→Requested / PO@→Ordered /
  Payment@→Paid**; extra records capturable inline (FR-PR-003).
- **OQ-4 (Payment vs Paid): payments = 1:N evidence**; the single `Paid` status is the SoD-b-gated
  declaration.
- **Prefixes:** quotations keep `VQ` (do NOT rename to QT — would orphan existing `VQ-…`). New prefixes
  `RFQ`, `PAY` reuse `next_procurement_doc_number` unchanged (OBS-PR-001).

## [PLAN-DECISION] index — resolved ambiguities (detail inline at first use)

- **[PD-1]** Record `status` column type: per-record **text + CHECK** (not new enums) — keeps the four new
  tables uniform and avoids enum sprawl; PR/RFQ/PO statuses are lightweight. GR/VI keep their existing
  enums (unchanged). Detail in Slice 1.
- **[PD-2]** `procurements.pr_number`/`po_number` retained (OQ-2) → transition RPC writes BOTH the column
  (cache) AND the canonical record (authority). Detail in Slice 4.
- **[PD-3]** Canonical-record upsert idempotency: insert the canonical record only when none yet carries the
  minted number for that case (a `not exists` guard), so re-entering a phase does not duplicate. Detail in
  Slice 4.
- **[PD-4]** History-union model lives in **TS** (`procurementHistory.ts`), built from the already-loaded
  detail bundle (no N+1, no new RPC) — NFR-PR-PERF-002. Detail in Slice 5.
- **[PD-5]** Settlement-chain predecessor FKs (`po_id`/`invoice_id`) are **captured inline-optional** in the
  UI (default null), not auto-wired by the RPC — the RPC only mints/anchors on the case. Detail in Slice 6.
- **[PD-7 — DIRECTOR OVERRIDE of the planner's "no transition-log" call]** FR-PR-025 + the owner's "see the
  historical progression" REQUIRE real status-transition events (who/when/from→to) — these are **not
  reconstructable** from current stamped case fields (rejections, re-cycles, multiple approvals are lost).
  So add a lightweight **`procurement_status_events`** log (one row per transition, written by the Slice-4
  RPC). This IS ADR-0033's "transition log ∪ record events" — NOT a separate audit engine. The history model
  (Slice 5.6) reads real events from this log, not synthesized markers. Detail in Slice 4 + Slice 5.6.

## Slices (dependency-ordered, each independently PR-able)

1. **Schema + RLS + org-stamp + business-date + nullable settlement FKs** — 4 new record tables
   (`purchase_requests`, `rfqs`, `purchase_orders`, `payments`), the `rfq_id`/`valid_until` quotation adds,
   the `po_id`/`invoice_id` settlement FKs, indexes, force-RLS, org-stamp triggers + schema pgTAP.
2. **Per-record file tables (PR/RFQ/PO/Payment) + storage RLS extension** — 4 new file tables mirroring
   0028 + storage path/role pgTAP.
3. **Creation RPCs + new prefixes** — `create_purchase_request / create_rfq / create_purchase_order /
   create_payment` (minter reuse, `RFQ`/`PAY`) + RPC pgTAP (mint, permissive-capture, cross-org, role).
4. **Revise `transition_procurement`** — write minted PR#/PO#/PAY# onto record rows + upsert canonical
   PR@Requested / PO@Ordered / Payment@Paid; SoD/map untouched; retain columns as cache; SoD/RLS re-proof +
   backfill (FR-PR-027) + committed-spend-unchanged pgTAP.
5. **Repository seam + lifecycle TS + history-union model + unit tests** — DAL creators, repository wiring,
   regenerated DB types, `procurementHistory.ts`, unit tests.
6. **Single-page UI** — `/procurement/:id` pipeline + history timeline + per-phase inline capture/upload +
   dual-ID + advance (honest doorway), gated via `can()`; component tests.
7. **E2E + axe + mobile-overflow** — `AC-PR-019/020/022` journeys, axe (026), mobile sweep (027).

## Traceability summary (AC → owning layer → slice)

| AC | Layer | Slice |
|---|---|---|
| AC-PR-001 | pgTAP | 1 |
| AC-PR-002 | pgTAP | 1 |
| AC-PR-003 | pgTAP | 1 |
| AC-PR-006 | pgTAP | 1 |
| AC-PR-028 | pgTAP | 1 |
| AC-PR-029 | pgTAP | 1 (chain) |
| AC-PR-030 | pgTAP | 1 (chain) |
| AC-PR-031 | pgTAP | 1 (chain) |
| AC-PR-032 | pgTAP | 1 |
| AC-PR-007 | pgTAP | 2 |
| AC-PR-008 | pgTAP | 2 |
| AC-PR-010 | pgTAP | 2 |
| AC-PR-004 | pgTAP | 3 |
| AC-PR-014 | pgTAP | 3 |
| AC-PR-015 | pgTAP | 3 |
| AC-PR-016 | pgTAP | 3 |
| AC-PR-017 | pgTAP | 3 |
| AC-PR-011 | pgTAP | 4 |
| AC-PR-012 | pgTAP | 4 |
| AC-PR-013 | pgTAP | 4 |
| AC-PR-023 | pgTAP | 4 |
| AC-PR-024 | pgTAP | 4 |
| AC-PR-025 | pgTAP | 4 |
| AC-PR-005 | Unit | 6 |
| AC-PR-009 | Unit | 5 |
| AC-PR-018 | Unit | 6 |
| AC-PR-021 | Unit | 5 |
| AC-PR-019 | E2E | 7 |
| AC-PR-020 | E2E | 7 |
| AC-PR-022 | E2E | 7 (folded into 019/020) |
| AC-PR-026 | E2E | 7 |
| AC-PR-027 | E2E | 7 |

## Pre-push gate (binding, every slice)

From `pmo-portal/`: **`npm run verify`** (= `typecheck && lint:ci && test && build`) — the WHOLE suite.
Backend slices additionally: `supabase test db` (pgTAP) after `supabase db reset`. Slice 6/7:
**render `/procurement/:id` before any promote** (MEMORY durable rule — verify-green ≠ visually-correct).

---

## Slice 1 — Schema + RLS + org-stamp + business-date + nullable settlement FKs

**Goal:** the four new record tables, the quotation column adds, the settlement predecessor FKs, indexes,
force-RLS, org-stamp triggers, and schema/chain pgTAP — all reversible, no behavior change to existing reads.
**Covers:** FR-PR-002/003/004/004a/004b/004c/004d/004e/005/008/009; AC-PR-001/002/003/006/028/029/030/031/032.

**[PD-1]** New-table `status` is `text not null` with a per-type `CHECK` (not new enums): PR
`('Draft','Submitted','Approved','Closed')`, RFQ `('Draft','Issued','Closed')`, PO
`('Draft','Issued','Acknowledged','Closed')`, Payment `('Scheduled','Paid')`. Rationale: four uniform tables,
no enum-migration sprawl; GR/VI keep their existing enums untouched. CHECK is reversible (drop column/table).

### Task 1.1 — Migration header + the four record tables

**File:** `supabase/migrations/0035_procurement_record_tables.sql` (NEW)
Write the file-top comment (mirror 0006/0028: forward-only, additive, reversibility = `supabase db reset`;
force-RLS per ADR-0004; parent-org guard per HIGH-BV-1; org-stamp trigger per 0015/0028; a rollback block
listing `drop table` for the 4 tables + `drop function` for the 4 trigger funcs). Then the four tables with
the **exact** shape below (mirrors 0006 child tables):

```sql
create table purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  pr_number        text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index purchase_requests_procurement_idx on purchase_requests (procurement_id);

create table rfqs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  rfq_number       text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Issued','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index rfqs_procurement_idx on rfqs (procurement_id);

create table purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  po_number        text,
  reference_number text,
  status           text not null default 'Draft' check (status in ('Draft','Issued','Acknowledged','Closed')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index purchase_orders_procurement_idx on purchase_orders (procurement_id);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id   uuid not null references procurements(id) on delete cascade,
  invoice_id       uuid references procurement_invoices(id),   -- nullable settlement predecessor (FR-PR-004b)
  pay_number       text,
  reference_number text,
  status           text not null default 'Scheduled' check (status in ('Scheduled','Paid')),
  date             date,
  amount           numeric(14,2),
  created_at       timestamptz not null default now()
);
create index payments_procurement_idx on payments (procurement_id);
```

**Verify:** `grep -c 'create table' supabase/migrations/0035_procurement_record_tables.sql` returns `4`.

### Task 1.2 — Settlement predecessor FKs + quotation P2-seam columns

**File:** `supabase/migrations/0035_procurement_record_tables.sql` (append). `payments.invoice_id` is already
on the new table (1.1); add the two settlement FKs to the REUSED tables + the two nullable quotation columns:

```sql
alter table procurement_receipts add column po_id uuid references purchase_orders(id);  -- FR-PR-004b nullable
alter table procurement_invoices add column po_id uuid references purchase_orders(id);  -- FR-PR-004b/004d nullable

alter table procurement_quotations
  add column rfq_id      uuid references rfqs(id),  -- FR-PR-004 RFQ→Quotation 1:N, nullable
  add column valid_until date;                      -- FR-PR-009 P2 seam, nullable
```

**Verify:** `grep -c 'add column' supabase/migrations/0035_procurement_record_tables.sql` returns `4`.

### Task 1.3 — Force-RLS + select/write policies on the four new tables

**File:** `supabase/migrations/0035_procurement_record_tables.sql` (append)
For EACH of `purchase_requests`, `rfqs`, `purchase_orders`, `payments`: enable+force RLS, a read-in-org
`select`, and a 4-role-write + parent-case-org-guard `for all` policy — the **exact** shape of
`procurement_receipts_write` in 0006 (NFR-PR-SEC-001 / OBS-PR-004 / FR-PR-018). Template (repeat ×4, swap
the table name):

```sql
alter table purchase_requests enable row level security;
alter table purchase_requests force  row level security;
create policy purchase_requests_select on purchase_requests for select using (org_id = auth_org_id());
create policy purchase_requests_write on purchase_requests for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_requests.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = purchase_requests.procurement_id and p.org_id = auth_org_id()));
```

**Verify:** `grep -c 'enable row level security' …0035….sql` returns `4` and `grep -c '_write on' …` returns `4`.

### Task 1.4 — org-stamp BEFORE INSERT triggers on the four new tables

**File:** `supabase/migrations/0035_procurement_record_tables.sql` (append)
Four `stamp_*_org()` trigger functions + triggers, mirroring `stamp_procurement_item_org` (0015): inherit
`org_id` from the parent procurement ONLY when null/seed-default (an explicit cross-org `org_id` is preserved
→ hits WITH CHECK, FR-PR-005). `set search_path = public`, schema-qualified (NFR-PR-SEC-004). Template (×4):

```sql
create or replace function stamp_purchase_request_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id from public.procurements p where p.id = new.procurement_id;
  end if;
  return new;
end; $$;
create trigger purchase_requests_stamp_org
  before insert on purchase_requests for each row execute function stamp_purchase_request_org();
```

**Verify:** `grep -c 'before insert on' …0035….sql` returns `4`.

### Task 1.5 — Apply migration locally (structural gate)

**Command:** `supabase db reset` (repo root). Proves the migration applies on top of 0001–0034.
**Verify:** exits 0 and prints `Applying migration 0035_procurement_record_tables.sql`.

### Task 1.6 — pgTAP: schema shape + 1:N + RFQ→Quotation + business-date

**File:** `supabase/tests/0075_procurement_records_schema.test.sql` (NEW). House style:
`begin; select plan(N); … select finish(); rollback;` (mirror 0018/0070). Use `has_column`, `col_not_null`,
`col_is_null`, `col_type_is`, `fk_ok`, `results_eq`. AC tag = leading token of each description. Cover:
- **AC-PR-001** — four tables exist; each has `id`, `org_id` (not null), `procurement_id` (not null,
  `fk_ok`→procurements), `*_number`, `reference_number` (nullable), `status`, `date`, `amount numeric(14,2)`.
- **AC-PR-028** — `procurement_id` not null on all four; `procurement_receipts.po_id`,
  `procurement_invoices.po_id`, `payments.invoice_id` exist and are **nullable** (`col_is_null`).
- **AC-PR-002** — insert two `purchase_orders` (+ two `payments`, two `procurement_receipts`) under one case
  (table owner); `results_eq count = 2` each.
- **AC-PR-003** — one `rfqs` + two `procurement_quotations` citing its `rfq_id` persist and join back; a
  third quotation with `rfq_id` null also persists.
- **AC-PR-006** — `has_column('procurement_quotations','rfq_id')` + `('…','valid_until')`, both nullable.
- **AC-PR-032** — insert a `purchase_orders` with `date = current_date - 5`; read back: `date` = prior day,
  `created_at::date = current_date`, `date <> created_at::date`.

**Verify:** `supabase test db` runs `0075_…` with all `plan` tests passing.

### Task 1.7 — pgTAP: Model-C settlement chain (PO-less, multi-PO, back-link)

**File:** `supabase/tests/0076_procurement_records_chain.test.sql` (NEW). House style as 1.6; inserts as
table owner. Cover:
- **AC-PR-029** — case with NO PR, NO quotation, NO PO; insert `procurement_invoices` (`po_id null`) + a
  `payments` (`invoice_id` → that invoice); both read back under the case (`count = 1` each).
- **AC-PR-030** — case with two `purchase_orders`; an invoice whose `po_id` = PO#2 joins to PO#2's id.
- **AC-PR-031** — insert invoice `po_id null`; later `update … set po_id = <PO>` succeeds, row count stays
  1, `po_id` now non-null (nullable + updatable).

**Verify:** `supabase test db` runs `0076_…` with all tests passing.

### Task 1.8 — Full pgTAP + slice verify

**Command:** `supabase test db` (whole suite — no regression in 0001–0074), then from `pmo-portal/`
`npm run typecheck`. **Verify:** both exit 0.

---

## Slice 2 — Per-record file tables (PR/RFQ/PO/Payment) + storage RLS extension

**Goal:** four new file tables (one per new record type) mirroring 0028, plus extending the existing storage
RLS to keep working for the new `{record_type}` path segment. The 0028 bucket + read/write storage policies
are already keyed on `{org}/{proc}/{phase}/{file_id}/{filename}` (5 segments) — the new record types reuse the
SAME bucket and the SAME 5-segment shape (segment-3 just becomes `purchase_request`/`rfq`/`purchase_order`/
`payment`), so **no storage-policy change is required**; this slice only adds the four metadata tables.
**Covers:** FR-PR-010/011/012/013; AC-PR-007/008/010.

**[NOTE]** The 0028 storage write policy gates on segment-2 = an in-org procurement (not on the phase
segment), so it already admits the new record types without modification — confirmed against
`storage_objects_proc_file_write` (0028 §5). Slice 2 reuses it as-is and proves it in pgTAP (AC-PR-010).

### Task 2.1 — Migration header + the four file tables

**File:** `supabase/migrations/0036_procurement_record_files.sql` (NEW)
File-top comment mirroring 0028 (forward-only; rollback block dropping the 4 file tables + 4 stamp funcs;
note that the bucket + storage policies are UNCHANGED — reused from 0028). Then four file tables, exact 0028
shape (swap the parent FK column per type). Template:

```sql
create table purchase_request_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  title          text,
  file_path      text,
  uploaded_by_id uuid references profiles(id),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index purchase_request_files_parent_idx
  on purchase_request_files (purchase_request_id, created_at desc) where archived_at is null;
```

Repeat for `rfq_files` (`rfq_id` → rfqs), `purchase_order_files` (`purchase_order_id` → purchase_orders),
`payment_files` (`payment_id` → payments). The partial index is the 0028 hot-path (NFR-PR-PERF-001).
**Verify:** `grep -c 'create table' supabase/migrations/0036_procurement_record_files.sql` returns `4`.

### Task 2.2 — Force-RLS + select/write policies on the four file tables

**File:** `supabase/migrations/0036_procurement_record_files.sql` (append)
For each file table: enable+force RLS, org-wide `select`, and a 4-role-write + parent-record-org-guard
`for all` policy — the **exact** shape of `procurement_quotation_files_write` (0028 §1, guard references the
parent RECORD table). Template:

```sql
alter table purchase_request_files enable row level security;
alter table purchase_request_files force  row level security;
create policy purchase_request_files_select on purchase_request_files for select using (org_id = auth_org_id());
create policy purchase_request_files_write on purchase_request_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_requests r where r.id = purchase_request_files.purchase_request_id and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.purchase_requests r where r.id = purchase_request_files.purchase_request_id and r.org_id = auth_org_id()));
```

**Verify:** `grep -c '_files_write on' …0036….sql` returns `4`.

### Task 2.3 — org-stamp triggers on the four file tables

**File:** `supabase/migrations/0036_procurement_record_files.sql` (append)
Four `stamp_*_file_org()` functions + triggers mirroring `stamp_procurement_quotation_file_org` (0028 §6) —
inherit org from the parent RECORD when null/seed-default. Template:

```sql
create or replace function stamp_purchase_request_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id from public.purchase_requests r where r.id = new.purchase_request_id;
  end if;
  return new;
end; $$;
create trigger purchase_request_files_stamp_org
  before insert on purchase_request_files for each row execute function stamp_purchase_request_file_org();
```

**Verify:** `grep -c 'before insert on' …0036….sql` returns `4`; `supabase db reset` exits 0.

### Task 2.4 — pgTAP: file-table RLS + multi-file + storage path/org gate

**File:** `supabase/tests/0077_procurement_record_files_rls.test.sql` (NEW). House style mirrors
`0070_procurement_files_rls.test.sql` (two orgs, roles, in-org/cross-org parents). Cover:
- **AC-PR-007** — the four file tables exist with `org_id`, parent FK (on delete cascade via `fk_ok`),
  `title`, `file_path`, `uploaded_by_id`, `created_at`, `archived_at`.
- **AC-PR-008** — attach two `purchase_request_files` rows to one PR record; both persist (`count = 2`).
- **AC-PR-010** — storage policy: as org-A writer, an INSERT into `storage.objects` with `name`
  `<orgA>/<procA>/purchase_order/<fid>/po.pdf` (in-org, writer, 5-seg, segment-2 = in-org proc) `lives_ok`;
  a `name` whose segment-1 = org-B `throws_ok` 42501; a `name` whose segment-2 references an out-of-org
  procurement `throws_ok` 42501. (Reuses `storage_objects_proc_file_write`, 0028 §5 — proves it admits the
  new `record_type` segment-3 unchanged.) Also: cross-org file-row INSERT (parent-org guard) → 42501, and
  explicit org-B `org_id` override on each new file table → 42501 (mirror 0070 AC-PROCFILE-ORG-OVERRIDE).

**Verify:** `supabase test db` runs `0077_…` with all tests passing; full `supabase test db` exits 0.

---

## Slice 3 — Creation RPCs + new prefixes (RFQ / PAY)

**Goal:** four thin security-definer creation RPCs — one per new record type — that mint the system number
(reusing `next_procurement_doc_number` with prefixes `PR`/`RFQ`/`PO`/`PAY`), re-assert the parent-org guard +
4-role gate internally, and accept the dual-identity fields (`reference_number`, business `date`, `amount`,
`status`, and for settlement records the nullable predecessor FK). These are the inline-capture authority for
records NOT minted by the transition RPC (FR-PR-017 permissive capture).
**Covers:** FR-PR-005/006/007/008/017/018/019; AC-PR-004/014/015/016/017.

**[NOTE]** The minter (`next_procurement_doc_number`) is unchanged — `RFQ`/`PAY` are just new prefix
arguments (OBS-PR-001/005, NFR-PR-SEC-005). No grant change to the minter.

### Task 3.1 — `create_purchase_request` RPC

**File:** `supabase/migrations/0037_procurement_record_rpcs.sql` (NEW)
File-top comment mirroring 0006 §A6 (ACL discipline; parent-org guard + role gate re-asserted; search_path
pinned; rollback = `drop function`). Then the RPC, mirroring `create_procurement_receipt` (0006 §A7) but
minting `PR` and accepting the dual-identity fields:

```sql
create or replace function create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns purchase_requests language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_requests;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.purchase_requests (procurement_id, pr_number, reference_number, status, date, amount)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PR'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_purchase_request(uuid, text, text, date, numeric) from public;
grant  execute on function create_purchase_request(uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_purchase_request(uuid, text, text, date, numeric) from anon;
```

**Verify:** `grep -c 'create or replace function create_' …0037….sql` ≥ 1 after this task.

### Task 3.2 — `create_rfq` RPC (prefix RFQ)

**File:** `supabase/migrations/0037_procurement_record_rpcs.sql` (append). Same shape as 3.1, returns `rfqs`,
mints prefix `'RFQ'`, status default `'Draft'`, columns `(procurement_id, rfq_number, reference_number,
status, date, amount)`. Same ACL block (signature `(uuid, text, text, date, numeric)`).
**Verify:** `grep -c "next_procurement_doc_number(v_org, 'RFQ')" …0037….sql` returns `1`.

### Task 3.3 — `create_purchase_order` RPC (prefix PO)

**File:** `supabase/migrations/0037_procurement_record_rpcs.sql` (append). Same shape, returns
`purchase_orders`, mints prefix `'PO'`, status default `'Draft'`, columns `(procurement_id, po_number,
reference_number, status, date, amount)`. Same ACL block.
**Verify:** `grep -c "next_procurement_doc_number(v_org, 'PO')" …0037….sql` returns `1`.

### Task 3.4 — `create_payment` RPC (prefix PAY, nullable invoice_id)

**File:** `supabase/migrations/0037_procurement_record_rpcs.sql` (append). Same guard shape, returns
`payments`, mints prefix `'PAY'`, status default `'Scheduled'`, and takes the extra nullable
`p_invoice_id uuid` predecessor FK (FR-PR-004b — captured optional, default null):

```sql
create or replace function create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
begin
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.payments (procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function create_payment(uuid, uuid, text, text, date, numeric) from public;
grant  execute on function create_payment(uuid, uuid, text, text, date, numeric) to   authenticated;
revoke execute on function create_payment(uuid, uuid, text, text, date, numeric) from anon;
```

**Verify:** `grep -c 'create or replace function create_' …0037….sql` returns `4`; `supabase db reset` exits 0.

### Task 3.5 — pgTAP: minting + permissive-capture + cross-org + role gate

**File:** `supabase/tests/0078_procurement_record_rpcs.test.sql` (NEW). House style: set the JWT claim per
actor (mirror 0014/0015/0016 procurement tests). Cover:
- **AC-PR-004** — call `create_purchase_request` (and `create_rfq`/`create_purchase_order`/`create_payment`)
  in-org as PM; each returned `*_number` matches `^PR-\d{6}\d{4}$` (resp. `RFQ-`/`PO-`/`PAY-`) via a regex
  `ok(... ~ '^RFQ-[0-9]{10}$')`; a second `create_rfq` increments the trailing seq by 1.
- **AC-PR-014** — case at `Ordered`; `create_purchase_order` succeeds AND `procurements.status` stays
  `Ordered` (capture does not force a transition — permissive, OD-PROC-7-D).
- **AC-PR-015** — org-A user calling any of the four RPCs with `p_procurement_id` = an org-B case
  `throws_ok` 42501 (parent-org guard / WITH CHECK).
- **AC-PR-016** — Admin / PM / Finance each create a PR/RFQ/PO/Payment under an in-org case → `lives_ok`
  (write-set may capture; no new role).
- **AC-PR-017** — Engineer (not the requester) calling `create_purchase_request` `throws_ok` 42501 (the RPC
  4-role gate; the own-scoped Engineer contract is preserved).

**Verify:** `supabase test db` runs `0078_…` with all tests passing; full `supabase test db` exits 0.

---

## Slice 4 — Revise `transition_procurement` (numbers → records) + backfill

**Goal:** the transition RPC writes minted PR#/PO#/PAY# onto the owning RECORD rows and upserts the canonical
PR@→Requested / PO@→Ordered / Payment@→Paid record (OQ-3/OQ-4), while KEEPING the legal-transition map + the
full SoD/role gate **byte-identical**, and (per OQ-2/[PD-2]) RETAINING the `procurements.pr_number/po_number`
column writes as a deprecated cache so every existing read (ProcurementDetails, committed spend) is untouched.
Plus the FR-PR-027 backfill of existing PR#/PO# into records, and the SoD/RLS/committed-spend re-proof.
Plus the **`procurement_status_events`** transition log ([PD-7] Director override — see below) that makes
FR-PR-025's "transition events ∪ record events" history real.
**Covers:** FR-PR-014/015/016/025(log)/027/030; OBS-PR-003; AC-PR-011/012/013/023/024/025.

**[PD-2]** The RPC's existing `update procurements set … pr_number = …, po_number = …` block STAYS (cache).
We ADD, after that update, an idempotent canonical-record upsert per phase. **[PD-3]** Idempotency: insert
only when no record of that type already carries the case's current `pr_number`/`po_number`/(for payment, no
`payments` row exists for the case yet at `→Paid`). This keeps re-entry (e.g. Rejected→Draft→Requested)
from duplicating the canonical record.

### Task 4.0 — [PD-7] `procurement_status_events` transition-log table

**File:** `supabase/migrations/0038_transition_writes_records.sql` (NEW — this table goes FIRST in the file,
before the function redefinition).

```sql
-- [PD-7] Lightweight per-transition log (ADR-0033 "transition log ∪ record events"; FR-PR-025).
create table procurement_status_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  procurement_id uuid not null references procurements(id) on delete cascade,
  from_status    procurement_status,
  to_status      procurement_status not null,
  actor_id       uuid references profiles(id),
  notes          text,
  created_at     timestamptz not null default now()
);
create index procurement_status_events_procurement_idx
  on procurement_status_events (procurement_id, created_at);
alter table procurement_status_events enable row level security;
alter table procurement_status_events force row level security;
-- read-in-org; NO direct write policy — only the security-definer RPC inserts (append-only log).
create policy procurement_status_events_read on procurement_status_events
  for select using (org_id = auth_org_id());
```
**Verify:** `supabase db reset` exits 0; `grep -c 'create table procurement_status_events' …0038….sql` = 1.

### Task 4.1 — Add the canonical-record upsert + status-event log to `transition_procurement`

**File:** `supabase/migrations/0038_transition_writes_records.sql` (append, after Task 4.0's table)
`create or replace function transition_procurement(...)` — copy the ENTIRE 0006 §A5 body verbatim (map, role
gate, SoD-a, SoD-b, the existing `update procurements set status…, pr_number…, po_number…` cache write —
NONE of this changes), then APPEND, before the final `end;`, the canonical-record upserts. The cache write
already coalesced the minted number onto the column; read it back and stamp the record:

```sql
  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(org_id_for(p_id), 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- Bind `v_from` to the RPC's EXISTING current-status local captured BEFORE the status update
  -- (the same value SoD/map validation read); `v_org` is the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
```

**[PLAN-DECISION] [PD-6]** Payment has no aggregate cache column, so the canonical Payment record mints its
own `PAY` number inline via `next_procurement_doc_number(v_org, 'PAY')` using the `v_org` already loaded at
the top of the RPC (not a helper — use the existing `v_org` local). Replace `org_id_for(p_id)` above with the
RPC's existing `v_org` local. Re-grant block is unchanged from 0006 (definer ACL identical). Add a file-top
comment: "Supersedes the 0006 transition_procurement body — copies it verbatim and appends record upserts;
map + SoD + role gate BYTE-PRESERVED; column cache writes RETAINED (OQ-2)."
**Verify:** `supabase db reset` exits 0; `grep -c 'insert into public.purchase_requests' …0038….sql` = 1.

### Task 4.2 — FR-PR-027 backfill: existing PR#/PO# → records

**File:** `supabase/migrations/0038_transition_writes_records.sql` (append)
A one-shot, idempotent backfill (runs at migration apply, after the function redefinition): for each existing
procurement with a non-null `pr_number` (resp. `po_number`) that has no matching PR (resp. PO) record, insert
one carrying that number. org_id taken from the parent (the stamp trigger also covers it, but set explicitly
for clarity and to avoid trigger dependence). Reversible (the rollback block deletes backfilled rows by a
marker is unnecessary — `supabase db reset` is the contract; note this in the comment).

```sql
insert into public.purchase_requests (org_id, procurement_id, pr_number, status, date)
select p.org_id, p.id, p.pr_number, 'Submitted', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.pr_number is not null
   and not exists (select 1 from public.purchase_requests pr
                    where pr.procurement_id = p.id and pr.pr_number = p.pr_number);

insert into public.purchase_orders (org_id, procurement_id, po_number, status, date)
select p.org_id, p.id, p.po_number, 'Issued', coalesce(p.created_at::date, current_date)
  from public.procurements p
 where p.po_number is not null
   and not exists (select 1 from public.purchase_orders po
                    where po.procurement_id = p.id and po.po_number = p.po_number);
```

**Verify:** `supabase db reset` exits 0 (seed has PR#/PO# rows → backfill rows created without error).

### Task 4.3 — pgTAP: minted-number-on-record + SoD re-proof

**File:** `supabase/tests/0079_transition_records.test.sql` (NEW). House style mirrors
`0015_procurement_sod.test.sql`. Cover:
- **AC-PR-011** — drive a case Draft→Requested→Approved→Ordered (as the right actors); after `→Requested`
  the `purchase_requests` row for the case carries the case's `pr_number` (`results_eq`); after `→Ordered`
  the `purchase_orders` row carries the `po_number`. Proves numbers land on records (FR-PR-016).
- **AC-PR-012** — requester (incl. an Admin requester) calling `transition_procurement(.., 'Approved')` on
  their own `Requested` case `throws_ok` 42501 (SoD-a, OD-PROC-8) — copied assertion from 0015.
- **AC-PR-013** — approver calling `transition_procurement(.., 'Paid')` on a `Vendor Invoiced` case they
  approved `throws_ok` 42501 (SoD-b).
- **AC-PR-033** ([PD-7]) — after driving Requested→Approved→Ordered, `procurement_status_events` has one row
  per transition (`results_eq` on `(from_status,to_status)` ordered by `created_at`); the read is in-org;
  a direct `insert into procurement_status_events …` as a non-owner role `throws_ok` (no write policy →
  append-only, RPC-only). Proves FR-PR-025's transition log is real and tamper-resistant.

**Verify:** `supabase test db` runs `0079_…` with all tests passing.

### Task 4.4 — pgTAP: backfill + existing rows intact + committed-spend unchanged

**File:** `supabase/tests/0080_transition_records_backfill.test.sql` (NEW). House style; inserts as table
owner to set up pre-migration-like fixtures (a case with `pr_number`/`po_number` set, plus existing
quotation/GR/VI rows). Because pgTAP runs post-migration, simulate the backfill's idempotent re-run: insert a
case with a `pr_number`, run the SAME backfill `insert … select … not exists` statements (copied from 4.2),
assert exactly one PR record is created. Cover:
- **AC-PR-023** — a case with `pr_number`/`po_number` yields exactly one PR / one PO record carrying that
  number; the case keeps its numbers (column unchanged).
- **AC-PR-024** — pre-existing `procurement_quotations`/`procurement_receipts`/`procurement_invoices` rows
  remain readable and unchanged; their new columns (`rfq_id`/`valid_until`/`po_id`) read null.
- **AC-PR-025** — committed spend (`select sum(total_value) from procurements where status in
  ('Ordered','Received','Vendor Invoiced','Paid')` for a project) equals its value computed the same way
  before any record insert (the record redesign does not change the case-status-driven basis, OBS-PR-003).

**Verify:** `supabase test db` runs `0080_…` with all tests passing; full `supabase test db` exits 0.

---

## Slice 5 — Repository seam + lifecycle TS + history-union model + unit tests

**Goal:** regenerate DB types (no hand-casts — MEMORY durable rule), add DAL creators for the four new record
types + their file tables, wire the repository seam (ADR-0017), and build the TS history-union model. No UI
yet. **Covers:** FR-PR-005/007/008/025; AC-PR-009/021.

### Task 5.1 — Regenerate Supabase DB types

**Command (from `pmo-portal/`):** the project's existing type-gen script (per package.json — e.g.
`npm run gen:types` against the local DB). The four new tables + four file tables + new columns + new RPCs
must appear in `src/lib/supabase/database.types.ts`. **Verify:** `grep -c "purchase_requests:" 
src/lib/supabase/database.types.ts` ≥ 1 and `grep -c "create_payment" src/lib/supabase/database.types.ts`
≥ 1; `npm run typecheck` exits 0.

### Task 5.2 — DAL creators for the four record types

**File:** `pmo-portal/src/lib/db/procurementRecords.ts` (NEW)
Mirror `procurementLifecycle.ts` thin-RPC wrappers (`createReceipt`/`createInvoice`): `createPurchaseRequest`,
`createRfq`, `createPurchaseOrder`, `createPayment` calling `supabase.rpc('create_purchase_request', {...})`
etc., org_id NEVER sent, rethrowing `ProcurementError` preserving `.code`. Export row types
`PurchaseRequestRow = Tables<'purchase_requests'>` etc. Signatures match the RPC params exactly (5 args; 6 for
payment incl. nullable `invoiceId`). Reference-number is bounded client-side at the form layer (Slice 6).
**Verify:** `npm run typecheck` exits 0; `grep -c 'export async function create' 
pmo-portal/src/lib/db/procurementRecords.ts` returns `4`.

### Task 5.3 — Extend the per-record files DAL to the four new types

**File:** `pmo-portal/src/lib/db/procurementFiles.ts` (EDIT)
Extend `ProcPhase` union from `'quotation' | 'receipt' | 'invoice'` to add `'purchase_request' | 'rfq' |
'purchase_order' | 'payment'`; extend `PARENT_COL_BY_PHASE` with `purchase_request: 'purchase_request_id'`,
`rfq: 'rfq_id'`, `purchase_order: 'purchase_order_id'`, `payment: 'payment_id'`; and add the four new
`.from('<table>')` branches to `listProcurementFiles` / `confirmUpload` / `archiveProcurementFile` (the
union-table-collapses-to-never reason the existing code branches per literal — keep that pattern).
`buildProcurementFilePath` already accepts any phase string (segment-3) — no change.
**Verify:** `npm run typecheck` exits 0; existing `ProcurementFilesSubsection.test.tsx` still passes
(`npm test -- ProcurementFilesSubsection`).

### Task 5.4 — Wire the new creators into the repository seam

**File:** `pmo-portal/src/lib/repositories/index.ts` (EDIT) + `src/lib/repositories/types.ts` (EDIT)
Add `createPurchaseRequest`/`createRfq`/`createPurchaseOrder`/`createPayment` to the `Repositories` interface
(types.ts, signatures matching the DAL) and to the assembled `repositories` object (index.ts), each a thin
`toAppError`-normalizing wrapper delegating to the Slice-5.2 DAL — the exact pattern used for `createReceipt`/
`createInvoice` already in this file. **Verify:** `npm run typecheck` exits 0; `npm test -- repositories`
passes (the existing `index.test.ts` shape check).

### Task 5.5 — TEST FIRST: history-union model unit test (AC-PR-021)

**File:** `pmo-portal/src/lib/db/procurementHistory.test.ts` (NEW — write BEFORE 5.6, must fail red)
`it('AC-PR-021 history unions transitions and record creations chronologically', …)`: given a fixture detail
bundle with N synthetic transition events (status + actor + timestamp) and M record-creation events (each
record's `created_at` + type + minted number), assert `buildProcurementHistory(detail)` returns an array of
length N+M, sorted ascending by timestamp, each item carrying `{ kind, label, actor, at }` with
`kind ∈ {'transition','record'}`. Run `npm test -- procurementHistory` → MUST FAIL (no impl yet).
**Verify:** test file exists and fails with "buildProcurementHistory is not a function" / module-not-found.

### Task 5.6 — Implement the history-union model (green)

**File:** `pmo-portal/src/lib/db/procurementHistory.ts` (NEW)
**[PD-4]** Pure function `buildProcurementHistory(detail)` over the already-loaded `ProcurementDetail` bundle
(no fetch, no N+1, NFR-PR-PERF-002). Build `record` events from `detail.quotations/receipts/invoices` + (once
the detail type is extended in Slice 6) the four new record arrays, each → `{ kind:'record', at: created_at,
label: '<Type> <minted-number>', actor: uploaded_by/created_by ?? null }`. Build `transition` events from
**`detail.statusEvents`** (the `procurement_status_events` log added in Slice 4.0, loaded by the bundle in
Slice 6.1) → `{ kind:'transition', at: created_at, label: '<from_status> → <to_status>', actor: actor_id }`
([PD-7] Director override — real persisted transitions, NOT synthesized from terminal stamps). Sort ascending
by `at` (stable). Export the `HistoryEvent` type. Run `npm test -- procurementHistory` → GREEN.
**Verify:** test passes; `npm run typecheck` exits 0.

### Task 5.7 — TEST FIRST + impl: archived-file exclusion unit (AC-PR-009)

**File:** `pmo-portal/src/lib/db/procurementFiles.test.ts` (NEW or EDIT)
`it('AC-PR-009 archived file excluded from list', …)`: mock `supabase.from(...).select().eq().is('archived_at',
null)…` for a new phase (e.g. `'purchase_order'`) and assert `listProcurementFiles('purchase_order', id)`
issues the `.is('archived_at', null)` filter and returns only the non-archived rows. This is a logic test of
the Slice-5.3 branch (the `.is('archived_at', null)` is already in the existing branches — the new branches
must carry it identically). Run red first if the branch is missing the filter, then green.
**Verify:** `npm test -- procurementFiles` passes.

### Task 5.8 — Slice verify

**Command (from `pmo-portal/`):** `npm run verify` (typecheck + lint:ci + test + build). **Verify:** exits 0.

---

## Slice 6 — Single-page UI (`/procurement/:id`): pipeline + history + inline capture/upload + dual-ID

**Goal:** the JTBD P1 page — on `/procurement/:id`: the full lifecycle stepper (already present), the
progression-history timeline, per-phase inline capture+upload for every record type (dual-ID display +
business date + amount + status + nullable predecessor FK), and the advance action — all gated via `can()` /
`<CanWrite>` on the real role (RLS authoritative). Strictly DESIGN.md tokens; no horizontal bleed; honest
doorway (every affordance works). **Covers:** FR-PR-019/020/021/022/023/024/025/026; NFR-PR-A11Y-001/002/003,
NFR-PR-RESP-001/002, NFR-PR-SEC-003; AC-PR-005/018.

**[PD-5]** Predecessor FKs (`po_id` on GR/VI, `invoice_id` on payment) are inline-OPTIONAL selects (a small
"links to PO #…" dropdown defaulting to none) — captured by the user, not auto-wired.

### Task 6.1 — Extend the detail bundle to load the four new record types

**File:** `pmo-portal/src/lib/db/procurementLifecycle.ts` (EDIT)
Extend `DETAIL_SELECT` with `'purchase_requests:purchase_requests(*)'`, `'rfqs:rfqs(*)'`,
`'purchase_orders:purchase_orders(*)'`, `'payments:payments(*)'`, **`'statusEvents:procurement_status_events(*)'`**
([PD-7] — feeds the history timeline, Slice 5.6), and extend the `ProcurementDetail` type with
`purchase_requests`, `rfqs`, `purchase_orders`, `payments`, **`statusEvents`** arrays (typed `Tables<'…'>[]`). This is the bounded
single-query load (NFR-PR-PERF-002 — one PostgREST embed, no N+1). **Verify:** `npm run typecheck` exits 0;
`npm test -- procurementLifecycle` passes (or add a select-shape assertion).

### Task 6.2 — Reusable `RecordCard` with dual-ID display (TEST FIRST, AC-PR-005)

**File:** `pmo-portal/pages/procurement/RecordCard.test.tsx` (NEW — red first), then `RecordCard.tsx` (NEW)
Test `it('AC-PR-005 external reference round-trips: both system number and external ref render', …)`: render
`<RecordCard systemNumber="PO-2606190001" referenceNumber="ACME-PO-77" date="2026-06-10" amount={1500}
status="Issued" />` and assert BOTH `PO-2606190001` AND `ACME-PO-77` appear as TEXT, the system number
labelled "System #" and the external labelled "Ref #" (NFR-PR-A11Y-003 not-color-only), the business date and
formatted amount render. `referenceNumber` is rendered as text (React escaping, no `dangerouslySetInnerHTML`,
NFR-PR-SEC-003). Implement to pass. Token-pure (DESIGN.md). **Verify:** `npm test -- RecordCard` passes.

### Task 6.3 — Inline capture form `RecordCaptureForm` (per-phase)

**File:** `pmo-portal/pages/procurement/RecordCaptureForm.tsx` (NEW)
A compact inline form built on the shared primitives (`TextField` for reference number — bounded `maxLength`
e.g. 64 (NFR-PR-SEC-003), `SelectField` for status, a date input for the business `date`, `TextField` numeric
for amount; for payment/GR/VI an optional `SelectField` predecessor-FK). Calls the Slice-5.2 creator via a
mutation hook (Task 6.4). Keyboard-operable, programmatic labels on every field, file input announces filename
(NFR-PR-A11Y-001), touch targets ≥44px (NFR-PR-RESP-002). Reuse `classifyMutationError` for toasts.
**Verify:** `npm run typecheck` exits 0 (component test folded into 6.6 journey + 6.2 card test).

### Task 6.4 — Mutation hook for the four new creators + their files

**File:** `pmo-portal/src/hooks/useProcurementRecords.ts` (NEW)
`useProcurementRecordMutations(procurementId)` exposing `createPurchaseRequest`/`createRfq`/
`createPurchaseOrder`/`createPayment` (react-query mutations over `repositories.*`, invalidating the detail
query key) — mirror `useProcurementCrud.ts` shape. Reuse `useProcurementFiles` (already generalized in Slice
5.3) for per-record uploads by passing the new `ProcPhase`. **Verify:** `npm run typecheck` exits 0;
`npm test -- useProcurementRecords` (a thin smoke test that the hook returns the expected mutation keys).

### Task 6.5 — Progression-history timeline component

**File:** `pmo-portal/pages/procurement/ProcurementHistoryTimeline.tsx` (NEW)
Render `buildProcurementHistory(detail)` (Slice 5.6) as a semantic `<ol>` with an accessible name
(`aria-label="Progression history"`, NFR-PR-A11Y-002); each `<li>` shows kind + label + actor + timestamp in
TEXT (not color-only). Token-pure; reflows with no horizontal bleed at 360/390 (NFR-PR-RESP-001 — use the
established wrapping/`overflow-x` pattern). **Verify:** `npm run typecheck` exits 0;
`npm test -- ProcurementHistoryTimeline` (renders N+M items in order from a fixture).

### Task 6.6 — Compose into ProcurementDetails + `can()` gating (TEST FIRST, AC-PR-018)

**File:** `pmo-portal/pages/procurement/ProcurementRecordsSection.test.tsx` (NEW — red first), then
`ProcurementRecordsSection.tsx` (NEW) wired into `pages/ProcurementDetails.tsx` (EDIT)
Test `it('AC-PR-018 can() gates capture/upload/advance on the real JWT role', …)`: render the records section
as (a) an impersonating user and (b) an Engineer non-requester → the capture/upload affordances are HIDDEN
(`can('create','procurement'/'quotation', { realRole })` false), and as a PM → SHOWN. Implement: each phase
column shows its `RecordCard`s (dual-ID), a `RecordCaptureForm` wrapped in `<CanWrite>`/`usePermission` on the
real role, and `ProcurementFilesSubsection` per record. The advance action stays the existing
`RecordActionZone` (single-click + toast for routine, `ConfirmDialog` for Approve/Reject/Cancel/Pay —
unchanged OD-UX-1). Mount the `ProcurementHistoryTimeline` on the page. NO dead controls (honest doorway,
FR-PR-026). **Verify:** `npm test -- ProcurementRecordsSection` passes; `npm run verify` exits 0.

### Task 6.7 — Render the page (visual gate before any promote)

**Command (from `pmo-portal/`):** `npm run dev`, open `/procurement/:id` on a rich-seed case at desktop +
390px + 360px. Confirm: full pipeline, history timeline, dual-ID per record, inline capture+upload adjacent to
each phase, advance action present and working, no horizontal bleed, no oversized icons. **Verify:** manual
render is clean (MEMORY durable rule: verify-green ≠ visually-correct — render before promote).

---

## Slice 7 — E2E + axe + mobile-overflow

**Goal:** the curated Playwright journeys proving the JTBD P1 single-page experience end-to-end, plus the axe
and mobile-overflow gates. **Covers:** FR-PR-022/023/024/025/026; NFR-PR-A11Y-003, NFR-PR-RESP-001;
AC-PR-019/020/022/026/027.

**[NOTE]** Run Playwright from `pmo-portal/` (MEMORY gotcha). Tests are full-serial with dedicated fixtures
(MEMORY durable rule). AC-id = leading token of the `test(...)` title; file `e2e/AC-PR-0NN-<slug>.spec.ts`.

### Task 7.1 — E2E: one page shows pipeline + history + both IDs + inline capture (AC-PR-019)

**File:** `pmo-portal/e2e/AC-PR-019-single-page.spec.ts` (NEW)
`test('AC-PR-019 one page shows pipeline, history, both IDs, and inline capture without navigating', …)`:
log in as a procurement admin, open a rich-seed `/procurement/:id`; assert (on ONE page, no navigation) the
lifecycle stepper with current status, the progression-history list (accessible name "Progression history"),
at least one record showing BOTH a system number (`/PO-\d{10}/` etc.) and its external reference, and an
inline capture+upload affordance adjacent to a phase. **Verify:** `npx playwright test AC-PR-019` passes.

### Task 7.2 — E2E: capture a record + upload + advance, all on one page (AC-PR-020 + AC-PR-022)

**File:** `pmo-portal/e2e/AC-PR-020-capture-advance.spec.ts` (NEW)
`test('AC-PR-020 capture a record with external ref, date, amount, upload a file, then advance — on one
page', …)`: on the case page, fill the inline capture form (external ref + business date + amount), submit →
the new record appears under its phase with both IDs; upload a file → it appears under the record; click the
advance action → the case status updates and the history timeline gains the capture + transition events in
order — all without leaving the page. The journey asserts the GOAL (record+file present, status advanced,
history grew) per the BDD authoring rule. **AC-PR-022 (no dead affordances)** is folded in: every affordance
exercised here performs its action (none is a no-op). **Verify:** `npx playwright test AC-PR-020` passes.

### Task 7.3 — E2E: axe-core clean on the page (AC-PR-026)

**File:** `pmo-portal/e2e/AC-PR-026-axe.spec.ts` (NEW — or extend the existing axe sweep if one owns
procurement). `test('AC-PR-026 /procurement/:id with records and history passes axe-core (WCAG-AA)', …)`:
render the case page with records + history, run `@axe-core/playwright`, assert zero violations.
**Verify:** `npx playwright test AC-PR-026` passes.

### Task 7.4 — Mobile-overflow gate covers the page (AC-PR-027)

**File:** `pmo-portal/e2e/AC-MOBILE-OVERFLOW-001.spec.ts` (EDIT — confirm `/procurement/:id` is in the route
sweep). The existing measuring gate sweeps every route × {390,360} asserting no element right-edge > viewport.
Add a rich-seed `/procurement/:id` to its route list if not already covered (so the records/timeline/inline
forms are measured). **Verify:** `npx playwright test AC-MOBILE-OVERFLOW-001` passes at 390 and 360.

### Task 7.5 — Final full verify + integration + render

**Command:** from `pmo-portal/` `npm run verify` (whole suite) + `supabase test db` (whole pgTAP) +
`npx playwright test` (the curated journeys) + render `/procurement/:id` once more before any promote.
**Verify:** all green; page renders clean at desktop + 390 + 360.

---

## Risks & notes for the Director

- **R1 — `transition_procurement` is the riskiest change** (Slice 4): the body must be copied verbatim with
  the map/SoD/role gate byte-preserved. Mitigation: AC-PR-012/013 re-prove SoD-a/b; the security-auditor
  should diff 0038's function body against 0006's and confirm only additive upserts. Full-depth security pass
  warranted (spec §Depth note).
- **R2 — Type regen (Slice 5.1) must precede all FE tasks** — hand-casting new tables is forbidden (MEMORY
  durable rule). If the project's gen script targets the local DB, `supabase db reset` (Slices 1–4) must be
  applied first.
- **R3 — History model [PD-7]** derives transitions from stamped case fields (no transition-log table exists;
  ADR-0033 "no separate audit engine"). If the Director wants a richer transition log, that is a scope add —
  flag for owner. As planned, AC-PR-021/025 hold with the lightweight model.
- **R4 — Committed spend (AC-PR-025)** is unchanged ONLY because OQ-2 retains the column cache + status-driven
  basis. If a later issue drops `pr_number`/`po_number` or moves committed spend onto PO records, that needs an
  owner decision (spec conflict-flag #4) — out of scope here.
- **R5 — Storage policy reuse (Slice 2)**: the 0028 write policy gates on segment-2 (in-org proc), not the
  phase segment, so the new record types ride the existing policy unchanged — AC-PR-010 proves it. If the
  auditor prefers an explicit phase-segment allowlist, that is a tightening, not a blocker.

## Open questions for the Director

- **OQ-A (no new spec ambiguity blocks the plan).** All four spec Open Questions were pre-resolved; the five
  [PD-#] decisions above are within-scope engineering calls. The only items needing a Director nod (not a
  blocker) are **[PD-1]** (text+CHECK status vs enums) and **[PD-7]** (lightweight derived history vs a real
  transition-log table). Both are defensible as-is; flagging for visibility.
