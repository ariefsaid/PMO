# Plan: monthly management pack (issue #765)

> **Spec:** [`docs/specs/monthly-management-pack.spec.md`](../specs/monthly-management-pack.spec.md) (AC-MMP-001..017,
> DD-MMP-1..6 proposals). **ADR:** [ADR-0076](../adr/0076-management-pack-recognition-is-an-estimate.md).
> **Executor:** bounded code + FE slice → SSSF ADW (`--builder fe_builder --reviewer fe_reviewer`). Not money-path:
> no money moves, no outbox command, no SoD gate. Security-auditor still reviews the new table + RPCs.
> **Migration number:** `0243` (Director-assigned; `0232`–`0242` are taken). If it is taken by the time you start,
> run `scripts/renumber-migration.sh 0243 <next>` after Task 2 — never hand-rename.

## 1. Design

### Architecture (3 layers, ADR-0017)

```
pages/ManagementPack.tsx ── useManagementPack(range) ── repositories.reports.managementPack(range)
        │                      select: buildManagementPack            └─ db/managementPack.getManagementPackFacts
        │                                                                 └─ rpc get_management_pack(p_from, p_to)  [SECURITY INVOKER]
        ├─ RecordProgressModal ── useRecordProjectProgress ── repositories.reports.recordProgress
        │                                                        └─ rpc record_project_progress(...)            [SECURITY INVOKER]
        └─ useExport().exportTable(buildManagementPackExport(pack), stem, 'csv'|'xlsx')  ── toCsv / toWorkbookBuffer
```

- **SQL returns facts, TypeScript derives the series.** `get_management_pack` does the parts that must have one
  owner: RLS scoping, the invoice status allow-list (`Submitted`/`Unpaid`/`Paid`, same as
  `REVENUE_STATUSES` in `src/lib/db/revenue.ts`), net-of-tax normalisation (0197's CASE, byte-identical),
  month bucketing by `invoice_date`, project inclusion, the org-timezone default month. It returns a sparse
  jsonb document (projects, invoiced per project×currency×month, invoiced before the window, progress entries
  in the window plus the latest one before it). One scalar response → no PostgREST `max_rows` truncation.
- `buildManagementPack(facts)` (pure, integer cents, BigInt proportional splits) computes planned, recognised,
  invoiced, to-date figures, unbilled, backlog, basis, per-currency totals. Layer-1 gate-tests own it.
- **New table `project_progress_entries`** (one row per project per month; `pct_complete numeric(5,2)` 0–100;
  `entered_by`/`entered_at` trigger-stamped). Written only through `record_project_progress` (atomic upsert,
  SECURITY INVOKER so RLS + column grants still apply — OD-ARCH-1 "atomic" case).
- **Who:** read = `policy.ts` `managementPack.view` = Admin·Exec·PM·Finance (mirrors `salesInvoice.view`); RLS
  on the new table = any active org member (mirrors `sales_invoices_select`). Write = `may_record_project_progress`:
  rank ≥ Finance (`holds_won_value_authority`) or rank ≥ PM *and* the project's `project_manager_id` (ADR-0070
  rank, not a role list).
- **Entry points:** `/reports` (was a placeholder) behind `FeatureRoute feature="revenue"`; a Finance-group rail
  item "Management pack"; the dashboard "Board pack" button opens `/reports` when available (new
  `BoardPackAction` component; the legacy disabled affordance moves into it unchanged for the unavailable case).

### Data flow per month *m* (DD-MMP-1..3), all in contract currency, net of tax

| Figure | Rule |
|---|---|
| invoiced(m) | Σ net of counted invoices with `invoice_date` in m |
| invoicedToDate(m) | invoiced before window + Σ invoiced(≤ m) |
| recognisedToDate(m) | latest progress entry ≤ m → `pct × contractNet`; none → invoicedToDate(m) |
| recognised(m) | recognisedToDate(m) − recognisedToDate(m−1) (may be negative) |
| unbilled(m) | recognisedToDate(m) − invoicedToDate(m) (negative = billed ahead) |
| backlog(m) | contractNet − recognisedToDate(m) (not clamped) |
| planned(m) | straight-line by day over start..end; cumulative-rounded so months sum to contractNet |

Invoices in a currency other than the contract's → an `otherCurrency` row (billing basis, no plan/backlog).
`project_id IS NULL` → an `unassigned` row per currency. Totals per currency only (DD-CUR-6).

### Error handling

- RPC: not an active member → `42501 not authorized`; bad window → `22023` with the window message; the page
  shows `managementPack.invalidRange` for `22023`, the generic error otherwise, never a 0 KPI.
- Progress writer: role/ownership → `42501` "who may" message; range → `23514`; RLS is the second layer.
- DAL: malformed jsonb → `AppError('…malformed', 'pack-malformed')`, never an empty pack.
- Export: failures toast "Export failed" via the existing `useExport` path.

### Scaling notes

- One round trip; response size O(projects + invoice-months + entries). New index
  `sales_invoices (org_id, invoice_date)`; table index `(org_id, project_id, month)`; FK index on `entered_by`.
- Window capped at 24 months server-side.
- Duplicate logic surfaced, not fixed here: the net-of-tax CASE now lives in 4 SQL bodies (ADR-0076 follow-up);
  the on-hand status list is duplicated between SQL and `ON_HAND_STATUSES` (comment cross-references both);
  `getRevenueByProject` sums gross and across currencies (OBS-MMP-002 — separate ticket).

### Files

| Path | Change |
|---|---|
| `supabase/tests/0243_management_pack.test.sql` | new pgTAP (AC-MMP-001..005) |
| `supabase/migrations/0243_management_pack.sql` | new: table, triggers, RLS, grants, 5 functions, index |
| `supabase/migrations/rollback/0243_management_pack_down.sql` | new: reverse |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated |
| `pmo-portal/src/lib/db/managementPack.ts` (+ `.test.ts`) | new DAL |
| `pmo-portal/src/lib/reports/months.ts` (+ `.test.ts`) | new month arithmetic |
| `pmo-portal/src/lib/reports/managementPack.ts` (+ `.test.ts`) | new pure builder |
| `pmo-portal/src/lib/export/toCsv.ts` (+ `__tests__/toCsv.test.ts`), `exportFilename.ts`, `index.ts` | CSV + ext |
| `pmo-portal/src/lib/reports/managementPackExport.ts` (+ `.test.ts`) | new export table |
| `pmo-portal/src/components/export/useExport.ts` (+ `__tests__/useExport.table.test.tsx`) | `exportTable` |
| `pmo-portal/src/lib/repositories/types.ts`, `index.ts`, `index.test.ts` | `reports` repository |
| `pmo-portal/src/hooks/useManagementPack.ts` (+ `.test.tsx`) | new hooks |
| `pmo-portal/src/auth/policy.ts` (+ `policy.managementPack.test.ts`) | 2 entities |
| `pmo-portal/src/components/reports/RecordProgressModal.tsx` (+ `.test.tsx`) | new |
| `pmo-portal/pages/ManagementPack.tsx` (+ `pages/__tests__/ManagementPack.test.tsx`) | new page |
| `pmo-portal/App.tsx`, `App.routes.test.tsx` | `/reports` route |
| `pmo-portal/src/components/shell/Rail.tsx` (+ `__tests__/Rail.managementPack.test.tsx`) | nav item |
| `pmo-portal/src/components/reports/BoardPackAction.tsx` (+ `.test.tsx`), `pages/ExecutiveDashboard.tsx`, `pages/ExecutiveDashboard.test.tsx` | dashboard entry |
| `pmo-portal/public/locales/{en,id}/common.json`, `src/lib/i18n/launch-scope-routes.txt`, `src/lib/reports/managementPack.i18n.test.ts` | i18n |
| `pmo-portal/e2e/AC-MMP-016-management-pack.spec.ts` | e2e journey |

### Traceability (one owning test per AC, ADR-0010)

| AC | Owning layer | Canonical proof |
|---|---|---|
| AC-MMP-001 | pgTAP | `supabase/tests/0243_management_pack.test.sql` |
| AC-MMP-002 | pgTAP | same |
| AC-MMP-003 | pgTAP | same |
| AC-MMP-004 | pgTAP | same |
| AC-MMP-005 | pgTAP | same |
| AC-MMP-006 | Vitest | `src/lib/reports/managementPack.test.ts` |
| AC-MMP-007 | Vitest | same |
| AC-MMP-008 | Vitest | same |
| AC-MMP-009 | Vitest | same |
| AC-MMP-010 | Vitest | same |
| AC-MMP-011 | Vitest | `src/lib/reports/managementPackExport.test.ts` (+ `src/lib/export/__tests__/toCsv.test.ts`) |
| AC-MMP-012 | Vitest/RTL | `pages/__tests__/ManagementPack.test.tsx` (+ `src/auth/policy.managementPack.test.ts`) |
| AC-MMP-013 | Vitest/RTL | `pages/__tests__/ManagementPack.test.tsx` |
| AC-MMP-014 | Vitest/RTL | `src/components/reports/RecordProgressModal.test.tsx` |
| AC-MMP-015 | Vitest | `src/components/reports/BoardPackAction.test.tsx`, `src/components/shell/__tests__/Rail.managementPack.test.tsx`, `App.routes.test.tsx` |
| AC-MMP-016 | Playwright | `e2e/AC-MMP-016-management-pack.spec.ts` |
| AC-MMP-017 | Vitest | `src/lib/reports/managementPack.i18n.test.ts` |

## 2. Tasks

All commands run from the repo root `/Users/ariefsaid/Coding/PMO` unless they `cd pmo-portal`. The CSV byte-order
mark is always written as `String.fromCharCode(0xfeff)` (never a pasted invisible character).

### Task 1 — pgTAP contract first (RED) · AC-MMP-001..005

Create `supabase/tests/0243_management_pack.test.sql`:

