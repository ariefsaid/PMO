# Spec: Stock at risk against site cover (#2694)

> **Status:** Agreed form — the ticket body is the scope of record (map #2516, live 15 Dec 2026, OD-SCOPE-12).
> **Binding:** ADR-0017 (repository seam), ADR-0016 (`can()` is UX only; the RPC is the authority), ADR-0070 (role rank,
> never role lists), ADR-0010 (test pyramid), OD-SCOPE-2 (no client process in code — every figure is a setting or data).
> **Ids:** `FR-SAR-###`, `NFR-SAR-###`, `AC-SAR-###`.
> **Migrations:** 1440–1441 used of the assigned 1440–1443; both reversible (`supabase/migrations/rollback/`).
> **Prior art reused:** `stock_balances.value_on_hand` (moving average, 0413), the cost gate `stock_can_see_cost()`
> and the omit-money-keys-below-rank-20 read shape (0415 `get_stock_on_hand`), the reorder slice's
> per-location recorded level + read RPC pattern (0418), the stock page furniture (`ListPage` + `StockTabs` +
> `DataTable` with phone cards, `StockOnHand.tsx`).

## 1. Job story

When stock sits on site, I want to see its value against the protection recorded for each location,
so I know what is exposed.

**What ships:** a report of stock value held per location against a cover value recorded on the location.
**The setting the client controls:** the cover field per location (blank = not recorded). Nothing else is configurable;
no client process, name or figure is coded.

## 2. Domain terms

- **Site cover** — the protection value an organisation records on a stock location (`stock_warehouses.cover_value`).
  It is a plain recorded figure: PMO never computes, insures or enforces it. Blank means not recorded.
- **Stock at risk** (this report) — the value held at a location above its cover: `max(value held − cover, 0)`;
  when no cover is recorded, the whole held value counts as at risk (nothing covers it). Zero-value rows are shown,
  not flagged.

## 3. Requirements (EARS)

- **FR-SAR-001** — Where a location holds stock (a balance row with quantity on hand > 0), the report SHALL show one row
  for that location. Locations with no stock and covers recorded on them are not shown (nothing sits there to expose).
- **FR-SAR-002** — When the caller may see stock cost (rank ≥ 20, ADR-0070), the row SHALL carry the stock value held
  (Σ `stock_balances.value_on_hand` for the location) and the recorded cover.
- **FR-SAR-003** — When the caller may not see stock cost (rank < 20), the row SHALL omit every money key
  (held value, cover, at risk). The server decides; the screen follows the data, never the role.
- **FR-SAR-004** — Where a cover is recorded, the at-risk figure SHALL be the held value above the cover
  (`greatest(held − cover, 0)`). Where no cover is recorded, the at-risk figure SHALL be the whole held value.
- **FR-SAR-005** — The report SHALL sort rows by at-risk figure descending, then location code, so the exposed
  locations lead. Without money keys it sorts by location code.
- **FR-SAR-006** — Where a stock-master writer (rank ≥ 20) records a cover on a location in Setup, the system SHALL
  store it (0 or more, 2 decimals at most, under the organisation's currency) and SHALL treat blank as "not recorded".
  A negative cover is refused.
- **FR-SAR-007** — The report SHALL return only the calling organisation's locations and values (organisation-scoped
  read RPC, active members only).
- **FR-SAR-008** — The report SHALL be reachable at `/stock/at-risk` under the stock section tabs, for every
  active member of an org with the stock feature; value columns render only when the server sent money keys.

### Non-functional

- **NFR-SAR-001** — Money arrives as decimal strings and stays strings to the screen (NFR-STK-007 pattern);
  the screen formats through `formatStockValue` with the organisation's currency.
- **NFR-SAR-002** — Every string ships in English and Bahasa Indonesia; wording is generic (no client names,
  no client process), and renameable PMO terms are never hard-coded in JSX.
- **NFR-SAR-003** — The screen uses `DESIGN.md` tokens and the shared stock furniture; it composes for phone (390)
  and desktop (1440).
- **NFR-SAR-004** — Existing organisations see no change on any existing screen; the report is a new route under the
  stock feature they already control, and the cover column is nullable (no default, no backfill).

## 4. Acceptance criteria (Given/When/Then)

### Database layer (pgTAP — `supabase/tests/stock_at_risk.test.sql`)

- **AC-SAR-101** Value held per location.
  Given a receive posts value 3,000 to site A and 9,000 stays at central,
  when the report is read by a rank-20 member,
  then site A's row carries stock value 3,000 and central's row carries 9,000, one row per location.
- **AC-SAR-102** At-risk is held value above the cover.
  Given site A holds 3,000 with a cover of 2,500, and site B holds 1,000 with a cover of 1,000,
  when the report is read,
  then site A's at-risk figure is 500 and site B's is 0.
- **AC-SAR-103** No cover recorded exposes the whole held value.
  Given site C holds 750 with no cover recorded,
  when the report is read,
  then site C's cover is null and its at-risk figure is 750.
- **AC-SAR-104** Money keys follow the cost permission, not the caller's claim.
  Given the same data,
  when an Engineer (rank < 20) reads the report, the rows carry no `stock_value`, `cover_value` or `at_risk` key;
  when a rank-20 member reads it, the keys are present. *(Mutation target: forcing the cost gate true must turn
  this criterion red, then the code is restored.)*
- **AC-SAR-105** Tenancy.
  Given a second organisation holds stock at its own location,
  when either organisation reads the report,
  then only its own locations and values come back.
- **AC-SAR-106** The cover is a plain recorded figure.
  Given a stock-master writer sets a location's cover to 2,500,
  when they save, the value is stored; when they clear it, it is null again;
  and a cover below 0 is refused by the column check.

### UI layer (Vitest)

- **AC-SAR-201** The DAL maps the RPC shape: snake_case to camelCase, money keys optional (absent stays absent,
  never a fabricated 0).
- **AC-SAR-301** The report page renders location, kind, project, held value, cover and at-risk; the at-risk figure
  reads as the lead fact; the summary states the total held and the total at risk.
- **AC-SAR-302** When no row carries money keys the three value columns do not render (rank < 20 view).
- **AC-SAR-303** A location with no cover recorded shows "Not recorded", never a fabricated 0.
- **AC-SAR-304** Empty (no location holds stock) and error (retry) states render.
- **AC-SAR-310** In Setup, the location form records the cover (blank clears it); a negative or >2-decimal entry is
  refused client-side before the write.

### Traceability

| AC | Owning test |
|---|---|
| AC-SAR-101..106 | `supabase/tests/stock_at_risk.test.sql` (pgTAP, integration) |
| AC-SAR-201 | `pmo-portal/src/lib/db/stockReports.test.ts` (unit) |
| AC-SAR-301..304 | `pmo-portal/pages/stock/StockAtRisk.test.tsx` (unit, RTL) |
| AC-SAR-310 | `pmo-portal/pages/stock/StockSetup.test.tsx` (unit, RTL) |

No e2e: the report is a single read-only surface whose cross-stack journey is covered at the integration (RPC)
and unit (screen) layers, matching the stock module's shipped precedent (#1512 S3/S6 shipped without a dedicated
journey for on-hand and reorder reads).

## 5. Out of this ticket

Cover history/audit trail, cover per item or per project, insurance documents, alerts or approvals on exposure,
editing the cover from the report, CSV-specific export formats beyond the shared table export, quantity-based covers.
