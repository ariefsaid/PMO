# Spec: Server-side paging for list screens (#843, map #791)

> **Status:** DRAFT r1 (2026-11-15) — for owner sign-off. Docs only; nothing built.
> **Source:** `docs/reviews/2026-10-06-product-expectations-audit.md` R7 ("before scale"; trigger: any
> list >2k rows or >1 MB payload). **Not a go-live blocker.**
> **First slice shipped:** the notification inbox, #868 (`docs/plans/2026-10-06-notification-paging.md`,
> AC-843-001..006). This spec covers the **remaining** list screens.
>
> **ID prefix:** `FR-PAGE-###` / `NFR-PAGE-###` / `AC-PAGE-###`. Deliberately distinct from the
> shipped `AC-843-001..006`, which stay where they are and are not re-specified here.
>
> **Grounding correction (read before planning).** The ticket and R7 say "adopt `src/lib/pagination.ts`".
> **That file is not on `dev`.** It was added in #226 (commit `fe2e211c1`, an opt-in `page`/`pageSize` →
> `.range()` helper) on a line that never reached `dev` (`git merge-base --is-ancestor fe2e211c1 origin/dev`
> is false). What `dev` actually has:
> - `pmo-portal/src/lib/pagedRead.ts` — `fetchAllPages` (OFFSET) and `fetchAllRowsByKeyset` (KEYSET).
>   These are **completeness loops**: they read *every* row past PostgREST's silent 1,000-row cap.
>   They fix truncation; they do **not** page a screen. Money sums must keep using them.
> - Per-screen page reads that grew up independently: keyset (`notifications.ts`, `stockDocuments.ts`,
>   the `get_stock_ledger` RPC), offset + exact count (`companies.ts`, `contacts.ts`, `incidents.ts`,
>   `adminUsers.ts`, `equipment.ts`, `repositories/odoo.ts`), offset + sentinel row (`meetings.ts`).
>
> So the job is not "adopt a helper"; it is **pick one list-page contract, extract it from the
> notification slice, and move the remaining read-all screens onto it**.

---

## 0. Job story

> **When I open a list screen in an organization that has years of records, I want the first page to
> appear quickly and the filters, search, sort and count to cover every record — so I can find any
> record without the browser downloading the whole table, and without a count or a search that
> silently stops at the rows it happened to load.**

---

## 1. Scope

### In scope
1. One shared list-page contract for the DAL/repository layer (§3), extracted from
   `listNotificationsPage` (`pmo-portal/src/lib/db/notifications.ts:45`), with a typed cursor, a
   sentinel `pageSize + 1` read, an explicit column list, and an optional exact count.
2. Moving each **read-all** list screen in §2 onto that contract: page server-side, filter server-side,
   search server-side, sort server-side on an allow-listed set of keys with an `id` tie-break.
3. Replacing `select('*')` on list reads with explicit list-column constants (pattern:
   `NOTIFICATION_LIST_COLUMNS`, `COMPANY_LIST_COLUMNS`, `USER_DIRECTORY_COLUMNS`).
4. Making the shared "Showing {{count}} of {{total}}" line (`src/components/ui/ListPage.tsx:124,134`,
   `src/components/ui/DataTable.tsx:531`, `src/components/ui/FilterBar.tsx:70`) read the **server**
   total for the active filters, not `rows.length` of what was loaded.
5. Keeping the two **capped** screens (Expense claims, Imprest floats) on real paging — **shipped after this
   draft**, see §2.2.

### Re-check at `origin/dev` `f610e9f2d3` (2026-11-19)