```sql
-- 0243_management_pack.test.sql — #765. Migration under test: 0243_management_pack.sql.
-- Every denial asserts errcode AND message (0193's oracle discipline). No assertion reads function source.
-- Cast: FIN a1 Finance · PM a2 (P1's PM) · PM2 a3 · ENG a4 · OFF a5 Finance, disabled · XORG b1 Admin, org B.
begin;
create extension if not exists pgtap;
select plan(40);

insert into organizations (id, name, default_currency, default_timezone) values
  ('07650000-0000-0000-0000-000000000001', 'Pack Org', 'IDR', 'Asia/Jakarta'),
  ('07650000-0000-0000-0000-000000000002', 'Pack Other Org', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('07650000-0000-0000-0000-0000000000a1', 'pack-fin@example.com'),
  ('07650000-0000-0000-0000-0000000000a2', 'pack-pm@example.com'),
  ('07650000-0000-0000-0000-0000000000a3', 'pack-pm2@example.com'),
  ('07650000-0000-0000-0000-0000000000a4', 'pack-eng@example.com'),
  ('07650000-0000-0000-0000-0000000000a5', 'pack-off@example.com'),
  ('07650000-0000-0000-0000-0000000000b1', 'pack-xorg@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('07650000-0000-0000-0000-0000000000a1', '07650000-0000-0000-0000-000000000001', 'Pack Fin',  'pack-fin@example.com',  'Finance',         'active'),
  ('07650000-0000-0000-0000-0000000000a2', '07650000-0000-0000-0000-000000000001', 'Pack PM',   'pack-pm@example.com',   'Project Manager', 'active'),
  ('07650000-0000-0000-0000-0000000000a3', '07650000-0000-0000-0000-000000000001', 'Pack PM2',  'pack-pm2@example.com',  'Project Manager', 'active'),
  ('07650000-0000-0000-0000-0000000000a4', '07650000-0000-0000-0000-000000000001', 'Pack Eng',  'pack-eng@example.com',  'Engineer',        'active'),
  ('07650000-0000-0000-0000-0000000000a5', '07650000-0000-0000-0000-000000000001', 'Pack Off',  'pack-off@example.com',  'Finance',         'disabled'),
  ('07650000-0000-0000-0000-0000000000b1', '07650000-0000-0000-0000-000000000002', 'Pack XOrg', 'pack-xorg@example.com', 'Admin',           'active');

-- P1 on hand, inclusive contract (net 1,000,000). P2 a Lead. P3 archived Close Out WITH an in-window invoice.
-- P4 archived Ongoing with none. P9 another org.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency,
                      project_manager_id, start_date, end_date, archived_at) values
  ('07650000-0000-0000-0000-0000000000c1', '07650000-0000-0000-0000-000000000001', 'Pack P1', 'Ongoing Project', 1110000, 'inclusive', 110000, 'IDR',
   '07650000-0000-0000-0000-0000000000a2', '2026-01-01', '2026-12-31', null),
  ('07650000-0000-0000-0000-0000000000c2', '07650000-0000-0000-0000-000000000001', 'Pack P2', 'Leads',           0, null, null, 'IDR', null, null, null, null),
  ('07650000-0000-0000-0000-0000000000c3', '07650000-0000-0000-0000-000000000001', 'Pack P3', 'Close Out',       0, null, null, 'IDR', null, null, null, now()),
  ('07650000-0000-0000-0000-0000000000c4', '07650000-0000-0000-0000-000000000001', 'Pack P4', 'Ongoing Project', 0, null, null, 'IDR', null, null, null, now()),
  ('07650000-0000-0000-0000-0000000000c9', '07650000-0000-0000-0000-000000000002', 'Pack P9', 'Ongoing Project', 0, null, null, 'IDR', null, null, null, null);

insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('07650000-0000-0000-0000-0000000000e1', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-03-15', 555000, 'inclusive', 55000, 'IDR', 'Unpaid'),
  ('07650000-0000-0000-0000-0000000000e2', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-03-31', 100000, 'exclusive', 11000, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e3', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-04-01',  50000, 'exclusive', 0, 'IDR', 'Draft'),
  ('07650000-0000-0000-0000-0000000000e4', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-04-02',  70000, 'exclusive', 0, 'IDR', 'Cancelled'),
  ('07650000-0000-0000-0000-0000000000e5', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-12-20', 200000, 'exclusive', 0, 'IDR', 'Submitted'),
  ('07650000-0000-0000-0000-0000000000e6', '07650000-0000-0000-0000-000000000001', null,                                   '2026-02-10',  30000, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('07650000-0000-0000-0000-0000000000e7', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c3', '2026-05-05',  40000, 'exclusive', 0, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e8', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2026-06-01',  10000, 'exclusive', 0, 'USD', 'Paid'),
  ('07650000-0000-0000-0000-0000000000ea', '07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', null,           9999, 'exclusive', 0, 'IDR', 'Paid'),
  ('07650000-0000-0000-0000-0000000000e9', '07650000-0000-0000-0000-000000000002', '07650000-0000-0000-0000-0000000000c9', '2026-03-01',  77000, 'exclusive', 0, 'IDR', 'Paid');

-- Entries before the window: only the LATEST (2025-11) may be carried in.
insert into project_progress_entries (org_id, project_id, month, pct_complete) values
  ('07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-10-01', 10),
  ('07650000-0000-0000-0000-000000000001', '07650000-0000-0000-0000-0000000000c1', '2025-11-01', 20);

-- ═══ AC-MMP-003 (pure helper, no role needed) ═══
select is(public.org_current_month('Asia/Jakarta', '2026-09-30 17:30:00+00'), '2026-10-01'::date,
  'AC-MMP-003 17:30 UTC on 30 Sep is already October in Jakarta');                                     -- 1
select is(public.org_current_month('UTC', '2026-09-30 17:30:00+00'), '2026-09-01'::date,
  'AC-MMP-003 the same instant is still September in UTC');                                             -- 2

-- ═══ Finance reads the pack ═══
set local role authenticated;
set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin perform set_config('pack.j', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;

-- AC-MMP-001
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'IDR' and x->>'month' = '2026-03-01'),
  600000::numeric, 'AC-MMP-001 inclusive counts net of tax, exclusive at amount, in the invoice-date month');  -- 3
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' = '2026-04-01'),
  0, 'AC-MMP-001 Draft and Cancelled invoices are not counted');                                         -- 4
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced_before') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'IDR'),
  200000::numeric, 'AC-MMP-001 invoices before the window arrive as one before-window total');           -- 5
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->'project_id' = 'null'::jsonb and x->>'month' = '2026-02-01'),
  30000::numeric, 'AC-MMP-001 an invoice with no project is reported as unassigned');                    -- 6
select is((select sum((x->>'net')::numeric) from jsonb_array_elements(current_setting('pack.j')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'currency' = 'USD' and x->>'month' = '2026-06-01'),
  10000::numeric, 'AC-MMP-001 an invoice in another currency keeps its own currency key');               -- 7
select is((current_setting('pack.j')::jsonb->>'undated_invoice_count')::int, 1,
  'AC-MMP-001 a counted invoice with no date is reported, not counted');                                 -- 8

-- AC-MMP-002
select is((select (x->>'contract_net')::numeric from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c1'),
  1000000::numeric, 'AC-MMP-002 an inclusive contract value is reported net of its tax');                 -- 9
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c2'),
  0, 'AC-MMP-002 a pipeline (Leads) project is not in the pack');                                        -- 10
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c3'),
  1, 'AC-MMP-002 an archived project invoiced in the window is in the pack');                            -- 11
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.j')::jsonb->'projects') x
            where x->>'id' = '07650000-0000-0000-0000-0000000000c4'),
  0, 'AC-MMP-002 an archived project with nothing in the window is not');                               -- 12

-- AC-MMP-003 (defaults + window rules)
do $$ begin perform set_config('pack.d', public.get_management_pack()::text, true); end $$;
select is(current_setting('pack.d')::jsonb->>'timezone', 'Asia/Jakarta',
  'AC-MMP-003 the default month is computed in the organisation timezone');                              -- 13
select is((current_setting('pack.d')::jsonb->>'to')::date, public.org_current_month('Asia/Jakarta', now()),
  'AC-MMP-003 the default as-at month is the org''s current month');                                     -- 14
select is((current_setting('pack.d')::jsonb->>'from')::date,
          date_trunc('year', public.org_current_month('Asia/Jakarta', now()))::date,
  'AC-MMP-003 the default window starts in January of the as-at year');                                  -- 15
select throws_ok($$select public.get_management_pack('2026-05-01', '2026-04-01')$$, '22023',
  'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it',
  'AC-MMP-003 a start after the as-at month is refused');                                                 -- 16
select throws_ok($$select public.get_management_pack('2024-03-01', '2026-03-01')$$, '22023',
  'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it',
  'AC-MMP-003 a 25-month window is refused');                                                             -- 17
select lives_ok($$select public.get_management_pack('2024-04-01', '2026-03-01')$$,
  'AC-MMP-003 a 24-month window is served');                                                              -- 18

-- ═══ AC-MMP-005 progress writes ═══
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-03-17', 40)$$,
  'AC-MMP-005 Finance records progress on any project');                                                  -- 19
select is((select month::text || ':' || pct_complete::text from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month >= '2026-01-01'),
  '2026-03-01:40.00', 'AC-MMP-005 the month is stored as its first day');                                 -- 20
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-03-01', 45, 'site visit')$$,
  'AC-MMP-005 re-recording the same month is accepted');                                                  -- 21
select is((select count(*)::text || ':' || max(pct_complete)::text from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month = '2026-03-01'),
  '1:45.00', 'AC-MMP-005 re-recording replaces the month, it never adds a second row');                   -- 22
select is((select entered_by from public.project_progress_entries
            where project_id = '07650000-0000-0000-0000-0000000000c1' and month = '2026-03-01'),
  '07650000-0000-0000-0000-0000000000a1'::uuid, 'AC-MMP-005 the recorder is stamped server-side');       -- 23
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-05-01', 100.01)$$,
  '23514', 'percent complete must be between 0 and 100', 'AC-MMP-005 more than 100% is refused');        -- 24
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'entered_by', 'INSERT'),
  'AC-MMP-005 clients cannot supply the recorder on insert');                                             -- 25
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'entered_by', 'UPDATE'),
  'AC-MMP-005 clients cannot rewrite the recorder');                                                      -- 26
select ok(not has_column_privilege('authenticated', 'public.project_progress_entries', 'project_id', 'UPDATE'),
  'AC-MMP-005 an entry cannot be moved to another project');                                              -- 27

do $$ begin perform set_config('pack.j', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;
select is((select (x->>'pct_complete')::numeric || ':' || (x->>'entered_by_name')
             from jsonb_array_elements(current_setting('pack.j')::jsonb->'progress') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' = '2026-03-01'),
  '45.00:Pack Fin', 'AC-MMP-005 the pack returns the entry with its recorder');                           -- 28
select is((select string_agg(x->>'month', ',' order by x->>'month')
             from jsonb_array_elements(current_setting('pack.j')::jsonb->'progress') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' and x->>'month' < '2026-01-01'),
  '2025-11-01', 'AC-MMP-005 only the latest entry before the window is carried in');                      -- 29

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 50)$$,
  'AC-MMP-005 a PM records progress on a project they manage');                                           -- 30

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 a PM may not record progress on another PM''s project');                                   -- 31
select throws_ok($$insert into public.project_progress_entries (project_id, month, pct_complete)
                   values ('07650000-0000-0000-0000-0000000000c1', '2026-07-01', 10)$$,
  '42501', 'new row violates row-level security policy for table "project_progress_entries"',
  'AC-MMP-005 RLS refuses the same write made directly against the table');                               -- 32

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 an Engineer may not record progress');                                                       -- 33

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 a disabled Finance user may not record progress');                                          -- 34

-- ═══ AC-MMP-004 tenancy + membership ═══
select throws_ok($$select public.get_management_pack('2026-01-01', '2026-12-01')$$, '42501', 'not authorized',
  'AC-MMP-004 a disabled member cannot read the pack');                                                    -- 35

set local request.jwt.claims = '{"sub":"07650000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.record_project_progress('07650000-0000-0000-0000-0000000000c1', '2026-04-01', 60)$$,
  '42501', 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin',
  'AC-MMP-005 another organisation''s Admin may not record progress here');                               -- 36
do $$ begin perform set_config('pack.x', public.get_management_pack('2026-01-01', '2026-12-01')::text, true); end $$;
select is((select count(*)::int from jsonb_array_elements(current_setting('pack.x')::jsonb->'projects') x
            where x->>'id' like '07650000-0000-0000-0000-0000000000c%' and x->>'id' <> '07650000-0000-0000-0000-0000000000c9'),
  0, 'AC-MMP-004 another organisation sees none of this organisation''s projects');                      -- 37
select is((select coalesce(sum((x->>'net')::numeric), 0) from jsonb_array_elements(current_setting('pack.x')::jsonb->'invoiced') x
            where x->>'project_id' = '07650000-0000-0000-0000-0000000000c1' or x->'project_id' = 'null'::jsonb),
  0::numeric, 'AC-MMP-004 another organisation sees none of this organisation''s invoices');             -- 38

reset role;
select ok(not has_function_privilege('anon', 'public.get_management_pack(date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_project_progress(uuid, date, numeric, text)', 'EXECUTE'),
  'AC-MMP-004 anon can execute neither RPC');                                                              -- 39
select ok(not (select prosecdef from pg_proc where oid = 'public.get_management_pack(date, date)'::regprocedure)
          and not (select prosecdef from pg_proc where oid = 'public.record_project_progress(uuid, date, numeric, text)'::regprocedure),
  'AC-MMP-004 both RPCs run as the caller (SECURITY INVOKER), so RLS stays the boundary');                -- 40

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0243_management_pack.test.sql'`
Expect: failure at the `project_progress_entries` insert (relation does not exist).

### Task 2 — migration + rollback (GREEN) · AC-MMP-001..005

Create `supabase/migrations/0243_management_pack.sql`:

```sql
-- 0243_management_pack.sql — #765 monthly management pack (ADR-0076, DD-MMP-1..6).
-- Adds: project_progress_entries (a project's month-end percent complete, a management ESTIMATE — never pushed
-- to any external system), its writer record_project_progress, the reader get_management_pack, the helpers
-- org_current_month / may_record_project_progress / stamp_project_progress_entry, and an (org_id, invoice_date)
-- index on sales_invoices. No SECURITY DEFINER anywhere: both RPCs run as the caller so RLS remains the
-- tenancy boundary. Reversible via supabase/migrations/rollback/0243_management_pack_down.sql.

-- §1 the table ─────────────────────────────────────────────────────────────────────────────────────
create table public.project_progress_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  project_id   uuid not null references public.projects(id),
  month        date not null,
  -- `<= 100` is what rejects NaN: Postgres orders NaN above every number (0169/0188 lesson).
  pct_complete numeric(5,2) not null,
  note         text,
  -- WITNESS, never an input: stamped by project_progress_entries_stamp_entered, withheld from every grant.
  entered_by   uuid references public.profiles(id),
  entered_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint project_progress_entries_month_first check (month = date_trunc('month', month)::date),
  constraint project_progress_entries_pct_range check (pct_complete >= 0 and pct_complete <= 100),
  constraint project_progress_entries_note_len check (note is null or char_length(note) <= 500),
  constraint project_progress_entries_project_month_key unique (project_id, month)
);
create index project_progress_entries_org_project_month_idx
  on public.project_progress_entries (org_id, project_id, month);
create index project_progress_entries_entered_by_idx on public.project_progress_entries (entered_by);

comment on table public.project_progress_entries is
  '#765 / ADR-0076: a project''s cumulative percent complete at a month end. A management estimate that '
  'switches the project to progress-basis recognition in the management pack from that month. Never a ledger '
  'entry; never pushed to an external system.';

-- §2 stamps. 0074's org stamp (attached BY NAME, as every new table must) + the recorder witness.
create trigger project_progress_entries_stamp_org_id
  before insert on public.project_progress_entries
  for each row execute function public.stamp_org_id();

create or replace function public.stamp_project_progress_entry() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.entered_by := auth.uid();
  new.entered_at := now();
  return new;
end; $$;
revoke all on function public.stamp_project_progress_entry() from public, anon, authenticated;

create trigger project_progress_entries_stamp_entered
  before insert or update on public.project_progress_entries
  for each row execute function public.stamp_project_progress_entry();

-- §3 who may record (DD-MMP-4) — rank, not a role list (ADR-0070). INVOKER: the projects read is the
-- caller's own RLS, so a project in another org is simply not found.
create or replace function public.may_record_project_progress(p_project_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and (   public.holds_won_value_authority(public.auth_role())
            or (public.holds_pipeline_value_authority(public.auth_role())
                and p.project_manager_id = auth.uid())))
$$;
revoke all     on function public.may_record_project_progress(uuid) from public, anon;
grant  execute on function public.may_record_project_progress(uuid) to authenticated;

-- §4 RLS (FORCE per AC-LOW-1; is_active_member() conjoined explicitly — 0063's pass is not standing).
alter table public.project_progress_entries enable row level security;
alter table public.project_progress_entries force row level security;

create policy project_progress_entries_select on public.project_progress_entries for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy project_progress_entries_insert on public.project_progress_entries for insert
  with check (org_id = public.auth_org_id() and public.may_record_project_progress(project_id));
create policy project_progress_entries_update on public.project_progress_entries for update
  using (org_id = public.auth_org_id() and public.may_record_project_progress(project_id))
  with check (org_id = public.auth_org_id() and public.may_record_project_progress(project_id));
-- No DELETE policy and no DELETE grant: an estimate is corrected by re-recording, not removed.

-- §5 grants — column-level so the witness columns stay server-owned. Hosted Supabase grants ALL on new
-- public tables by default; revoke first or the column lists below are a silent no-op.
revoke all on public.project_progress_entries from anon, authenticated;
grant select on public.project_progress_entries to authenticated;
grant insert (project_id, month, pct_complete, note) on public.project_progress_entries to authenticated;
grant update (pct_complete, note) on public.project_progress_entries to authenticated;

-- §6 the org's current month (FR-MMP-002). Takes the instant as a parameter so pgTAP can pin it.
create or replace function public.org_current_month(p_timezone text, p_at timestamptz) returns date
  language sql stable set search_path = pg_catalog as $$
  select date_trunc('month', (p_at at time zone coalesce(p_timezone, 'UTC')))::date
$$;
revoke all     on function public.org_current_month(text, timestamptz) from public, anon;
grant  execute on function public.org_current_month(text, timestamptz) to authenticated;

-- §7 the writer: atomic upsert per (project, month). INVOKER — RLS + the column grants above still apply;
-- the explicit checks exist only to give the caller the RULE instead of a policy name.
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;
revoke all     on function public.record_project_progress(uuid, date, numeric, text) from public, anon;
grant  execute on function public.record_project_progress(uuid, date, numeric, text) to authenticated;

-- §8 the reader. Returns FACTS; the series arithmetic lives in buildManagementPack (ADR-0076).
--   • invoice statuses = REVENUE_STATUSES (src/lib/db/revenue.ts) — a positive allow-list.
--   • net-of-tax CASE byte-identical to get_project_drawdown (0197 §3).
--   • on-hand list = ON_HAND_STATUSES (src/lib/db/projectTransitions.ts); keep the two in step.
create or replace function public.get_management_pack(p_from date default null, p_to date default null)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_tz     text;
  v_cur    text;
  v_to     date;
  v_from   date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_to   := coalesce(date_trunc('month', p_to)::date, public.org_current_month(v_tz, now()));
  v_from := coalesce(date_trunc('month', p_from)::date, date_trunc('year', v_to)::date);

  if v_from > v_to or v_from < (v_to - interval '23 months')::date then
    raise exception 'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it'
      using errcode = '22023';
  end if;

  with counted as (
    select si.project_id, si.currency,
           date_trunc('month', si.invoice_date)::date as month,
           case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net
      from public.sales_invoices si
     where si.org_id = v_org
       and si.status in ('Submitted', 'Unpaid', 'Paid')
       and si.amount is not null
       and si.invoice_date is not null
       and si.invoice_date < (v_to + interval '1 month')::date
  ),
  in_window as (
    select project_id, currency, month, sum(net) as net, count(*)::int as invoice_count
      from counted where month >= v_from
     group by project_id, currency, month
  ),
  before_window as (
    select project_id, currency, sum(net) as net
      from counted where month < v_from
     group by project_id, currency
  ),
  proj as (
    select p.id, p.name, p.pmo_project_number, p.code, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net,
           p.start_date, p.end_date, p.project_manager_id, c.name as client_name
      from public.projects p
      left join public.companies c on c.id = p.client_id
     where p.org_id = v_org
       and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
            or exists (select 1 from in_window w where w.project_id = p.id))
  ),
  progress as (
    select e.project_id, e.month, e.pct_complete, e.entered_at, pr.full_name as entered_by_name
      from public.project_progress_entries e
      join proj on proj.id = e.project_id
      left join public.profiles pr on pr.id = e.entered_by
     where e.month <= v_to
       and (   e.month >= v_from
            or e.month = (select max(e2.month) from public.project_progress_entries e2
                           where e2.project_id = e.project_id and e2.month < v_from))
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'timezone', v_tz,
    'org_currency', v_cur,
    'undated_invoice_count', (select count(*)::int from public.sales_invoices si
                               where si.org_id = v_org and si.status in ('Submitted', 'Unpaid', 'Paid')
                                 and si.amount is not null and si.invoice_date is null),
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.name, x.id) from proj x), '[]'::jsonb),
    'invoiced', coalesce((select jsonb_agg(to_jsonb(w) order by w.month, w.project_id, w.currency)
                            from in_window w
                           where w.project_id is null or w.project_id in (select id from proj)), '[]'::jsonb),
    'invoiced_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.project_id, b.currency)
                                   from before_window b
                                  where b.project_id is null or b.project_id in (select id from proj)), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from progress g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end; $$;
revoke all     on function public.get_management_pack(date, date) from public, anon;
grant  execute on function public.get_management_pack(date, date) to authenticated;

-- §9 NFR-MMP-001: the pack scans invoices by org and date.
create index if not exists sales_invoices_org_invoice_date_idx on public.sales_invoices (org_id, invoice_date);
```

Create `supabase/migrations/rollback/0243_management_pack_down.sql`:

```sql
-- Reverses 0243_management_pack.sql. Order: functions that read the table, the table (takes its policies,
-- triggers and indexes with it), then the helpers and the sales_invoices index.
drop function if exists public.get_management_pack(date, date);
drop function if exists public.record_project_progress(uuid, date, numeric, text);
drop table if exists public.project_progress_entries;
drop function if exists public.may_record_project_progress(uuid);
drop function if exists public.stamp_project_progress_entry();
drop function if exists public.org_current_month(text, timestamptz);
drop index if exists public.sales_invoices_org_invoice_date_idx;
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0243_management_pack.test.sql supabase/tests/0005_force_rls.test.sql'`
Expect: all 40 pass, and 0005's FORCE-RLS invariant still passes.
Mutation check (required): temporarily change `may_record_project_progress`'s `p.project_manager_id = auth.uid()`
to `true`, re-run — assertions 31 and 32 MUST go red. Revert, re-run green.

### Task 3 — regenerate DB types · supports all FE tasks

`supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`
Keep the file's existing header lines. Verify: `git diff --stat -- pmo-portal/src/lib/supabase/database.types.ts`
shows `project_progress_entries` and the `get_management_pack`, `record_project_progress`, `org_current_month`
and `may_record_project_progress` function entries; no hand edits, no casts.

### Task 4 — DAL (test first) · supports AC-MMP-013/014

Create `pmo-portal/src/lib/db/managementPack.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getManagementPackFacts, recordProjectProgress, parseManagementPackFacts } from './managementPack';

const body = {
  from: '2026-01-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [], invoiced: [], invoiced_before: [], progress: [],
};

beforeEach(() => h.rpc.mockReset());

describe('db/managementPack', () => {
  it('AC-MMP-013 support: omits an unset window so the server picks the org-timezone default', async () => {
    h.rpc.mockResolvedValue({ data: body, error: null });
    await getManagementPackFacts({});
    expect(h.rpc).toHaveBeenCalledWith('get_management_pack', {});
  });

  it('AC-MMP-013 support: passes a chosen window through', async () => {
    h.rpc.mockResolvedValue({ data: body, error: null });
    await getManagementPackFacts({ from: '2026-01-01', to: '2026-04-01' });
    expect(h.rpc).toHaveBeenCalledWith('get_management_pack', { p_from: '2026-01-01', p_to: '2026-04-01' });
  });

  it('AC-MMP-013 support: a malformed body is an error, never an empty pack', () => {
    expect(() => parseManagementPackFacts({ ...body, projects: null })).toThrow(/malformed/);
    expect(() => parseManagementPackFacts(null)).toThrow(/malformed/);
  });

  it('AC-MMP-013 support: an RPC error keeps its code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'window', code: '22023' } });
    await expect(getManagementPackFacts({})).rejects.toMatchObject({ code: '22023' });
  });

  it('AC-MMP-014 support: records progress with a trimmed note, omitting an empty one', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await recordProjectProgress({ projectId: 'p1', month: '2026-03-01', pctComplete: 45, note: '  site visit ' });
    await recordProjectProgress({ projectId: 'p1', month: '2026-04-01', pctComplete: 50, note: '   ' });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'record_project_progress',
      { p_project_id: 'p1', p_month: '2026-03-01', p_pct_complete: 45, p_note: 'site visit' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'record_project_progress',
      { p_project_id: 'p1', p_month: '2026-04-01', p_pct_complete: 50 });
  });
});
```

Verify RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/managementPack.test.ts'` (module missing).

Create `pmo-portal/src/lib/db/managementPack.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * #765 — facts for the monthly management pack (ADR-0076). One SECURITY INVOKER RPC: RLS scopes the org,
 * the server normalises every amount to NET of tax and buckets invoices by `invoice_date` month. The time
 * series is derived client-side by `buildManagementPack` (src/lib/reports/managementPack.ts).
 */

/** First-of-month ISO dates (`YYYY-MM-01`). Omitted → server default (org timezone, FR-MMP-002). */
export interface ManagementPackRange {
  from?: string | null;
  to?: string | null;
}

export interface PackFactsProject {
  id: string;
  name: string;
  pmo_project_number: string | null;
  code: string | null;
  status: string;
  currency: string;
  /** Contract value NET of tax (0197's formula, computed server-side). */
  contract_net: number;
  start_date: string | null;
  end_date: string | null;
  project_manager_id: string | null;
  client_name: string | null;
}

export interface PackFactsInvoiced {
  project_id: string | null;
  currency: string;
  month: string;
  net: number;
  invoice_count: number;
}

export interface PackFactsInvoicedBefore {
  project_id: string | null;
  currency: string;
  net: number;
}

export interface PackFactsProgress {
  project_id: string;
  month: string;
  pct_complete: number;
  entered_at: string;
  entered_by_name: string | null;
}

export interface ManagementPackFacts {
  from: string;
  to: string;
  timezone: string;
  org_currency: string;
  undated_invoice_count: number;
  projects: PackFactsProject[];
  invoiced: PackFactsInvoiced[];
  invoiced_before: PackFactsInvoicedBefore[];
  progress: PackFactsProgress[];
}

export interface ProjectProgressInput {
  projectId: string;
  /** `YYYY-MM-01`; the server also normalises any day to the first. */
  month: string;
  pctComplete: number;
  note: string | null;
}

const ARRAY_KEYS = ['projects', 'invoiced', 'invoiced_before', 'progress'] as const;

/** Narrow the RPC's jsonb to the facts shape. A malformed body is an error, never an empty pack. */
export function parseManagementPackFacts(data: unknown): ManagementPackFacts {
  const d = data as Record<string, unknown> | null;
  const ok =
    d != null &&
    typeof d === 'object' &&
    typeof d.from === 'string' &&
    typeof d.to === 'string' &&
    typeof d.timezone === 'string' &&
    typeof d.org_currency === 'string' &&
    typeof d.undated_invoice_count === 'number' &&
    ARRAY_KEYS.every((k) => Array.isArray(d[k]));
  if (!ok) throw new AppError('The management pack response was malformed', 'pack-malformed');
  return d as unknown as ManagementPackFacts;
}

export async function getManagementPackFacts(range: ManagementPackRange = {}): Promise<ManagementPackFacts> {
  const args: { p_from?: string; p_to?: string } = {};
  if (range.from) args.p_from = range.from;
  if (range.to) args.p_to = range.to;
  const { data, error } = await supabase.rpc('get_management_pack', args);
  if (error) throw new AppError(error.message, error.code);
  return parseManagementPackFacts(data);
}

export async function recordProjectProgress(input: ProjectProgressInput): Promise<void> {
  const args: { p_project_id: string; p_month: string; p_pct_complete: number; p_note?: string } = {
    p_project_id: input.projectId,
    p_month: input.month,
    p_pct_complete: input.pctComplete,
  };
  const note = input.note?.trim();
  if (note) args.p_note = note;
  const { error } = await supabase.rpc('record_project_progress', args);
  if (error) throw new AppError(error.message, error.code);
}
```

Verify GREEN: same command as RED.

### Task 5 — month arithmetic · supports AC-MMP-006/007/014

Create `pmo-portal/src/lib/reports/months.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addDays, addMonths, daysInclusive, monthEnd, monthInputToIso, monthsBetween } from './months';

describe('reports/months (UTC calendar arithmetic, no host-timezone drift)', () => {
  it('AC-MMP-006 support: steps months across a year end', () => {
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });
  it('AC-MMP-006 support: lists an inclusive window and an empty one when reversed', () => {
    expect(monthsBetween('2026-01-01', '2026-04-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(monthsBetween('2026-05-01', '2026-04-01')).toEqual([]);
  });
  it('AC-MMP-006 support: month ends and inclusive day counts respect leap years', () => {
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive('2026-01-01', '2026-04-30')).toBe(120);
  });
  it('AC-MMP-014 support: reads an <input type="month"> value', () => {
    expect(monthInputToIso('2026-09')).toBe('2026-09-01');
    expect(monthInputToIso('2026-13')).toBeNull();
    expect(monthInputToIso('')).toBeNull();
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/months.test.ts'`

Create `pmo-portal/src/lib/reports/months.ts`:

```ts
/**
 * First-of-month ISO date arithmetic (`YYYY-MM-01`), done in UTC so no host timezone can move a day.
 * Month boundaries themselves are decided server-side in the ORG timezone (org_current_month); these
 * helpers only walk calendar dates the server already chose.
 */
const MS_PER_DAY = 86_400_000;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = parts(month);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthEnd(month: string): string {
  return addDays(addMonths(month, 1), -1);
}

/** Inclusive day count, `b >= a`. */
export function daysInclusive(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY) + 1;
}

/** `YYYY-MM` from an `<input type="month">` → `YYYY-MM-01`; null for anything else. */
export function monthInputToIso(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}
```

GREEN: same command.

### Task 6 — money helpers + planned revenue (the whole builder file) · AC-MMP-006

Create `pmo-portal/src/lib/reports/managementPack.test.ts` (Task 7 appends to it):

```ts
import { describe, it, expect } from 'vitest';
import { buildManagementPack, mulDivRound, pctOf, plannedForMonth } from './managementPack';
import type { ManagementPackFacts, PackFactsProject } from '@/src/lib/db/managementPack';

const c = (major: number) => Math.round(major * 100);

const P1: PackFactsProject = {
  id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project',
  currency: 'IDR', contract_net: 1_200_000, start_date: '2026-01-01', end_date: '2026-04-30',
  project_manager_id: 'u-pm', client_name: 'Client A',
};

function facts(over: Partial<ManagementPackFacts> = {}): ManagementPackFacts {
  return {
    from: '2026-01-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
    projects: [P1], invoiced: [], invoiced_before: [], progress: [], ...over,
  };
}

describe('AC-MMP-006 planned revenue (DD-MMP-2)', () => {
  it('AC-MMP-006: spreads the net contract straight-line by calendar day', () => {
    const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'];
    expect(months.map((m) => plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', m)))
      .toEqual([c(310_000), c(280_000), c(310_000), c(300_000)]);
    expect(plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', '2026-05-01')).toBe(0);
    expect(plannedForMonth(c(1_200_000), '2026-01-01', '2026-04-30', '2025-12-01')).toBe(0);
  });

  it('AC-MMP-006: rounds the cumulative figure so the months sum exactly to the contract', () => {
    expect(plannedForMonth(10_000, '2026-01-30', '2026-02-01', '2026-01-01')).toBe(6667);
    expect(plannedForMonth(10_000, '2026-01-30', '2026-02-01', '2026-02-01')).toBe(3333);
  });

  it('AC-MMP-006: a project without a usable schedule has no plan', () => {
    expect(plannedForMonth(c(1_000), '2026-01-01', null, '2026-01-01')).toBeNull();
    expect(plannedForMonth(c(1_000), '2026-03-01', '2026-01-01', '2026-01-01')).toBeNull();
  });

  it('AC-MMP-006: the pack row carries the plan per month', () => {
    const row = buildManagementPack(facts()).rows[0];
    expect(row.months.map((m) => m.planned)).toEqual([c(310_000), c(280_000), c(310_000), c(300_000)]);
  });

  it('AC-MMP-006 support: proportional splits round half up, exactly', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(pctOf(10_001, 33.33)).toBe(3333);
    expect(pctOf(c(1_200_000), 40)).toBe(c(480_000));
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/managementPack.test.ts'`

Create `pmo-portal/src/lib/reports/managementPack.ts` with the full builder (Task 7's tests exercise the rest of
this file; it is written once, here, so no later task rewrites it):