The inventory below is pinned to `f5740e7e9`; re-read before planning. Since then the "capped screens"
slice landed: `89df3ac79d`, `7c8ced69dd` and `466f0b097a` (#843) replaced both 200-row dead ends with real
paging, replaced Imprest floats' `select('*')` with a list-column constant, and added **numbered pages** to
the shared `DataTable` (`pagination` prop) — Expenses and Site cash use those, not "Load more". So §2.2 is
now empty (12 paged, 0 capped, 11 read-all), `select('*')` remains on 4 list reads, and FR-PAGE-030 /
AC-PAGE-024 record shipped work rather than new work. Everything else in §2 still holds on a spot re-read
(Contacts, Incidents and Equipment assets still select `*`; Timesheets, Procurement, Sales invoices,
Incoming payments, My tasks, Projects, Calendar and My views still read every row).
6. Re-pointing the ⌘K CommandPalette record search, which today depends on full cached lists
   (`procurements.ts:181-182`), at a server-side search, so screens can stop reading everything.

### Out of scope (explicit)
- **Money totals and KPIs.** Anything that sums or counts money stays a complete read
  (`fetchAllRowsByKeyset`) or moves to a SQL aggregate. Paging a list never changes a figure.
- Detail-page sub-lists (project tabs, line items, attachments) — bounded by their parent record.
- External-ledger reads (Payables, ERP purchases/orphans, Odoo statements): their size is set by the
  connected ledger and they have their own sync/snapshot model. Revisit separately if a trigger fires.
- List virtualization (R7 note: unnecessary once lists page).
- RLS, grants, tenancy: **unchanged**. No policy, no `org_id` handling moves.
- Dashboards and the Management pack (aggregates, not lists).
- The notification inbox (shipped, #868).

---

## 2. Inventory (dev at `f5740e7e9`, 2026-11-15)

Scope of the sweep: route-level list screens under `pmo-portal/pages/**` that render `ListPage` or a
top-level `DataTable`, traced through their hook (`src/hooks/*`) and repository (`src/lib/repositories/*`)
to the DAL read (`src/lib/db/*`). Detail-page sub-lists and dashboard widgets were not counted.
"Client filter/sort" cites the first `.filter(`/sort site in the page file; it is a pointer, not a
complete audit.

### 2.1 Already paged server-side (12; 10 at the `f5740e7e9` pin, +2 since)

| Screen | Query (file:line) | Mechanism | `select('*')` |
|---|---|---|---|
| Notification inbox (bell) | `src/lib/db/notifications.ts:45` | keyset `(created_at,id)`, sentinel | no |
| Companies | `src/lib/db/companies.ts:75` | offset + exact count, `ilike` search | no |
| Contacts | `src/lib/db/contacts.ts:58` | offset + exact count | **yes** |
| Incidents | `src/lib/db/incidents.ts:85` | offset + exact count | **yes** |
| Meetings | `src/lib/db/meetings.ts:224` | offset + sentinel; separate count | no |
| Admin users | `src/lib/db/adminUsers.ts:103` | offset + exact count | no |
| Equipment assets | `src/lib/db/equipment.ts:76` | offset (200) + `countAssets` | **yes** |
| Stock documents | `src/lib/db/stockDocuments.ts:80` | keyset `(created_at,id)` + count | no |
| Stock ledger | `src/lib/db/stockReports.ts:66` | RPC `get_stock_ledger`, `before_seq` cursor | no (RPC) |
| Master data (Odoo mirror) | `src/lib/repositories/odoo.ts:65` | offset + exact count | no |
| Expense claims | `src/lib/db/expenseClaims.ts:135` | numbered pages, 50 per read + sentinel + exact count (`EXPENSE_PAGE_SIZE` `:88`); DataTable `pagination` (`pages/ExpenseClaims.tsx:187`) | no |
| Imprest floats | `src/lib/db/imprest.ts:39` | numbered pages, 50 per read + sentinel + exact count (`listFloats(page)`, `countFloats`); DataTable `pagination` (`pages/ImprestFloats.tsx:179`) | no (`FLOAT_LIST_COLUMNS`) |

### 2.2 Capped at first-N with a truncation notice (0)

Empty since `89df3ac79d` / `7c8ced69dd` / `466f0b097a` (#843): both former dead ends (Expense claims,
Imprest floats) now page every record, so older records are reachable and the "latest 200" notices are
gone. The non-paged newest-200 read that remains (`EXPENSE_LIST_LIMIT`, `expenseClaims.ts:86`) feeds the
inbox, Engineer home and New-claim screens, not a list screen — it is out of this spec's scope.

### 2.3 Read every row into the browser (11)

| Screen | Query (file:line) | Read | Client filter / sort | `select('*')` |
|---|---|---|---|---|
| Timesheets | `src/lib/db/timesheets.ts:28` | keyset all (own rows; optional `fromWeek`) | sorts in DAL `:43` | **yes** (`'*, entries:timesheet_entries(*…'`, `:20`) |
| Procurement | `src/lib/db/procurements.ts:184` | keyset all | `pages/Procurement.tsx:220` / `:127`; "All" tab `:86` | no (named selections) |
| Approvals | `procurements.ts:184` (`status=Requested`) + `listReopenableApprovedTimesheets` | keyset all | `pages/Approvals.tsx:141` / `:88` | no |
| Sales invoices | `src/lib/db/revenue.ts:214` | `fetchAllPages` | `pages/SalesInvoices.tsx:332` / `:368` | no |
| Incoming payments | `src/lib/db/revenue.ts:400` | `fetchAllPages` (+ allocations `:410`) | `pages/IncomingPayments.tsx:174` | no |
| My tasks | `src/lib/db/tasks.ts:456` | `fetchAllPages` | `pages/MyTasks.tsx:175` / `:191` | no |
| Projects | `src/lib/db/projects.ts:212` | `fetchAllPages` | `pages/projects/useProjectListModel.ts:63` (at-risk, PM, customer, search) | no |
| Calendar (tasks) | `src/lib/db/tasks.ts:170` | `fetchAllPages` (date-windowed) | — | no |
| My views | `src/lib/db/userViews.ts:45` | keyset all | — | no |
| Stock setup / reorder / on-hand | `useStockItems`, `useStockOnHand` (`src/hooks/useStock.ts:64`) | master lists | `pages/stock/StockSetup.tsx:85`, `StockOnHand.tsx:64` | not verified |
| Equipment usage | `useEquipmentUsage` (`src/hooks/useEquipment.ts:50`) | week-windowed | `pages/equipment/EquipmentUsage.tsx:110` | not verified |

**Totals:** 23 route-level list screens; **12** paged server-side; **0** capped; **11** read-all.
`select('*')` on a list read remains on **4** screens (Contacts, Incidents, Equipment assets, Timesheets). Repo-wide, `grep "select('\*'" src/lib/db/*.ts src/lib/repositories/*.ts`
(excluding `head: true` counts and tests) finds **62** call sites; most are single-row detail or
write-return reads and are **not** in scope.

### 2.4 Ranked by expected row growth (highest first)

| Rank | Screen | Why it grows | Already bounded? |
|---|---|---|---|
| 1 | Timesheets (+ approvals queue) | users × 52 weeks × years, **with every entry embedded** — the largest bytes per row | own-user only; `fromWeek` optional |
| 2 | Procurement (+ Approvals) | every purchase request, forever; heavy embedded refs | no |
| 3 | Sales invoices | every invoice, forever | no |
| 4 | Incoming payments | ≥1 per invoice, plus allocations | no |
| 5 | My tasks | per assignee, accumulates done tasks | assignee only |
| 6 | Expense claims | per employee per trip | capped 200 (dead end) |
| 7 | Projects | tens to low thousands; client-derived at-risk signal | no |
| 8 | Imprest floats | per site/custodian, slow | capped 200 (dead end) |
| 9 | My views, Stock master, Calendar, Equipment usage | small or date-windowed | mostly |

---

## 3. The list-page contract (what every migrated screen uses)

`ListPage<T, C>` = `{ rows: T[]; nextCursor: C | null; total?: number; totalExact: boolean }`, read by
`listXPage({ filters, search, sort, cursor, pageSize })`. Built from the shipped notification slice, not
from the never-merged `pagination.ts`. The plan decides file placement; the ADR question is §9 Q1.

- **Keyset** by default: order `(<sort key> <dir>, id <dir>)`, cursor = the last row's `(sortValue, id)`,
  `or(sort.lt.v, and(sort.eq.v, id.lt.id))` — the `notifications.ts` shape, so a concurrent insert never
  duplicates or skips a row while paging.
- **Sentinel** `pageSize + 1` decides `nextCursor` without a count.
- **Count** is a separate `count: 'exact', head: true` over the *same* filters, run once per filter
  change, never per page (the `countStockDocuments` shape). Where an exact count is too slow, `planned`
  with `totalExact: false`, shown as "Showing 50 of about 12,000".
- **Sort keys are an allow-list per screen**, each backed by an index; unknown keys are rejected.

---

## 4. Functional requirements (EARS)

**Contract**
- **FR-PAGE-001** — The list DAL shall expose, per migrated screen, a page read that returns at most
  `pageSize` rows plus a `nextCursor` that is `null` exactly when no further row matches.
- **FR-PAGE-002** — The page read shall order by the requested sort key and then by `id`, so the order is
  total and stable across pages.
- **FR-PAGE-003** — When a cursor is supplied, the page read shall return only rows strictly after that
  cursor in the active order.
- **FR-PAGE-004** — The page read shall select an explicit list-column constant and shall not use
  `select('*')`, directly or inside an embed.
- **FR-PAGE-005** — The page read shall never send or select `org_id` or an owner id that RLS already
  scopes (unchanged tenancy seam, ADR-0016/0017).
- **FR-PAGE-006** — If a sort key outside the screen's allow-list is requested, then the DAL shall reject
  it with an `AppError` and issue no query.

**Filters, search, sort, count**
- **FR-PAGE-010** — When the user changes a filter, search term or sort, the screen shall request a fresh
  first page with those parameters applied server-side and discard loaded pages.
- **FR-PAGE-011** — The screen shall not filter, search or sort loaded rows in the browser for any
  criterion the toolbar offers.
- **FR-PAGE-012** — The "Showing {{count}} of {{total}}" line shall take `total` from the server count
  for the active filters, not from the number of rows loaded.
- **FR-PAGE-013** — Where the count is not exact, the line shall say so ("about") rather than present an
  estimate as exact.
- **FR-PAGE-014** — Where a screen shows per-status tab or chip counts, those counts shall come from a
  server aggregate over the full filtered set.
- **FR-PAGE-015** — While a filter, search or sort is reflected in the URL (#2078), a reload shall
  reproduce the same first page.

**Loading more**
- **FR-PAGE-020** — While `nextCursor` is non-null, the screen shall offer a "Load more" control; when it
  is null, the control shall not render.
- **FR-PAGE-021** — When the user activates "Load more", the screen shall append the next page and keep
  focus and scroll position on the list.
- **FR-PAGE-022** — If a page read fails, then the screen shall keep the rows already loaded and show a
  retryable error for the failed page, never an empty list.

**Capped screens**
- **FR-PAGE-030** — Expense claims and Imprest floats shall reach every matching record through paging;
  the "Showing the latest 200" notices shall be removed. **SHIPPED** (`89df3ac79d`, `7c8ced69dd`,
  `466f0b097a`); kept here as the contract later screens align to.

**Dependants of full lists**
- **FR-PAGE-040** — The ⌘K CommandPalette record search shall query the server for matches and shall
  not depend on a full cached list of any migrated entity.
- **FR-PAGE-041** — Where a migrated screen derived a figure from the full list (e.g. Projects "at risk",
  Procurement tab counts), that figure shall come from a server read over the full set, so paging never
  changes a number.
- **FR-PAGE-042** — Money sums and "already stored?" guards shall keep using the complete keyset loop
  (`fetchAllRowsByKeyset`); this spec shall not convert them to page reads.

**Already-paged screens (alignment only)**
- **FR-PAGE-050** — Contacts, Incidents and Equipment assets shall replace `select('*')` on their list
  reads with list-column constants; their paging mechanism may stay as it is.

---

## 5. Non-functional requirements

- **NFR-PAGE-001 (trigger)** — A screen is migrated before any org's list read for it exceeds **2,000
  rows or 1 MB** of response payload (R7). Measured with the response size and row count of the screen's
  first load on the largest seeded org; the plan adds a rich-seed fixture past the trigger.
- **NFR-PAGE-002 (page size)** — Default `pageSize` 50 (notifications keep 20); maximum 100, clamped in
  the DAL (the `stockDocuments.ts:87` shape).
- **NFR-PAGE-003 (response time)** — A first page, and each further page, returns in ≤ **300 ms** p95
  server time at 100k rows in the table; the count returns in ≤ 500 ms p95 or falls back to an estimate
  (FR-PAGE-013).
- **NFR-PAGE-004 (payload)** — A first page response is ≤ **100 KB** for 50 rows.
- **NFR-PAGE-005 (indexes)** — Every allow-listed sort key has a composite index ending in `id` that
  matches the RLS predicate's leading column (the `notifications_owner_created_idx` pattern); `EXPLAIN`
  shows an index scan, no sort node, for the default order.
- **NFR-PAGE-006 (RLS unchanged)** — No policy, grant or `org_id` default changes. The page read returns
  exactly the rows the read-all read returned for the same caller and filters, in a defined order.
- **NFR-PAGE-007 (honesty)** — No figure, count or search result changes because of paging.
- **NFR-PAGE-008 (reversibility)** — Migrations add indexes or read-only RPCs only, each with a down path.

---

## 6. Acceptance criteria (Given/When/Then, one owning layer each — ADR-0010)

**Contract (unit, Vitest against the mocked Supabase builder)**
- **AC-PAGE-001** — *Given* a migrated page read, *when* it runs with no cursor, *then* it requests
  `pageSize + 1` rows ordered by the sort key then `id`, with an explicit column list and no `org_id`.
  **Owner:** unit, `src/lib/db/<entity>.test.ts`.
- **AC-PAGE-002** — *Given* `pageSize + 1` rows come back, *when* the read returns, *then* it yields
  `pageSize` rows and a `nextCursor` from the last returned row; *given* ≤ `pageSize`, `nextCursor` is
  `null`. **Owner:** unit.
- **AC-PAGE-003** — *Given* a cursor, *when* the read runs, *then* it adds the keyset `or` filter on
  `(sort key, id)`. **Owner:** unit.
- **AC-PAGE-004** — *Given* an unknown sort key, *when* the read is called, *then* it throws and no
  request is sent. **Owner:** unit.
- **AC-PAGE-005** — *Given* any migrated list read, *when* the guard runs, *then* none of its selections
  contains `*`. **Owner:** unit (a guard test over the list-column constants, wired into
  `npm run check:guards` by the plan).

**Server behaviour (pgTAP)**
- **AC-PAGE-010** — *Given* two orgs and three roles with seeded rows, *when* each caller pages through a
  migrated table to the end, *then* the union of pages equals the caller's read-all result, with no
  duplicate and no foreign-org row. **Owner:** pgTAP, one file per migrated table.
- **AC-PAGE-011** — *Given* 100k seeded rows, *when* the default-order first page is explained, *then*
  the plan uses the composite index and has no sort node. **Owner:** pgTAP (`EXPLAIN` assertion).
- **AC-PAGE-012** — *Given* a row inserted between two page reads, *when* the second page is read with
  the first page's cursor, *then* no row from the first page repeats. **Owner:** pgTAP.

**Screen behaviour (unit, RTL)**
- **AC-PAGE-020** — *Given* a migrated screen with more rows than one page, *when* it opens, *then* it
  shows one page, "Showing 50 of {{server total}}", and "Load more". **Owner:** unit, page test.
- **AC-PAGE-021** — *Given* the user activates "Load more", *when* the next page arrives, *then* rows are
  appended, the count line is unchanged, and the control disappears on the last page. **Owner:** unit.
- **AC-PAGE-022** — *Given* the user changes a filter, search or sort, *when* the screen re-reads,
  *then* the request carries those parameters and no browser-side filter or sort is applied to rows.
  **Owner:** unit.
- **AC-PAGE-023** — *Given* the second page fails, *when* the error returns, *then* page one stays
  visible with a retry for page two. **Owner:** unit.
- **AC-PAGE-024** — *Given* Expense claims (or Imprest floats) with 250 matching records, *when* the user
  pages forward, *then* record 250 is reachable and the "latest 200" notice is absent. **Owner:** unit.
  **SHIPPED** (`89df3ac79d` + `466f0b097a`; owned by `expenseClaims.test.ts` / the Imprest page tests).
- **AC-PAGE-025** — *Given* Projects with an at-risk project beyond the first page, *when* the at-risk
  filter is applied, *then* that project appears and the at-risk count matches the server figure.
  **Owner:** unit (hook + page with mocked repository).

**Cross-stack journeys (e2e, Playwright, one each)**
- **AC-PAGE-030** — *Given* rich seed past the trigger for Procurement, *when* a buyer searches for a
  request that is not on the first page, *then* it is found and opens. **Owner:** e2e,
  `e2e/AC-PAGE-030-procurement-search-beyond-page.spec.ts`.
- **AC-PAGE-031** — *Given* the same seed, *when* a user finds that request through ⌘K, *then* it opens.
  **Owner:** e2e, `e2e/AC-PAGE-031-command-palette-server-search.spec.ts`.

### Traceability

| AC | Layer | Proves |
|---|---|---|
| AC-PAGE-001..005 | unit | FR-PAGE-001..006, 050 |
| AC-PAGE-010..012 | pgTAP | NFR-PAGE-005, 006; FR-PAGE-003 |
| AC-PAGE-020..025 | unit (RTL) | FR-PAGE-010..014, 020..022, 030, 041 |
| AC-PAGE-030..031 | e2e | FR-PAGE-011, 040 |

---

## 7. Rollout order (one PR per screen, after the contract PR)

1. **Contract + guard** — extract the page contract from `notifications.ts`; the no-`*` guard
   (AC-PAGE-001..005). Re-point notifications at it with no behaviour change (AC-843-* stay green).
2. **Timesheets** — highest bytes per row; drop `entries(*)` for a list-column embed; page by
   `week_start_date desc, id`.
3. **Procurement + Approvals queue** — needs FR-PAGE-040 (⌘K server search) and server tab counts
   (FR-PAGE-014) in the same slice; ships with AC-PAGE-030/031.
4. **Sales invoices** — server filter/sort; keep overdue and monthly facts on their complete reads.
5. **Incoming payments** — page payments; allocations read per visible page only.
6. **Expense claims, Imprest floats** — **done** (`89df3ac79d`, `7c8ced69dd`, `466f0b097a`): 50-row numbered
   pages with an exact count; they also settled Q3 for the shared `DataTable`.
7. **My tasks**.
8. **Projects** — last of the big ones: needs the at-risk signal server-side (FR-PAGE-041).
9. **Alignment** — `select('*')` out of Contacts, Incidents, Equipment assets list reads (FR-PAGE-050).
10. Small or windowed lists (My views, Stock master, Calendar, Equipment usage) — only if NFR-PAGE-001
    fires.

Each screen PR touches `src/lib/db/*`, `src/lib/repositories/*` and maybe an index migration — none
touches money, SoD or auth, so they batch per the PR rule (3–5 per PR to `dev`), except a slice that
changes a money figure's source (FR-PAGE-041 on Projects), which ships alone.

---

## 8. Risks

- **A figure moves when a list pages.** Mitigated by FR-PAGE-041/042 and NFR-PAGE-007: aggregates come
  from the server over the full set; money stays on complete reads.
- **⌘K stops finding records** once Procurement stops caching the full list. FR-PAGE-040 ships in the
  same slice as Procurement, not after it.
- **Exact counts get slow** at scale under RLS. FR-PAGE-013 allows an honest estimate.
- **Two paging shapes stay in the codebase** (offset on the 2.1 screens, keyset on new ones). Accepted
  for already-paged screens; see Q2.

---

## 9. Owner questions

1. **ADR?** The contract is cross-cutting (every list screen). Recommend a short ADR naming keyset +
   sentinel + separate count as the house list-page shape. Yes / no?
2. **Converge the offset screens?** Companies, Contacts, Incidents, Meetings, Admin users, Equipment and
   Master data page by offset today. Recommend leaving them (offset is fine below the trigger) and only
   removing `select('*')`. Or migrate them to keyset too?
3. **Load more vs. numbered pages.** **Partly answered since this draft:** `466f0b097a` gave the shared
   `DataTable` numbered pages and Expense claims + Site cash use them; the notification inbox and Meetings
   still page "load more". Recommend numbered pages wherever the `DataTable` already owns the footer and
   "Load more" only for a feed, then delete this question. Master data's `page`/`pageSize` input
   (`repositories/odoo.ts:65`) — keep those, or unify?
4. **Estimated counts.** Is "Showing 50 of about 12,000" acceptable when an exact count is slow, or must
   every total be exact (slower, or capped as "10,000+")?
5. **Timesheets default window.** Should the Timesheets list default to the last 12 weeks with "Load
   older", or page through all history from the newest week?
6. **CSV export.** Where a screen's `ExportButton` exports the rows it holds (not verified per screen
   in this sweep), paging would shrink the export to the loaded pages. Should export
   be a server-side full export (recommended) or export only the loaded pages?
7. **Rollout order.** Confirm Timesheets → Procurement/Approvals → Sales invoices → Incoming payments →
   Expense claims/Imprest, or reorder by what a real client is about to load.