```ts
import { addDays, addMonths, daysInclusive, monthEnd, monthsBetween } from './months';
import type { ManagementPackFacts, PackFactsProgress, PackFactsProject } from '@/src/lib/db/managementPack';

/**
 * #765 — the monthly management pack, derived from server facts (ADR-0076, DD-MMP-1..5).
 * Every figure is NET of tax, in the row's own currency, in integer cents (NFR-MMP-002).
 */
export type Cents = number;
export type RecognitionBasis = 'progress' | 'invoiced';
export type PackRowKind = 'contract' | 'otherCurrency' | 'unassigned';

export interface PackMonth {
  month: string;
  /** null = the project has no usable start/end dates ("No schedule"), or the row has no contract. */
  planned: Cents | null;
  recognised: Cents;
  invoiced: Cents;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  /** recognisedToDate − invoicedToDate; negative = billed ahead (DD-MMP-3). */
  unbilled: Cents;
  /** contractNet − recognisedToDate; null for rows without a contract. Never clamped. */
  backlog: Cents | null;
  basis: RecognitionBasis;
}

export interface PackProgress {
  month: string;
  pctComplete: number;
  enteredByName: string | null;
  enteredAt: string;
}

export interface PackRow {
  key: string;
  kind: PackRowKind;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  clientName: string | null;
  projectManagerId: string | null;
  currency: string;
  contractNet: Cents | null;
  /** Latest entry dated on or before the as-at month; null = billing basis throughout. */
  latestProgress: PackProgress | null;
  months: PackMonth[];
}

export interface PackTotalsMonth {
  month: string;
  planned: Cents;
  recognised: Cents;
  invoiced: Cents;
  recognisedToDate: Cents;
  invoicedToDate: Cents;
  unbilled: Cents;
  backlog: Cents;
}

export interface PackCurrencyTotals {
  currency: string;
  months: PackTotalsMonth[];
}

export interface ManagementPack {
  from: string;
  to: string;
  timezone: string;
  months: string[];
  rows: PackRow[];
  totals: PackCurrencyTotals[];
  undatedInvoiceCount: number;
}

export const toCents = (amount: number): Cents => Math.round(amount * 100);
export const fromCents = (cents: Cents): number => cents / 100;

/** round_half_up(amount × num / den) for amount ≥ 0, num ≥ 0, den > 0. BigInt: amount × num can pass 2^53. */
export function mulDivRound(amount: Cents, num: number, den: number): Cents {
  const a = BigInt(amount);
  const n = BigInt(num);
  const d = BigInt(den);
  return Number((a * n * 2n + d) / (2n * d));
}

/** `pct` (0–100, at most 2 decimals) of a non-negative amount. */
export function pctOf(amount: Cents, pct: number): Cents {
  return mulDivRound(amount, Math.round(pct * 100), 10_000);
}

/** DD-MMP-2: straight-line by calendar day; null when there is no usable schedule. */
export function plannedForMonth(contractNet: Cents, start: string | null, end: string | null, month: string): Cents | null {
  if (!start || !end || end < start) return null;
  const total = daysInclusive(start, end);
  const cumulativeThrough = (day: string): Cents => {
    if (day < start) return 0;
    if (day >= end) return contractNet;
    return mulDivRound(contractNet, daysInclusive(start, day), total);
  };
  return cumulativeThrough(monthEnd(month)) - cumulativeThrough(addDays(month, -1));
}

const factKey = (projectId: string | null, currency: string): string => `${projectId ?? ''}|${currency}`;

function latestAtOrBefore(entries: PackFactsProgress[], month: string): PackFactsProgress | null {
  let found: PackFactsProgress | null = null;
  for (const e of entries) if (e.month <= month && (!found || e.month > found.month)) found = e;
  return found;
}

interface RowInput {
  kind: PackRowKind;
  project: PackFactsProject | null;
  currency: string;
  invoicedByMonth: Map<string, Cents>;
  invoicedBefore: Cents;
  progress: PackFactsProgress[];
  months: string[];
  from: string;
  to: string;
}

function buildRow(r: RowInput): PackRow {
  const contractNet = r.kind === 'contract' && r.project ? toCents(r.project.contract_net) : null;
  const recognisedToDateAt = (month: string, invoicedToDate: Cents): { value: Cents; basis: RecognitionBasis } => {
    const entry = contractNet !== null ? latestAtOrBefore(r.progress, month) : null;
    return entry && contractNet !== null
      ? { value: pctOf(contractNet, entry.pct_complete), basis: 'progress' }
      : { value: invoicedToDate, basis: 'invoiced' };
  };

  let invoicedToDate = r.invoicedBefore;
  let previous = recognisedToDateAt(addMonths(r.from, -1), invoicedToDate).value;
  const months = r.months.map((month): PackMonth => {
    const invoiced = r.invoicedByMonth.get(month) ?? 0;
    invoicedToDate += invoiced;
    const { value: recognisedToDate, basis } = recognisedToDateAt(month, invoicedToDate);
    const out: PackMonth = {
      month,
      planned: contractNet !== null && r.project
        ? plannedForMonth(contractNet, r.project.start_date, r.project.end_date, month)
        : null,
      recognised: recognisedToDate - previous,
      invoiced,
      recognisedToDate,
      invoicedToDate,
      unbilled: recognisedToDate - invoicedToDate,
      backlog: contractNet === null ? null : contractNet - recognisedToDate,
      basis,
    };
    previous = recognisedToDate;
    return out;
  });

  const latest = contractNet !== null ? latestAtOrBefore(r.progress, r.to) : null;
  return {
    key: `${factKey(r.project?.id ?? null, r.currency)}|${r.kind}`,
    kind: r.kind,
    projectId: r.project?.id ?? null,
    projectName: r.project?.name ?? null,
    projectNumber: r.project?.pmo_project_number ?? null,
    clientName: r.project?.client_name ?? null,
    projectManagerId: r.project?.project_manager_id ?? null,
    currency: r.currency,
    contractNet,
    latestProgress: latest
      ? { month: latest.month, pctComplete: latest.pct_complete, enteredByName: latest.entered_by_name, enteredAt: latest.entered_at }
      : null,
    months,
  };
}

function totalsByCurrency(rows: PackRow[], months: string[]): PackCurrencyTotals[] {
  const byCurrency = new Map<string, PackTotalsMonth[]>();
  for (const row of rows) {
    const series = byCurrency.get(row.currency) ?? months.map((month) => ({
      month, planned: 0, recognised: 0, invoiced: 0, recognisedToDate: 0, invoicedToDate: 0, unbilled: 0, backlog: 0,
    }));
    row.months.forEach((m, i) => {
      const t = series[i];
      t.planned += m.planned ?? 0;
      t.recognised += m.recognised;
      t.invoiced += m.invoiced;
      t.recognisedToDate += m.recognisedToDate;
      t.invoicedToDate += m.invoicedToDate;
      t.unbilled += m.unbilled;
      t.backlog += m.backlog ?? 0;
    });
    byCurrency.set(row.currency, series);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, series]) => ({ currency, months: series }));
}

export function buildManagementPack(facts: ManagementPackFacts): ManagementPack {
  const months = monthsBetween(facts.from, facts.to);

  const invoiced = new Map<string, Map<string, Cents>>();
  for (const f of facts.invoiced) {
    const k = factKey(f.project_id, f.currency);
    const byMonth = invoiced.get(k) ?? new Map<string, Cents>();
    byMonth.set(f.month, (byMonth.get(f.month) ?? 0) + toCents(f.net));
    invoiced.set(k, byMonth);
  }
  const before = new Map<string, Cents>();
  for (const f of facts.invoiced_before) {
    const k = factKey(f.project_id, f.currency);
    before.set(k, (before.get(k) ?? 0) + toCents(f.net));
  }
  const progressByProject = new Map<string, PackFactsProgress[]>();
  for (const p of facts.progress) {
    const list = progressByProject.get(p.project_id) ?? [];
    list.push(p);
    progressByProject.set(p.project_id, list);
  }

  const common = { months, from: facts.from, to: facts.to };
  const rows: PackRow[] = [];
  const covered = new Set<string>();
  const projectsById = new Map(facts.projects.map((p) => [p.id, p] as const));

  for (const project of facts.projects) {
    const k = factKey(project.id, project.currency);
    covered.add(k);
    rows.push(buildRow({
      ...common, kind: 'contract', project, currency: project.currency,
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoicedBefore: before.get(k) ?? 0,
      progress: progressByProject.get(project.id) ?? [],
    }));
  }

  // Other-currency rows sort with their project's id; Unassigned (empty id) goes last.
  const extraKeys = [...new Set([...invoiced.keys(), ...before.keys()])]
    .filter((k) => !covered.has(k))
    .sort((a, b) => Number(a.startsWith('|')) - Number(b.startsWith('|')) || a.localeCompare(b));
  for (const k of extraKeys) {
    const sep = k.lastIndexOf('|');
    const projectId = k.slice(0, sep) || null;
    rows.push(buildRow({
      ...common,
      kind: projectId ? 'otherCurrency' : 'unassigned',
      project: projectId ? projectsById.get(projectId) ?? null : null,
      currency: k.slice(sep + 1),
      invoicedByMonth: invoiced.get(k) ?? new Map(), invoicedBefore: before.get(k) ?? 0,
      progress: [],
    }));
  }

  return {
    from: facts.from, to: facts.to, timezone: facts.timezone, months, rows,
    totals: totalsByCurrency(rows, months), undatedInvoiceCount: facts.undated_invoice_count,
  };
}
```

GREEN: same command (the 5 AC-MMP-006 tests pass).

### Task 7 — recognition, unbilled, backlog, currencies · AC-MMP-007, 008, 009, 010

Append to `pmo-portal/src/lib/reports/managementPack.test.ts`:

```ts
const prog = (month: string, pct: number) =>
  ({ project_id: 'p1', month, pct_complete: pct, entered_at: `${month}T10:00:00Z`, entered_by_name: 'Fin' });
const inv = (project_id: string | null, currency: string, month: string, net: number) =>
  ({ project_id, currency, month, net, invoice_count: 1 });

const scenario = facts({
  invoiced_before: [{ project_id: 'p1', currency: 'IDR', net: 100_000 }],
  invoiced: [inv('p1', 'IDR', '2026-01-01', 200_000), inv('p1', 'IDR', '2026-03-01', 300_000)],
  progress: [prog('2026-02-01', 40), prog('2026-04-01', 55)],
});

describe('AC-MMP-007 recognised revenue (DD-MMP-1)', () => {
  it('AC-MMP-007: billing basis until the first entry, then percent of the net contract, carried forward', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.recognisedToDate)).toEqual([c(300_000), c(480_000), c(480_000), c(660_000)]);
    expect(row.months.map((m) => m.recognised)).toEqual([c(200_000), c(180_000), 0, c(180_000)]);
    expect(row.months.map((m) => m.basis)).toEqual(['invoiced', 'progress', 'progress', 'progress']);
    expect(row.latestProgress).toMatchObject({ month: '2026-04-01', pctComplete: 55 });
  });

  it('AC-MMP-007: an entry from before the window carries in, with nothing recognised in month', () => {
    const row = buildManagementPack(facts({ progress: [prog('2025-11-01', 10)] })).rows[0];
    expect(row.months[0]).toMatchObject({ basis: 'progress', recognisedToDate: c(120_000), recognised: 0 });
  });

  it('AC-MMP-007: a lower percent than last month recognises a negative amount', () => {
    const row = buildManagementPack(facts({ progress: [prog('2026-01-01', 40), prog('2026-02-01', 30)] })).rows[0];
    expect(row.months[1].recognised).toBe(-c(120_000));
  });
});

describe('AC-MMP-008 unbilled (DD-MMP-3)', () => {
  it('AC-MMP-008: recognised to date minus invoiced to date; negative means billed ahead', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.invoicedToDate)).toEqual([c(300_000), c(300_000), c(600_000), c(600_000)]);
    expect(row.months.map((m) => m.unbilled)).toEqual([0, c(180_000), -c(120_000), c(60_000)]);
  });
});

describe('AC-MMP-009 backlog (DD-MMP-3)', () => {
  it('AC-MMP-009: net contract minus recognised to date, per month', () => {
    const row = buildManagementPack(scenario).rows[0];
    expect(row.months.map((m) => m.backlog)).toEqual([c(900_000), c(720_000), c(720_000), c(540_000)]);
  });

  it('AC-MMP-009: recognised above the contract gives a negative backlog, not a clamped zero', () => {
    const row = buildManagementPack(facts({ invoiced: [inv('p1', 'IDR', '2026-01-01', 1_300_000)] })).rows[0];
    expect(row.months[0].backlog).toBe(-c(100_000));
  });
});

describe('AC-MMP-010 currencies and unassigned invoices (DD-MMP-5, DD-CUR-6)', () => {
  const pack = buildManagementPack(facts({
    invoiced: [
      inv('p1', 'IDR', '2026-01-01', 200_000),
      inv('p1', 'USD', '2026-02-01', 50),
      inv(null, 'IDR', '2026-01-01', 1_000),
    ],
  }));

  it('AC-MMP-010: one contract row, one other-currency row, one unassigned row', () => {
    expect(pack.rows.map((r) => [r.kind, r.currency])).toEqual([
      ['contract', 'IDR'], ['otherCurrency', 'USD'], ['unassigned', 'IDR'],
    ]);
  });

  it('AC-MMP-010: rows without a contract recognise on billing basis with no plan and no backlog', () => {
    const usd = pack.rows[1];
    expect(usd.projectName).toBe('Alpha');
    expect(usd.months[1]).toMatchObject({ invoiced: 5_000, recognised: 5_000, unbilled: 0, planned: null, backlog: null, basis: 'invoiced' });
  });

  it('AC-MMP-010: totals are one series per currency and never mix them', () => {
    expect(pack.totals.map((t) => t.currency)).toEqual(['IDR', 'USD']);
    const idr = pack.totals[0].months;
    const usd = pack.totals[1].months;
    expect(idr[0].invoiced).toBe(c(201_000));
    expect(idr[1].invoiced).toBe(0);
    expect(usd[1].invoiced).toBe(5_000);
    expect(idr[0].backlog).toBe(c(1_200_000) - c(200_000));
  });
});
```

Verify: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/managementPack.test.ts'` — all
green against Task 6's file. Mandatory mutation checks (money oracles), each reverted after: in `buildRow` set
`unbilled: 0` → AC-MMP-008 must fail; make `recognisedToDateAt` always return `{ value: invoicedToDate, basis: 'invoiced' }`
→ AC-MMP-007 must fail; in `totalsByCurrency` key the map by `'ALL'` instead of `row.currency` → AC-MMP-010 must fail.

### Task 8 — CSV writer + file extension · AC-MMP-011

Create `pmo-portal/src/lib/export/__tests__/toCsv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCsv } from '../toCsv';
import { exportFilename } from '../exportFilename';

describe('toCsv (RFC 4180 + CSV-injection guard)', () => {
  it('AC-MMP-011: BOM, CRLF, numbers raw, quoting for commas, quotes and newlines', () => {
    const out = toCsv({ header: ['Project', 'Amount'], body: [['A, "B"', 1234.5], ['line\nbreak', -3]] });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('Project,Amount\r\n"A, ""B""",1234.5\r\n"line\nbreak",-3\r\n');
  });

  it('AC-MMP-011: a text cell a spreadsheet would run as a formula is neutralised', () => {
    const out = toCsv({ header: ['x'], body: [['=SUM(A1)'], ['+1'], ['-2'], ['@x']] });
    expect(out.slice(1).split('\r\n').slice(1, 5)).toEqual(["'=SUM(A1)", "'+1", "'-2", "'@x"]);
  });

  it('AC-MMP-011: export file names take an extension; xlsx stays the default', () => {
    const d = new Date('2026-10-06T09:00:00');
    expect(exportFilename('Management-pack_2026-09', d, 'csv')).toBe('Management-pack_2026-09_2026-10-06.csv');
    expect(exportFilename('Companies', d)).toBe('Companies_2026-10-06.xlsx');
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/export/__tests__/toCsv.test.ts'`

Create `pmo-portal/src/lib/export/toCsv.ts`:

```ts
import type { CellValue, ExportTable } from './buildExportRows';

// UTF-8 byte-order mark: Excel then reads non-ASCII project and client names correctly.
const BOM = String.fromCharCode(0xfeff);
// OWASP CSV injection: a text cell starting with one of these is read as a formula by Excel/Sheets.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function csvCell(v: CellValue): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const text = FORMULA_PREFIX.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV: BOM, CRLF line ends, numbers unformatted (dot decimal) so any spreadsheet reads them. */
export function toCsv({ header, body }: ExportTable): string {
  const lines = [header, ...body].map((row) => row.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
```

Replace `pmo-portal/src/lib/export/exportFilename.ts` with:

```ts
/**
 * Build the download filename for an export: `<Entity>_<YYYY-MM-DD>.<ext>`, using the caller-supplied
 * entity label and a date (defaults to today's local date). Date and extension are injectable so
 * callers/tests stay deterministic; `xlsx` remains the default for every existing caller.
 */
export function exportFilename(entity: string, date: Date = new Date(), ext: 'xlsx' | 'csv' = 'xlsx'): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${entity}_${y}-${m}-${d}.${ext}`;
}
```

In `pmo-portal/src/lib/export/index.ts` add the line `export { toCsv } from './toCsv';`.

GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/export'` (existing export tests stay green).

### Task 9 — the pack's export table · AC-MMP-011

Create `pmo-portal/src/lib/reports/managementPackExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildManagementPack } from './managementPack';
import { buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels } from './managementPackExport';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const labels: ManagementPackExportLabels = {
  month: 'Month', projectNumber: 'Project number', project: 'Project', client: 'Client', currency: 'Currency',
  taxBasis: 'Tax basis', planned: 'Planned', recognised: 'Recognised', invoiced: 'Invoiced',
  recognisedToDate: 'Recognised to date', invoicedToDate: 'Invoiced to date', unbilled: 'Unbilled',
  backlog: 'Backlog', basis: 'Basis', taxBasisValue: 'excl. PPN', unassigned: 'Unassigned', total: 'Total',
  basisInvoiced: 'Invoiced', basisProgress: 'Progress',
};

const facts: ManagementPackFacts = {
  from: '2026-01-01', to: '2026-02-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{
    id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project',
    currency: 'IDR', contract_net: 1_000, start_date: null, end_date: null, project_manager_id: null, client_name: 'Client A',
  }],
  invoiced: [
    { project_id: 'p1', currency: 'IDR', month: '2026-01-01', net: 100.5, invoice_count: 1 },
    { project_id: null, currency: 'IDR', month: '2026-02-01', net: 7, invoice_count: 1 },
  ],
  invoiced_before: [],
  progress: [{ project_id: 'p1', month: '2026-02-01', pct_complete: 50, entered_at: '2026-02-28T00:00:00Z', entered_by_name: 'Fin' }],
};

describe('AC-MMP-011 management pack export', () => {
  const pack = buildManagementPack(facts);
  const table = buildManagementPackExport(pack, labels);
  const col = (name: string) => table.header.indexOf(name);

  it('AC-MMP-011: one row per pack row per month, then a total row per currency per month', () => {
    expect(table.body).toHaveLength(2 * 2 + 1 * 2);
    expect(table.body.at(-1)![col('Project')]).toBe('Total');
  });

  it('AC-MMP-011: every row carries its currency and the tax basis; money cells are numbers', () => {
    for (const r of table.body) {
      expect(r[col('Currency')]).toBe('IDR');
      expect(r[col('Tax basis')]).toBe('excl. PPN');
    }
    const feb = table.body[1];
    expect(feb[col('Month')]).toBe('2026-02');
    expect(feb[col('Project number')]).toBe('PRJ-26-0001');
    expect(feb[col('Recognised to date')]).toBe(500);
    expect(feb[col('Invoiced to date')]).toBe(100.5);
    expect(feb[col('Unbilled')]).toBe(399.5);
    expect(feb[col('Backlog')]).toBe(500);
    expect(feb[col('Basis')]).toBe('Progress');
    expect(feb[col('Planned')]).toBe('');
    expect(table.body[3][col('Project')]).toBe('Unassigned');
  });

  it('AC-MMP-011: the file name carries the as-at month', () => {
    expect(managementPackFileStem(pack)).toBe('Management-pack_2026-02');
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/managementPackExport.test.ts'`

Create `pmo-portal/src/lib/reports/managementPackExport.ts`:

```ts
import type { CellValue, ExportTable } from '@/src/lib/export';
import { fromCents, type ManagementPack, type PackRow } from './managementPack';

/** Translated column titles and cell words — the page passes `t()` results; this module stays pure. */
export interface ManagementPackExportLabels {
  month: string;
  projectNumber: string;
  project: string;
  client: string;
  currency: string;
  taxBasis: string;
  planned: string;
  recognised: string;
  invoiced: string;
  recognisedToDate: string;
  invoicedToDate: string;
  unbilled: string;
  backlog: string;
  basis: string;
  /** Every figure is net of tax (DD-MMP-5); OD-TAX-1 §2 forbids a bare number. */
  taxBasisValue: string;
  unassigned: string;
  total: string;
  basisInvoiced: string;
  basisProgress: string;
}

const money = (cents: number | null): CellValue => (cents === null ? '' : fromCents(cents));
const rowName = (row: PackRow, l: ManagementPackExportLabels): string =>
  row.kind === 'unassigned' ? l.unassigned : row.projectName ?? '';

/** Long format (one row per project row × month) so a pivot table can reshape it; months are `YYYY-MM` text. */
export function buildManagementPackExport(pack: ManagementPack, l: ManagementPackExportLabels): ExportTable {
  const header = [
    l.month, l.projectNumber, l.project, l.client, l.currency, l.taxBasis, l.planned, l.recognised, l.invoiced,
    l.recognisedToDate, l.invoicedToDate, l.unbilled, l.backlog, l.basis,
  ];
  const body: CellValue[][] = [];
  for (const row of pack.rows) {
    for (const m of row.months) {
      body.push([
        m.month.slice(0, 7), row.projectNumber ?? '', rowName(row, l), row.clientName ?? '', row.currency,
        l.taxBasisValue, money(m.planned), money(m.recognised), money(m.invoiced), money(m.recognisedToDate),
        money(m.invoicedToDate), money(m.unbilled), money(m.backlog),
        m.basis === 'progress' ? l.basisProgress : l.basisInvoiced,
      ]);
    }
  }
  for (const totals of pack.totals) {
    for (const t of totals.months) {
      body.push([
        t.month.slice(0, 7), '', l.total, '', totals.currency, l.taxBasisValue, money(t.planned), money(t.recognised),
        money(t.invoiced), money(t.recognisedToDate), money(t.invoicedToDate), money(t.unbilled), money(t.backlog), '',
      ]);
    }
  }
  return { header, body };
}

/** e.g. `Management-pack_2026-09` — the as-at month, so two months' files never collide. */
export function managementPackFileStem(pack: ManagementPack): string {
  return `Management-pack_${pack.to.slice(0, 7)}`;
}
```

GREEN: same command.

### Task 10 — `useExport().exportTable` · AC-MMP-011 (download path)

Create `pmo-portal/src/components/export/__tests__/useExport.table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ csv: [] as string[], names: [] as string[] }));
vi.mock('@/src/lib/export/toCsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/export/toCsv')>();
  return {
    toCsv: (t: Parameters<typeof actual.toCsv>[0]) => {
      const s = actual.toCsv(t);
      h.csv.push(s);
      return s;
    },
  };
});

import { useExport } from '../useExport';

beforeEach(() => {
  h.csv = [];
  h.names = [];
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    h.names.push(this.download);
  });
});

describe('useExport.exportTable', () => {
  it('AC-MMP-011: downloads a pre-built table as CSV under the given stem', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
    const { result } = renderHook(() => useExport(), { wrapper });
    await act(() => result.current.exportTable({ header: ['Currency'], body: [['IDR']] }, 'Management-pack_2026-09', 'csv'));
    expect(h.csv[0].slice(1)).toBe('Currency\r\nIDR\r\n');
    expect(h.names[0]).toMatch(/^Management-pack_2026-09_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/export/__tests__/useExport.table.test.tsx'`

Replace `pmo-portal/src/components/export/useExport.ts` with (`exportXlsx` behaviour unchanged; the download and
the failure toast are extracted so both paths share them):

```ts
/**
 * useExport — builds rows into a typed `.xlsx` (lazy exceljs) or a CSV, and triggers a browser download
 * named `<Entity>_<YYYY-MM-DD>.<ext>`.
 *
 * Read-only re-serialization of in-memory rows (NFR-2): no endpoint, query, or `org_id` handling — the
 * export can only contain rows RLS already returned.
 *
 * Resilience (AC-G3D-RESILIENCE): lazy-import/serialization failures are caught and toasted as
 * "Export failed" so the button doesn't appear dead on failure.
 */

import { useCallback, useState } from 'react';
import type { Column } from '@/src/components/ui';
import { useToast } from '@/src/components/ui';
import { buildExportRows, exportFilename, toCsv, toWorkbookBuffer, type ExportTable } from '@/src/lib/export';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv;charset=utf-8';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useExport() {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const reportFailure = useCallback(
    (err: unknown) => {
      const { headline, detail } = classifyMutationError(err);
      // Re-classify the generic headline for exports so the user understands
      // it is specifically the export that failed (not a data mutation).
      const exportHeadline = headline === 'Update failed' ? 'Export failed' : headline;
      toast(exportHeadline, detail, 'warning');
    },
    [toast],
  );

  const exportXlsx = useCallback(
    async <Row,>(rows: Row[], columns: Column<Row>[], entity: string) => {
      setBusy(true);
      try {
        const { header, body } = buildExportRows(rows, columns);
        const buf = await toWorkbookBuffer({ sheetName: entity, header, body });
        triggerDownload(new Blob([buf], { type: XLSX_MIME }), exportFilename(entity));
      } catch (err) {
        reportFailure(err);
      } finally {
        setBusy(false);
      }
    },
    [reportFailure],
  );

  /** #765: export a table the caller already built (e.g. the management pack's long format). */
  const exportTable = useCallback(
    async (table: ExportTable, entity: string, format: 'xlsx' | 'csv') => {
      setBusy(true);
      try {
        const blob =
          format === 'csv'
            ? new Blob([toCsv(table)], { type: CSV_MIME })
            : new Blob([await toWorkbookBuffer({ sheetName: entity, ...table })], { type: XLSX_MIME });
        triggerDownload(blob, exportFilename(entity, new Date(), format));
      } catch (err) {
        reportFailure(err);
      } finally {
        setBusy(false);
      }
    },
    [reportFailure],
  );

  return { exportXlsx, exportTable, busy };
}
```

GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/export'` (the existing
`useExport.test.tsx` must stay green unmodified).

### Task 11 — `reports` repository · supports AC-MMP-012..016

1. In `pmo-portal/src/lib/repositories/index.test.ts`, the expected key list at line 182: add `'reports'`, and append
   to the comment above it: `'reports' from #765 (migration 0243), the monthly management pack.`
   RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/repositories/index.test.ts'`.
2. In `pmo-portal/src/lib/repositories/types.ts` add, directly before `/** The assembled set of repositories … */`:

```ts
/** #765 — the monthly management pack (ADR-0076). */
export interface ReportsRepository {
  /** Facts for the pack from ONE SECURITY INVOKER RPC; RLS scopes the org. */
  managementPack(range: ManagementPackRange): Promise<ManagementPackFacts>;
  /** Record a project's month-end percent complete (one entry per project per month). */
  recordProgress(input: ProjectProgressInput): Promise<void>;
}
```

   add `import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';`
   after the file's `@/src/lib/db/revenue` type import, and `reports: ReportsRepository;` as the last member of
   `interface Repositories`.
3. In `pmo-portal/src/lib/repositories/index.ts`: add
   `import { getManagementPackFacts, recordProjectProgress } from '@/src/lib/db/managementPack';` after the
   `} from '@/src/lib/db/revenue';` line; add `ReportsRepository,` after `ErpSnapshotsRepository,` in the
   `import type { … } from './types'` list; add directly before `/** The Supabase-backed repositories … */`:

```ts
const reports: ReportsRepository = {
  managementPack: (range) => wrap(() => getManagementPackFacts(range)),
  recordProgress: (input) => wrap(() => recordProjectProgress(input)),
};
```

   add `reports,` after `integrations: integrationsImpl,` in `repositories`, and `ReportsRepository,` to the
   trailing `export type { … }` list.

GREEN: same command as RED, then `cd pmo-portal && npm run typecheck`.

### Task 12 — hooks · supports AC-MMP-013/014

Create `pmo-portal/src/hooks/useManagementPack.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ managementPack: vi.fn(), recordProgress: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { reports: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useManagementPack, useRecordProjectProgress } from './useManagementPack';

const facts = {
  from: '2026-01-01', to: '2026-01-01', timezone: 'UTC', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{ id: 'p1', name: 'Alpha', pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR',
    contract_net: 10, start_date: null, end_date: null, project_manager_id: null, client_name: null }],
  invoiced: [], invoiced_before: [], progress: [],
};

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.managementPack.mockReset().mockResolvedValue(facts);
  h.recordProgress.mockReset().mockResolvedValue(undefined);
});

describe('useManagementPack', () => {
  it('AC-MMP-013 support: returns the BUILT pack for the requested window', async () => {
    const { result } = renderHook(() => useManagementPack({ from: '2026-01-01', to: '2026-01-01' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.managementPack).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-01' });
    expect(result.current.data?.rows[0].contractNet).toBe(1000);
  });

  it('AC-MMP-014 support: recording progress refreshes every cached pack', async () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRecordProjectProgress(), { wrapper });
    await act(() => result.current.mutateAsync({ projectId: 'p1', month: '2026-01-01', pctComplete: 10, note: null }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['managementPack'] });
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useManagementPack.test.tsx'`

Create `pmo-portal/src/hooks/useManagementPack.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { buildManagementPack, type ManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';

/** #765: the management pack for a window (org-scoped cache key; never threads org_id to the server). */
export function useManagementPack(range: ManagementPackRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ManagementPackFacts, Error, ManagementPack>({
    queryKey: ['managementPack', orgId, range.from ?? 'default', range.to ?? 'default'],
    queryFn: () => repositories.reports.managementPack(range),
    select: buildManagementPack,
    enabled: Boolean(orgId),
  });
}

/** #765: record a month-end percent complete; every cached pack window is refreshed on success. */
export function useRecordProjectProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectProgressInput) => repositories.reports.recordProgress(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managementPack'] }),
  });
}
```

GREEN: same command.

### Task 13 — policy entries · AC-MMP-012

Create `pmo-portal/src/auth/policy.managementPack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('AC-MMP-012 management pack policy (mirrors migration 0243)', () => {
  it('AC-MMP-012: the pack is visible to the revenue read set and not to Engineers', () => {
    expect(ROLES.filter((r) => can('view', 'managementPack', { realRole: r })))
      .toEqual(['Admin', 'Executive', 'Project Manager', 'Finance']);
  });

  it('AC-MMP-012: progress is recorded by Finance rank and above anywhere, by a PM only on their own project', () => {
    const own = { currentUserId: 'u-pm', record: { project_manager_id: 'u-pm' } };
    const other = { currentUserId: 'u-pm', record: { project_manager_id: 'u-other' } };
    for (const r of ['Admin', 'Executive', 'Finance'] as Role[]) expect(can('edit', 'projectProgress', { realRole: r, ...other })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', ...own })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', ...other })).toBe(false);
    expect(can('edit', 'projectProgress', { realRole: 'Engineer', currentUserId: 'u-e', record: { project_manager_id: 'u-e' } })).toBe(false);
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/auth/policy.managementPack.test.ts'`

In `pmo-portal/src/auth/policy.ts`: change the last member of the `Entity` union from `| 'pushHold';` to
`| 'pushHold'` followed by `| 'managementPack'` and `| 'projectProgress';`, and add to `POLICY` directly after
the `pushHold` entry:

```ts
  // #765 (DD-MMP-4): the management pack mirrors the revenue READ set (salesInvoice.view). RLS on
  // sales_invoices admits every active member; the FE is stricter, exactly as for the invoice lists.
  managementPack: {
    view: allow(MASTER_DATA),
  },
  // #765 (DD-MMP-4): a project's month-end percent complete. Mirrors migration 0243's
  // `may_record_project_progress`: Finance rank and above on any project, or the project's own PM.
  // UX ONLY — record_project_progress + RLS are the authority (ADR-0016).
  projectProgress: {
    edit: (role, ctx) =>
      has(MONEY_AUTHORITY, role) ||
      (role === 'Project Manager' &&
        !!ctx.currentUserId &&
        ctx.record?.project_manager_id === ctx.currentUserId),
  },
```

GREEN: same command.

### Task 14 — Record progress dialog · AC-MMP-014

Create `pmo-portal/src/components/reports/RecordProgressModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useRecordProjectProgress: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));

import { RecordProgressModal, parsePercentComplete } from './RecordProgressModal';

const onClose = vi.fn();
const renderModal = (deliveryPct: number | null = 42.4) =>
  render(
    <ToastProvider>
      <RecordProgressModal open onClose={onClose} projectId="p1" projectName="Alpha" defaultMonth="2026-09-01" deliveryPct={deliveryPct} />
    </ToastProvider>,
  );

beforeEach(() => { h.mutateAsync.mockReset().mockResolvedValue(undefined); onClose.mockReset(); });

describe('AC-MMP-014 Record progress', () => {
  it('AC-MMP-014: accepts 0–100 with at most two decimals only', () => {
    expect(parsePercentComplete('42.5')).toBe(42.5);
    expect(parsePercentComplete('100')).toBe(100);
    expect(parsePercentComplete('-1')).toBeNull();
    expect(parsePercentComplete('101')).toBeNull();
    expect(parsePercentComplete('33.333')).toBeNull();
  });

  it('AC-MMP-014: pre-fills the as-at month and offers the milestone delivery % as a suggestion', () => {
    renderModal();
    expect(screen.getByLabelText(/^Month/)).toHaveValue('2026-09');
    expect(screen.getByText('Milestone delivery: 42%')).toBeInTheDocument();
  });

  it('AC-MMP-014: refuses an out-of-range percent with the range message and does not save', async () => {
    renderModal(null);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Percent complete to date/), '101');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(await screen.findAllByText('Enter a number from 0 to 100, with at most two decimals.')).not.toHaveLength(0);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-MMP-014: saves the month as YYYY-MM-01 and closes', async () => {
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Percent complete to date/), '45');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-09-01', pctComplete: 45, note: null }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/reports/RecordProgressModal.test.tsx'`

Create `pmo-portal/src/components/reports/RecordProgressModal.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, TextField, useEntityForm, useToast, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { monthInputToIso } from '@/src/lib/reports/months';
import { useRecordProjectProgress } from '@/src/hooks/useManagementPack';

export interface RecordProgressModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** `YYYY-MM-01` — the pack's as-at month. */
  defaultMonth: string;
  /** Milestone-weighted delivery % (get_projects_delivery); a suggestion only, never applied (DD-MMP-1). */
  deliveryPct: number | null;
}

interface Values {
  month: string;
  pct: string;
  note: string;
}

/** 0–100 with at most two decimals, read in the viewer's number locale; null otherwise. */
// eslint-disable-next-line react-refresh/only-export-components -- pure parser co-located with its only form
export function parsePercentComplete(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw.trim(), 2);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

export const RecordProgressModal: React.FC<RecordProgressModalProps> = ({
  open, onClose, projectId, projectName, defaultMonth, deliveryPct,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const record = useRecordProjectProgress();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const pctInvalid = t('managementPack.progressModal.pctInvalid', 'Enter a number from 0 to 100, with at most two decimals.');
  const monthInvalid = t('managementPack.progressModal.monthInvalid', 'Choose a month.');

  const form = useEntityForm<Values>({
    initialValues: { month: defaultMonth.slice(0, 7), pct: '', note: '' },
    idPrefix: 'record-progress',
    requiredFields: ['month', 'pct'],
    validate: (v) => ({
      ...(monthInputToIso(v.month) ? {} : { month: monthInvalid }),
      ...(parsePercentComplete(v.pct) === null ? { pct: pctInvalid } : {}),
    }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const month = monthInputToIso(v.month);
      const pctComplete = parsePercentComplete(v.pct);
      if (month === null || pctComplete === null) return;
      try {
        await record.mutateAsync({ projectId, month, pctComplete, note: v.note.trim() || null });
        toast(t('managementPack.progressModal.saved', 'Progress saved'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError(classifyMutationError(err));
      }
    });
  };

  return (
    <EntityFormModal
      open={open}
      title={t('managementPack.progressModal.title', 'Record progress')}
      subtitle={projectName}
      submitLabel={t('managementPack.progressModal.save', 'Save progress')}
      onSubmit={onSubmit}
      onClose={onClose}
      submitDisabled={!form.isComplete}
      loading={record.isPending}
      dirty={form.isDirty}
      submitError={submitError}
      width="sm"
    >
      <FormGrid>
        <TextField
          label={t('managementPack.progressModal.month', 'Month')}
          type="month"
          required
          {...form.fieldProps('month')}
        />
        <TextField
          label={t('managementPack.progressModal.pct', 'Percent complete to date')}
          inputMode="decimal"
          required
          helper={
            deliveryPct != null
              ? t('managementPack.progressModal.pctHelper', 'Milestone delivery: {{pct}}%', { pct: Math.round(deliveryPct) })
              : undefined
          }
          {...form.fieldProps('pct')}
        />
        <TextField label={t('managementPack.progressModal.note', 'Note')} fullWidth {...form.fieldProps('note')} />
      </FormGrid>
    </EntityFormModal>
  );
};
```

GREEN: same command. (`classifyMutationError` returns `{ headline, detail }`, a `SubmitError`.)

### Task 15 — the page · AC-MMP-012, AC-MMP-013

Create `pmo-portal/pages/__tests__/ManagementPack.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { buildManagementPack } from '@/src/lib/reports/managementPack';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  query: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
  exportTable: vi.fn(),
}));

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => h.query,
  useRecordProjectProgress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportTable: h.exportTable, exportXlsx: vi.fn(), busy: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));

import ManagementPack from '../ManagementPack';

const project = (id: string, name: string, pm: string) => ({
  id, name, pmo_project_number: null, code: null, status: 'Ongoing Project', currency: 'IDR', contract_net: 1_000,
  start_date: null, end_date: null, project_manager_id: pm, client_name: null,
});
const facts: ManagementPackFacts = {
  from: '2026-03-01', to: '2026-04-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [project('p1', 'Alpha', 'u-pm'), project('p2', 'Beta', 'u-other')],
  invoiced: [{ project_id: 'p1', currency: 'IDR', month: '2026-04-01', net: 250, invoice_count: 1 }],
  invoiced_before: [], progress: [],
};

const renderPage = () =>
  render(<MemoryRouter><ToastProvider><ManagementPack /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.userId = 'u-fin';
  h.query = { data: buildManagementPack(facts), isPending: false, isError: false, error: null };
  h.exportTable.mockReset();
});

describe('AC-MMP-012 who sees the pack and who records progress', () => {
  it('AC-MMP-012: an Engineer gets the no-access message', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByRole('heading', { name: "You don't have access to the management pack" })).toBeInTheDocument();
  });

  it('AC-MMP-012: Executive sees the pack; Finance may record progress on every project', () => {
    h.role = 'Executive';
    const { unmount } = renderPage();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    unmount();
    h.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Record progress' })).toHaveLength(2);
  });

  it('AC-MMP-012: a PM may record progress only on the project they manage', () => {
    h.role = 'Project Manager';
    h.userId = 'u-pm';
    renderPage();
    const buttons = screen.getAllByRole('button', { name: 'Record progress' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('tr')).toHaveTextContent('Alpha');
  });
});

describe('AC-MMP-013 honest states', () => {
  it('AC-MMP-013: loading shows no figures', () => {
    h.query = { data: undefined, isPending: true, isError: false, error: null };
    renderPage();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText('No projects to report')).toBeNull();
  });

  it('AC-MMP-013: a failed load shows the error and no figures', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: new Error('boom') };
    renderPage();
    expect(screen.getByText("Couldn't load the management pack")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pack-cell-/)).toHaveLength(0);
    expect(screen.queryByText(/[^\d]0[.,]00\b/)).toBeNull();
  });

  it('AC-MMP-013: a refused window explains the allowed range', () => {
    h.query = { data: undefined, isPending: false, isError: true, error: Object.assign(new Error('w'), { code: '22023' }) };
    renderPage();
    expect(screen.getByText('Choose a start month on or before the as-at month, at most 24 months apart.')).toBeInTheDocument();
  });

  it('AC-MMP-013: no projects shows the empty message', () => {
    h.query = { data: buildManagementPack({ ...facts, projects: [], invoiced: [] }), isPending: false, isError: false, error: null };
    renderPage();
    expect(screen.getByText('No projects to report')).toBeInTheDocument();
  });
});

describe('AC-MMP-011 export wiring', () => {
  it('AC-MMP-011: Export CSV hands the long-format table and the as-at stem to the exporter', async () => {
    renderPage();
    const row = within(screen.getByText('Alpha').closest('tr')!);
    expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveTextContent(/250/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    const [table, stem, format] = h.exportTable.mock.calls[0];
    expect(stem).toBe('Management-pack_2026-04');
    expect(format).toBe('csv');
    expect(table.header).toEqual(expect.arrayContaining(['Currency', 'Tax basis']));
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/ManagementPack.test.tsx'`

Create `pmo-portal/pages/ManagementPack.tsx` (every `t()` key is a literal — the i18n completeness gate treats
computed keys as orphans, see `TaxBasisLabel.tsx`):

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Button, Card, DataTable, Icon, KPITile, ListPage, ListState, StatusPill, TextField, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useExport } from '@/src/components/export/useExport';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { fromCents, type PackMonth, type PackRow, type PackTotalsMonth } from '@/src/lib/reports/managementPack';
import {
  buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels,
} from '@/src/lib/reports/managementPackExport';
import { monthInputToIso } from '@/src/lib/reports/months';
import { formatCurrencyAuto, formatCurrencyCents, formatUtcMonthYear } from '@/src/lib/format';

type Measure = 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'backlog';
type TotalsMeasure = 'planned' | 'recognised' | 'invoiced' | 'unbilled';
type TotalsRow = PackTotalsMonth & { currency: string };

const KPI_MEASURES: Measure[] = ['recognisedToDate', 'invoicedToDate', 'unbilled', 'backlog'];
const TOTALS_MEASURES: TotalsMeasure[] = ['planned', 'recognised', 'invoiced', 'unbilled'];
const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));
const money = (cents: number | null, currency: string) =>
  cents === null ? '—' : formatCurrencyCents(fromCents(cents), currency);

const ManagementPack: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const label: Record<Measure | TotalsMeasure, string> = {
    planned: t('managementPack.col.planned', 'Planned'),
    recognised: t('managementPack.col.recognised', 'Recognised'),
    invoiced: t('managementPack.col.invoiced', 'Invoiced'),
    unbilled: t('managementPack.col.unbilled', 'Unbilled'),
    recognisedToDate: t('managementPack.col.recognisedToDate', 'Recognised to date'),
    invoicedToDate: t('managementPack.col.invoicedToDate', 'Invoiced to date'),
    backlog: t('managementPack.col.backlog', 'Backlog'),
  };
  const range = { from: monthInputToIso(params.get('from') ?? ''), to: monthInputToIso(params.get('to') ?? '') };
  const { data: pack, isPending, isError, error } = useManagementPack(range);
  const { exportTable, busy } = useExport();
  const [progressFor, setProgressFor] = useState<PackRow | null>(null);
  const projectIds = useMemo(
    () => (pack?.rows ?? []).filter((r) => r.kind === 'contract' && r.projectId).map((r) => r.projectId as string),
    [pack],
  );
  const { data: delivery } = useProjectsDelivery(projectIds);

  if (!may('view', 'managementPack')) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">
            {t('managementPack.noAccessTitle', "You don't have access to the management pack")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('managementPack.noAccessSub', 'The management pack is available to Finance, Project Managers, Executives and Admins.')}
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', 'Back to dashboard')}
          </Button>
        </div>
      </div>
    );
  }

  const last = pack ? pack.months.length - 1 : -1;
  const at = (row: PackRow): PackMonth | null => (last >= 0 ? row.months[last] : null);
  const state: 'loading' | 'error' | 'empty' | undefined = isError
    ? 'error'
    : isPending
      ? 'loading'
      : pack && pack.rows.length === 0
        ? 'empty'
        : undefined;
  const invalidRange = (error as { code?: string } | null)?.code === '22023';

  const setMonth = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    if (monthInputToIso(value)) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const exportLabels: ManagementPackExportLabels = {
    month: t('managementPack.col.month', 'Month'),
    projectNumber: t('managementPack.col.projectNumber', 'Project number'),
    project: t('managementPack.col.project', 'Project'),
    client: t('managementPack.col.client', 'Client'),
    currency: t('managementPack.col.currency', 'Currency'),
    taxBasis: t('managementPack.col.taxBasis', 'Tax basis'),
    planned: label.planned,
    recognised: label.recognised,
    invoiced: label.invoiced,
    recognisedToDate: label.recognisedToDate,
    invoicedToDate: label.invoicedToDate,
    unbilled: label.unbilled,
    backlog: label.backlog,
    basis: t('managementPack.col.basis', 'Basis'),
    taxBasisValue: t('tax.basis.exclusive', 'excl. PPN'),
    unassigned: t('managementPack.unassigned', 'Unassigned'),
    total: t('managementPack.total', 'Total'),
    basisInvoiced: t('managementPack.basis.invoiced', 'Invoiced'),
    basisProgress: t('managementPack.basis.progressShort', 'Progress'),
  };
  const onExport = (format: 'csv' | 'xlsx') => {
    if (pack) void exportTable(buildManagementPackExport(pack, exportLabels), managementPackFileStem(pack), format);
  };

  const canRecord = (row: PackRow) =>
    row.kind === 'contract' &&
    !!row.projectId &&
    may('edit', 'projectProgress', { currentUserId: currentUser?.id ?? null, record: { project_manager_id: row.projectManagerId } });

  const measureCell = (key: Measure) => (row: PackRow) => {
    const m = at(row);
    const value = m ? m[key] : null;
    return (
      <span data-testid={`pack-cell-${key}`} className="tabular text-right font-mono text-[13px]">
        {money(value, row.currency)}
        {key === 'unbilled' && value !== null && value < 0 && (
          <span className="ml-1 text-xs text-muted-foreground">{t('managementPack.billedAhead', 'billed ahead')}</span>
        )}
      </span>
    );
  };

  const columns: Column<PackRow>[] = [
    {
      key: 'project',
      header: t('managementPack.col.project', 'Project'),
      cell: (row) =>
        row.kind === 'unassigned' ? (
          <StatusPill variant="neutral">{t('managementPack.unassigned', 'Unassigned')}</StatusPill>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{row.projectName}</span>
            {row.kind === 'otherCurrency' ? (
              <span className="text-xs text-muted-foreground">
                {t('managementPack.otherCurrency', 'Invoiced in {{currency}}, not the contract currency', { currency: row.currency })}
              </span>
            ) : (
              row.projectNumber && <span className="text-xs text-muted-foreground font-mono">{row.projectNumber}</span>
            )}
          </div>
        ),
    },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      cell: (row) => <span className="font-mono text-[13px]">{row.currency}</span>,
    },
    {
      key: 'contract',
      header: t('managementPack.col.contract', 'Contract'),
      align: 'num',
      cell: (row) => (
        <span data-testid="pack-cell-contract" className="tabular text-right font-mono text-[13px]">
          {money(row.contractNet, row.currency)}
        </span>
      ),
    },
    ...KPI_MEASURES.map((k): Column<PackRow> => ({ key: k, header: label[k], align: 'num', cell: measureCell(k) })),
    {
      key: 'basis',
      header: t('managementPack.col.basis', 'Basis'),
      cell: (row) =>
        row.latestProgress
          ? t('managementPack.basis.progress', '{{pct}}% complete', { pct: row.latestProgress.pctComplete })
          : t('managementPack.basis.invoiced', 'Invoiced'),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        canRecord(row) ? (
          <Button variant="outline" onClick={() => setProgressFor(row)}>
            {t('managementPack.recordProgress', 'Record progress')}
          </Button>
        ) : null,
    },
  ];

  const totalsRows: TotalsRow[] = (pack?.totals ?? []).flatMap((tot) =>
    tot.months.map((m) => ({ ...m, currency: tot.currency })),
  );
  const totalsColumns: Column<TotalsRow>[] = [
    { key: 'month', header: t('managementPack.col.month', 'Month'), cell: (r) => monthLabel(r.month) },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      cell: (r) => <span className="font-mono text-[13px]">{r.currency}</span>,
    },
    ...TOTALS_MEASURES.map((k): Column<TotalsRow> => ({
      key: k,
      header: label[k],
      align: 'num',
      cell: (r) => <span className="tabular text-right font-mono text-[13px]">{money(r[k], r.currency)}</span>,
    })),
  ];

  return (
    <ListPage
      title={t('managementPack.title', 'Monthly management pack')}
      description={t('managementPack.description', 'Planned, recognised and invoiced revenue per project and month. All figures exclude tax.')}
      primaryAction={
        <div className="flex gap-2">
          <Button variant="outline" disabled={!pack || busy} onClick={() => onExport('csv')}>
            <Icon name="export" className="size-4 mr-2" />
            {t('managementPack.exportCsv', 'Export CSV')}
          </Button>
          <Button variant="outline" disabled={!pack || busy} onClick={() => onExport('xlsx')}>
            <Icon name="export" className="size-4 mr-2" />
            {t('managementPack.exportXlsx', 'Export XLSX')}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField
          id="pack-from"
          type="month"
          label={t('managementPack.from', 'From')}
          value={params.get('from') ?? pack?.from.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('from', v)}
        />
        <TextField
          id="pack-as-at"
          type="month"
          label={t('managementPack.asAt', 'As at')}
          value={params.get('to') ?? pack?.to.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('to', v)}
        />
      </div>

      {/* Honest KPI states (NFR-MMP-006): skeletons while loading, "—" on error — never a fabricated 0. */}
      {(state === 'loading' || state === 'error') && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {KPI_MEASURES.map((k) => (
            <KPITile key={k} label={label[k]} value="—" icon="dollar" tone="blue"
              loading={state === 'loading'} error={state === 'error'} />
          ))}
        </div>
      )}
      {pack && state === undefined && pack.totals.map((tot) => {
        const m = tot.months[tot.months.length - 1];
        return (
          <div key={tot.currency} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {KPI_MEASURES.map((k) => (
              <KPITile key={k} label={`${label[k]} · ${tot.currency}`}
                value={formatCurrencyAuto(fromCents(m[k]), tot.currency)} icon="dollar" tone="blue" />
            ))}
          </div>
        );
      })}

      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>
      )}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t('managementPack.errorTitle', "Couldn't load the management pack")}
          sub={invalidRange
            ? t('managementPack.invalidRange', 'Choose a start month on or before the as-at month, at most 24 months apart.')
            : t('managementPack.errorSub', 'The request failed. Check your connection and try again.')}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('managementPack.emptyTitle', 'No projects to report')}
          sub={t('managementPack.emptySub', 'Won and ongoing projects, and any project invoiced in this period, appear here.')}
        />
      )}

      {pack && state === undefined && (
        <>
          <h2 className="mb-2 text-[15px] font-semibold">
            {t('managementPack.projectsAsAt', 'Projects as at {{month}}', { month: monthLabel(pack.to) })}
          </h2>
          <Card className="overflow-hidden mb-6">
            <DataTable rows={pack.rows} columns={columns} rowKey={(row) => row.key} />
          </Card>
          <h2 className="mb-2 text-[15px] font-semibold">{t('managementPack.monthlyTotals', 'Monthly totals')}</h2>
          <Card className="overflow-hidden">
            <DataTable rows={totalsRows} columns={totalsColumns} rowKey={(r) => `${r.currency}|${r.month}`} />
          </Card>
          {pack.undatedInvoiceCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('managementPack.undated', '{{count}} invoices have no date and are not counted', { count: pack.undatedInvoiceCount })}
            </p>
          )}
        </>
      )}

      {progressFor && progressFor.projectId && pack && (
        <RecordProgressModal
          open
          onClose={() => setProgressFor(null)}
          projectId={progressFor.projectId}
          projectName={progressFor.projectName ?? ''}
          defaultMonth={pack.to}
          deliveryPct={delivery?.[progressFor.projectId] ?? null}
        />
      )}
    </ListPage>
  );
};

export default ManagementPack;
```

GREEN: same command; then `cd pmo-portal && npx eslint --max-warnings=0 pages/ManagementPack.tsx`.

### Task 16 — route, rail, launch scope · AC-MMP-015

1. In `pmo-portal/App.routes.test.tsx` replace the first `it(...)` (the AC-W2-IA-005 placeholder assertion) with:

```ts
  // Deliberate UX change (#765): /reports is no longer a placeholder — it is the management pack, behind
  // the revenue entitlement (FeatureRoute redirects to the dashboard when the module is off).
  it('AC-MMP-015: /reports resolves to the management pack behind the revenue entitlement', () => {
    const matches = matchRoutes(appRouteConfig, '/reports');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/reports');
    expect(React.isValidElement(route?.element)).toBe(true);
    expect(route?.element).toMatchObject({ props: { feature: 'revenue' } });
  });
```

2. Create `pmo-portal/src/components/shell/__tests__/Rail.managementPack.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
import { Rail } from '../Rail';

let effectiveRole = 'Finance';
let revenue = true;
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: effectiveRole, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { revenue }, isPending: false, isError: false }),
}));

const renderRail = () => render(<MemoryRouter><Rail /></MemoryRouter>);

describe('AC-MMP-015 Management pack in the rail', () => {
  it('AC-MMP-015: Finance sees Management pack linking to /reports when Revenue is on', () => {
    effectiveRole = 'Finance';
    revenue = true;
    renderRail();
    expect(screen.getByRole('link', { name: /Management pack/ })).toHaveAttribute('href', '/reports');
  });

  it('AC-MMP-015: Engineers do not, and nobody does when Revenue is off', () => {
    effectiveRole = 'Engineer';
    revenue = true;
    const { unmount } = renderRail();
    expect(screen.queryByRole('link', { name: /Management pack/ })).toBeNull();
    unmount();
    effectiveRole = 'Finance';
    revenue = false;
    renderRail();
    expect(screen.queryByRole('link', { name: /Management pack/ })).toBeNull();
  });
});
```

   RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell/__tests__/Rail.managementPack.test.tsx'`

3. `pmo-portal/App.tsx`: add `const ManagementPackPage = React.lazy(() => import('./pages/ManagementPack'));` after
   the `RevenueByProjectPage` line, and replace `{ path: '/reports', element: <PlaceholderPage title="Reports" /> },`
   with `{ path: '/reports', element: <FeatureRoute feature="revenue" element={<ManagementPackPage />} /> },`.
4. `pmo-portal/src/components/shell/Rail.tsx`: replace the three comment lines beginning
   `// Reports is demoted from the rail until the module ships` with:

```ts
  // #765: the Reports module's first report — the monthly management pack. Same read set and the same
  // `revenue` entitlement as the other Finance items (it is built from sales invoices).
  { to: '/reports', text: 'Management pack', icon: 'grid', group: 'Finance', feature: 'revenue', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
```

   and add `'/reports': t('shell.nav.managementPack', 'Management pack'),` to `navLabels` after the
   `'/revenue-by-project'` line. (`Rail.reports.test.tsx` stays green unmodified: its features mock has no
   `revenue`, and the label does not match `/Reports/`.)
5. `pmo-portal/src/lib/i18n/launch-scope-routes.txt`: after the `/revenue-by-project` line add
   `/reports                       pages/ManagementPack.tsx src/components/reports/RecordProgressModal.tsx`

GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run App.routes.test.tsx src/components/shell'`

### Task 17 — dashboard "Board pack" opens the pack · AC-MMP-015

Create `pmo-portal/src/components/reports/BoardPackAction.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({ revenue: true, role: 'Executive', track: vi.fn() }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.revenue }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/lib/analytics', () => ({ trackComingSoonClicked: h.track }));

import { BoardPackAction } from './BoardPackAction';

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<BoardPackAction />} />
        <Route path="/reports" element={<p>pack page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('AC-MMP-015 dashboard Board pack', () => {
  it('AC-MMP-015: opens the management pack when it is available', async () => {
    h.revenue = true;
    h.role = 'Executive';
    renderAt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Board pack' }));
    expect(screen.getByText('pack page')).toBeInTheDocument();
  });

  it('AC-MMP-015: stays the disabled coming-soon control when Revenue is off', () => {
    h.revenue = false;
    h.role = 'Executive';
    renderAt();
    expect(screen.getByRole('button', { name: /board pack \(coming soon\)/i })).toBeDisabled();
  });

  it('AC-MMP-015: stays disabled for a role that cannot see the pack', () => {
    h.revenue = true;
    h.role = 'Engineer';
    renderAt();
    expect(screen.getByRole('button', { name: /board pack \(coming soon\)/i })).toBeDisabled();
  });
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/reports/BoardPackAction.test.tsx'`

Create `pmo-portal/src/components/reports/BoardPackAction.tsx` (the unavailable branch is the dashboard's current
markup, moved verbatim):

```tsx
import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { useFeature } from '@/src/auth/useFeature';
import { usePermission } from '@/src/auth/usePermission';
import { trackComingSoonClicked } from '@/src/lib/analytics';

/**
 * #765: the dashboard's "Board pack" control. When the management pack is available (Revenue module on and the
 * viewer may see it) it opens /reports; otherwise it stays the OD-UX-3 disabled "coming soon" affordance.
 */
export const BoardPackAction: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const revenueOn = useFeature('revenue');

  if (revenueOn && may('view', 'managementPack')) {
    return (
      <Button variant="outline" onClick={() => navigate('/reports')}>
        <Icon name="export" />
        {t('dashboard.boardPack.label', 'Board pack')}
      </Button>
    );
  }

  return (
    <Tooltip content={t('dashboard.boardPack.tooltip', 'Board pack export arrives with Reports')}>
      {/* coming_soon_clicked (2026-07-13 wiring plan — demand signal): the Button itself stays genuinely
          disabled; the wrapping span's click still reports intent, since a `disabled` button cannot dispatch one. */}
      <span className="inline-flex" onClick={() => trackComingSoonClicked('board-pack-export', 'dashboard')}>
        <Button variant="outline" disabled aria-label={t('dashboard.boardPack.ariaLabel', 'Board pack (coming soon)')}>
          <Icon name="export" />
          {t('dashboard.boardPack.label', 'Board pack')}
        </Button>
      </span>
    </Tooltip>
  );
};
```

In `pmo-portal/pages/ExecutiveDashboard.tsx`: replace the whole `actions={ … }` value (the comment block and the
`<Tooltip>…</Tooltip>`) with `actions={<BoardPackAction />}` and add
`import { BoardPackAction } from '@/src/components/reports/BoardPackAction';`. Then run
`cd pmo-portal && npx eslint pages/ExecutiveDashboard.tsx`; it reports `Tooltip` and/or `trackComingSoonClicked` as
unused when the moved block was their only use — delete exactly the import lines it names.

In `pmo-portal/pages/ExecutiveDashboard.test.tsx` add, beside the other `vi.mock` calls (the dashboard now resolves
the Revenue entitlement; this file has no QueryClient, and an empty features map keeps Revenue at its `false` env
default so the existing coming-soon test runs unchanged):

```ts
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {}, isLoading: false }) }));
```

GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/reports/BoardPackAction.test.tsx pages/ExecutiveDashboard.test.tsx'`

### Task 18 — catalogues (English + Indonesian) · AC-MMP-017

Create `pmo-portal/src/lib/reports/managementPack.i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (lng: 'en' | 'id') =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/locales/${lng}/common.json`, import.meta.url)), 'utf-8'));
const get = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

const KEYS = [
  'shell.nav.managementPack',
  'managementPack.title', 'managementPack.description', 'managementPack.from', 'managementPack.asAt',
  'managementPack.exportCsv', 'managementPack.exportXlsx', 'managementPack.noAccessTitle', 'managementPack.noAccessSub',
  'managementPack.errorTitle', 'managementPack.errorSub', 'managementPack.invalidRange', 'managementPack.emptyTitle',
  'managementPack.emptySub', 'managementPack.projectsAsAt', 'managementPack.monthlyTotals', 'managementPack.unassigned',
  'managementPack.otherCurrency', 'managementPack.recordProgress', 'managementPack.billedAhead', 'managementPack.undated',
  'managementPack.total', 'managementPack.basis.invoiced', 'managementPack.basis.progress', 'managementPack.basis.progressShort',
  'managementPack.col.month', 'managementPack.col.projectNumber', 'managementPack.col.project', 'managementPack.col.client',
  'managementPack.col.currency', 'managementPack.col.taxBasis', 'managementPack.col.contract', 'managementPack.col.planned',
  'managementPack.col.recognised', 'managementPack.col.invoiced', 'managementPack.col.recognisedToDate',
  'managementPack.col.invoicedToDate', 'managementPack.col.unbilled', 'managementPack.col.backlog', 'managementPack.col.basis',
  'managementPack.progressModal.title', 'managementPack.progressModal.month', 'managementPack.progressModal.monthInvalid',
  'managementPack.progressModal.pct', 'managementPack.progressModal.pctHelper', 'managementPack.progressModal.pctInvalid',
  'managementPack.progressModal.note', 'managementPack.progressModal.save', 'managementPack.progressModal.saved',
];

describe('AC-MMP-017 management pack catalogue', () => {
  for (const lng of ['en', 'id'] as const) {
    it(`AC-MMP-017: every management pack key has non-empty ${lng} copy`, () => {
      const cat = load(lng);
      const missing = KEYS.filter((k) => typeof get(cat, k) !== 'string' || !(get(cat, k) as string).trim());
      expect(missing).toEqual([]);
    });
  }
});
```

RED: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/managementPack.i18n.test.ts'`

Add to `pmo-portal/public/locales/en/common.json`: inside the existing `shell.nav` object
`"managementPack": "Management pack"`; and a new top-level object:

```json
"managementPack": {
  "title": "Monthly management pack",
  "description": "Planned, recognised and invoiced revenue per project and month. All figures exclude tax.",
  "from": "From",
  "asAt": "As at",
  "exportCsv": "Export CSV",
  "exportXlsx": "Export XLSX",
  "noAccessTitle": "You don't have access to the management pack",
  "noAccessSub": "The management pack is available to Finance, Project Managers, Executives and Admins.",
  "errorTitle": "Couldn't load the management pack",
  "errorSub": "The request failed. Check your connection and try again.",
  "invalidRange": "Choose a start month on or before the as-at month, at most 24 months apart.",
  "emptyTitle": "No projects to report",
  "emptySub": "Won and ongoing projects, and any project invoiced in this period, appear here.",
  "projectsAsAt": "Projects as at {{month}}",
  "monthlyTotals": "Monthly totals",
  "unassigned": "Unassigned",
  "otherCurrency": "Invoiced in {{currency}}, not the contract currency",
  "recordProgress": "Record progress",
  "billedAhead": "billed ahead",
  "undated": "{{count}} invoices have no date and are not counted",
  "total": "Total",
  "basis": { "invoiced": "Invoiced", "progress": "{{pct}}% complete", "progressShort": "Progress" },
  "col": {
    "month": "Month", "projectNumber": "Project number", "project": "Project", "client": "Client",
    "currency": "Currency", "taxBasis": "Tax basis", "contract": "Contract", "planned": "Planned",
    "recognised": "Recognised", "invoiced": "Invoiced", "recognisedToDate": "Recognised to date",
    "invoicedToDate": "Invoiced to date", "unbilled": "Unbilled", "backlog": "Backlog", "basis": "Basis"
  },
  "progressModal": {
    "title": "Record progress", "month": "Month", "monthInvalid": "Choose a month.",
    "pct": "Percent complete to date", "pctHelper": "Milestone delivery: {{pct}}%",
    "pctInvalid": "Enter a number from 0 to 100, with at most two decimals.", "note": "Note",
    "save": "Save progress", "saved": "Progress saved"
  }
}
```

Add to `pmo-portal/public/locales/id/common.json`: `shell.nav.managementPack` = `"Laporan manajemen"`; and:

```json
"managementPack": {
  "title": "Laporan manajemen bulanan",
  "description": "Pendapatan rencana, diakui, dan ditagih per proyek dan bulan. Semua angka belum termasuk pajak.",
  "from": "Dari",
  "asAt": "Per",
  "exportCsv": "Ekspor CSV",
  "exportXlsx": "Ekspor XLSX",
  "noAccessTitle": "Anda tidak memiliki akses ke laporan manajemen",
  "noAccessSub": "Laporan manajemen tersedia untuk Finance, Project Manager, Executive, dan Admin.",
  "errorTitle": "Laporan manajemen gagal dimuat",
  "errorSub": "Permintaan gagal. Periksa koneksi Anda lalu coba lagi.",
  "invalidRange": "Pilih bulan awal pada atau sebelum bulan laporan, paling jauh 24 bulan.",
  "emptyTitle": "Tidak ada proyek untuk dilaporkan",
  "emptySub": "Proyek yang dimenangkan dan berjalan, serta proyek yang ditagih pada periode ini, tampil di sini.",
  "projectsAsAt": "Proyek per {{month}}",
  "monthlyTotals": "Total bulanan",
  "unassigned": "Tanpa proyek",
  "otherCurrency": "Ditagih dalam {{currency}}, bukan mata uang kontrak",
  "recordProgress": "Catat progres",
  "billedAhead": "ditagih di muka",
  "undated": "{{count}} faktur tanpa tanggal tidak dihitung",
  "total": "Total",
  "basis": { "invoiced": "Ditagih", "progress": "{{pct}}% selesai", "progressShort": "Progres" },
  "col": {
    "month": "Bulan", "projectNumber": "Nomor proyek", "project": "Proyek", "client": "Klien",
    "currency": "Mata uang", "taxBasis": "Dasar pajak", "contract": "Kontrak", "planned": "Rencana",
    "recognised": "Diakui", "invoiced": "Ditagih", "recognisedToDate": "Diakui s.d. saat ini",
    "invoicedToDate": "Ditagih s.d. saat ini", "unbilled": "Belum ditagih", "backlog": "Backlog", "basis": "Dasar"
  },
  "progressModal": {
    "title": "Catat progres", "month": "Bulan", "monthInvalid": "Pilih bulan.",
    "pct": "Persen selesai s.d. saat ini", "pctHelper": "Progres milestone: {{pct}}%",
    "pctInvalid": "Masukkan angka 0 sampai 100, maksimal dua desimal.", "note": "Catatan",
    "save": "Simpan progres", "saved": "Progres disimpan"
  }
}
```

GREEN: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/reports/managementPack.i18n.test.ts' && cd pmo-portal && npm run check:i18n`

### Task 19 — the journey (e2e) · AC-MMP-016

Create `pmo-portal/e2e/AC-MMP-016-management-pack.spec.ts`:

```ts
// @e2e-isolation: self-isolated — creates its own uniquely named project + invoice (+ progress entry) and deletes them; the revenue entitlement is granted by rewriting this page's org_features read, never by mutating the org.
/**
 * AC-MMP-016 — Finance runs the monthly management pack: opens it from the rail, picks this month, sees the
 * project's invoiced figure, records 50% progress, sees recognised and unbilled move, and exports a CSV that
 * labels the currency. Goal oracle: the pack's figures and the exported row, not the presence of controls.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { signIn, requireServiceRoleKey } from './helpers';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-MMP-016: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-MMP-016: Finance records progress and exports the monthly management pack', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const now = new Date();
  const year = now.getUTCFullYear();
  const ym = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const projectId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const name = `MMP e2e ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: org, error: orgErr } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  if (orgErr || !org) throw new Error(`org read failed: ${orgErr?.message}`);
  const { error: pErr } = await admin.from('projects').insert({
    id: projectId, org_id: ORG_ID, name, status: 'Ongoing Project', contract_value: 1_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, start_date: `${year}-01-01`, end_date: `${year}-12-31`,
  });
  if (pErr) throw new Error(`seed project failed: ${pErr.message}`);
  const { error: iErr } = await admin.from('sales_invoices').insert({
    id: invoiceId, org_id: ORG_ID, project_id: projectId, amount: 250_000, tax_treatment: 'exclusive',
    tax_amount: 0, status: 'Unpaid', invoice_date: `${ym}-15`,
  });
  if (iErr) throw new Error(`seed invoice failed: ${iErr.message}`);

  try {
    await page.route('**/rest/v1/org_features*', async (route) => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const rows = (await response.json()) as Array<{ feature_key?: string; enabled?: boolean }>;
      await route.fulfill({
        response,
        json: [...rows.filter((r) => r.feature_key !== 'revenue'), { feature_key: 'revenue', enabled: true }],
      });
    });
    await signIn(page, 'finance@acme.test');

    await page.getByRole('link', { name: 'Management pack' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await page.getByLabel('As at').fill(ym);

    const row = page.locator('tr', { hasText: name });
    await expect(row.getByTestId('pack-cell-invoicedToDate')).toHaveText(/250[.,]000/);

    await row.getByRole('button', { name: 'Record progress' }).click();
    await page.getByLabel(/Percent complete to date/).fill('50');
    await page.getByRole('button', { name: 'Save progress' }).click();

    await expect(row.getByTestId('pack-cell-recognisedToDate')).toHaveText(/500[.,]000/);
    await expect(row.getByTestId('pack-cell-unbilled')).toHaveText(/250[.,]000/);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csv = readFileSync(await download.path(), 'utf-8');
    const line = csv.split('\r\n').find((l) => l.startsWith(ym) && l.includes(name));
    expect(line, "the exported pack has this project's as-at month row").toBeDefined();
    expect(line).toContain(`,${org.default_currency},`);
    expect(line).toContain(',500000,');
  } finally {
    await admin.from('project_progress_entries').delete().eq('project_id', projectId);
    await admin.from('sales_invoices').delete().eq('id', invoiceId);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
```

Verify: `scripts/with-db-lock.sh scripts/e2e-local.sh AC-MMP-016` (needs Tasks 1–18 on a reset DB). Expect 1 passed.
Mutation check (required, then revert): in `buildRow` make `recognisedToDateAt` always return
`{ value: invoicedToDate, basis: 'invoiced' }` — the spec MUST fail at the `500[.,]000` recognised-to-date assertion.

### Task 20 — local final gate

1. `cd pmo-portal && npm run typecheck`
2. `cd pmo-portal && npx eslint --max-warnings=0 pages/ManagementPack.tsx pages/ExecutiveDashboard.tsx App.tsx src/components/reports src/components/export/useExport.ts src/components/shell/Rail.tsx src/lib/reports src/lib/export src/lib/db/managementPack.ts src/hooks/useManagementPack.ts src/auth/policy.ts src/lib/repositories`
3. `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'`
4. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0243_management_pack.test.sql supabase/tests/0005_force_rls.test.sql'`
5. `scripts/with-db-lock.sh scripts/e2e-local.sh AC-MMP-016`
6. `cd pmo-portal && npm run check:i18n`

All green before the PR to `dev`. CI's `pgtap` job is the full catalog proof (role-grant, definer and RLS
sweeps); if one flags the new table, fix the migration, never the gate.

## 3. Review notes for the battery

- **Security:** two SECURITY INVOKER RPCs, no definer; new table FORCE RLS + `is_active_member()` + 0074 stamp
  trigger + column grants (witness columns withheld) + no delete. Mutation checks in Tasks 2, 7 and 19 are required.
- **Discover (rendered):** render `/reports` on rich seed with Revenue enabled; check the KPI band per currency, the
  "billed ahead" hint on a negative unbilled, the other-currency and Unassigned rows, the Indonesian locale, and
  390 px width. Graduate findings per `docs/qa-portfolio.md`.
- **Not in this slice:** OBS-MMP-002 (Revenue by Project sums gross and across currencies) — file separately.
