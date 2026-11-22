# A work order on each purchase line

- **Map:** #2516 (contractor field operations). **Builds on:** ADR-0104 (work orders on the cost side),
  `docs/specs/work-order-cost-attribution.spec.md`. **Plan:** `docs/plans/2026-11-22-wo-per-purchase-line.md`.
- **Job story:** When I request a purchase for several work orders at once, I want to say which line is for which work
  order, so the cost lands on the right one.
- **Money path:** yes (cost attribution; no approval, posting, ERP command or ledger figure changes).

## Today (verified on this branch)

- A purchase *request* here is a procurement case; its lines are `procurement_items`
  (`supabase/migrations/0001_init_schema.sql:111`, plus `category_id`/`needed_by` from `1346`). **A line has no work order
  column.** `create_procurement_with_items` (latest `1351`) takes none and makes no `purchase_requests` row (stated in
  `1359_approve_equipment_plan.sql:8`).
- The work order sits on the four purchase **records** (`work_order_id` + `discipline_id`, ADR-0104, `0951`): request
  record, PO, goods receipt, vendor bill. One value per record. It is set after the record exists by
  `set_cost_attribution` (latest `1261_set_cost_attribution_expense_claim.sql`, source list at line 24) and the form
  `pages/procurement/RecordCaptureForm.tsx:233-236,618` (`CostAttributionFields`). The rule that it must be the same
  project and org is `check_cost_attribution` (latest `1296`, `COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED`).
- So the item text is **right**: the work order is per request record, not per line.
- **Where cost is attributed to a work order** (all read-time; nothing stores a cost per work order):
  - `work_order_cost_amounts_unrounded` (latest `1263`): a paid vendor bill's cost takes the first of
    `bill.work_order_id`, `po.work_order_id`, receipt (unique across the PO's receipts), request record (unique across the
    case's request records) (`1263:47`, lateral `rq` at `1263:70-73`). The part of the paid amount not on a bill
    ("`purchase_balance`") takes a unique work order across PO, receipts, and (only when neither exists) request
    records (`1263:88-96`). Ambiguous or none means "unassigned". Wrapped by `1113` (two decimals), `1252` (labour),
    `1298` (current `work_order_cost_amounts`).
  - `work_order_cost_amounts_unpriced` (latest `1115`): one `commitment` row per request record, PO and receipt, with the
    record's own work order and no money.
  - `work_order_cost_lines` view (latest `1262`): one row per record by source with the record's work order.
  - TS: `pmo-portal/src/lib/db/workOrderFinance.ts:44` (pages `work_order_cost_amounts` ordered by `record_id, source`),
    `src/lib/workOrderPlanVsActual.ts` (sums per work order), `src/lib/db/workOrderCosts.ts:157` (cost lines, pages by
    `record_id`), `workOrderCostMoney.ts` (links records to the case timeline).
  - Not cost: `1182` (inspection link refuses a purchase whose records name another work order, `1182:40-47`) and
    `1359` (equipment-plan approval writes the line's work order into the purchase item **description text**, `1359:8`).
- Project totals never read the work order (ADR-0104 consequence); they stay unchanged.

## Requirements (EARS)

- **FR-WPL-001** The system shall let each purchase line carry an optional work order.
- **FR-WPL-002** Where a line names no work order, the system shall treat the line as being for the request's work order
  (the work order the case's request record names; when its request records disagree or none names one, no work order),
  decided when cost is read, not copied onto the line.
- **FR-WPL-003** When a line names a work order, the system shall refuse it unless the work order is in the purchase's
  project and organisation (`COST_WO_PROJECT`), the purchase has a project (`COST_WO_NO_PROJECT`), and, when newly named,
  the work order is not cancelled (`COST_WO_CANCELLED`). The database refuses it for every writer.
- **FR-WPL-004** The system shall let a line's work order be set and changed through `set_cost_attribution` (new source
  `procurement_item`) by the same people, on the same terms, as the other purchase records: Admin, Executive, Finance and
  Project Manager for any line of their org; the requester for a line of their own purchase. Every change is audited per
  line. A line takes no discipline: a discipline on a `procurement_item` is refused (`COST_LINE_DISCIPLINE`).
- **FR-WPL-005** While a case's lines resolve to more than one work order (counting "none" as a value), the system shall
  split the cost that today takes the request-level fallback (a paid vendor bill, and the paid amount not on a bill) across
  those work orders in proportion to line amount (`quantity * rate`), in whole cents, the parts summing exactly to the
  cost (largest remainder, ties by id). A part with no work order is reported unassigned.
- **FR-WPL-006** Where a vendor bill, PO or goods receipt itself names a work order, the system shall keep today's rule: that
  record's own work order is the more specific statement and wins over the lines (unchanged figures).
- **FR-WPL-007** Where no line of a case names a work order, the system shall return exactly the rows and figures it
  returns today.
- **FR-WPL-008** The cost lines and the commitment rows for a request record shall list the record under each work order its
  lines resolve to (one row each); with no line work order, one row as today.
- **FR-WPL-009** When a read returns a split cost, the system shall return one row per (record, work order) and every
  consumer shall treat `(source, record_id, work_order_id)` as the row key and page on it.
- **FR-WPL-010** The purchase form shall let the person pick, per line, a work order of the purchase's project ("Same as the
  request" by default), on phone (390px) and desktop (1440px); with no work orders on the project the control is absent
  and says why where a person looks for it; when picked at create the line is attributed right after the case is saved and
  a refusal never undoes the case (ADR-0104 pattern).
- **FR-WPL-011** Where a request's lines name different work orders, the case page shall show each line's work order and the
  cost shares by work order, and say when a bill, PO or receipt names its own work order that differs from a line.
- **FR-WPL-012** Every refusal a person can meet here shall have an English and a Bahasa Indonesia sentence in the shared
  refusals catalogue saying what to do next.
- **FR-WPL-013** The system shall not add an organisation switch for this (see Settings).
- **FR-WPL-014** When equipment-plan approval creates a rental purchase, the system shall put the plan line's work order on
  the purchase line (replacing the text in the description, `1359:8`).

## Settings

**None added.** A line with no work order of its own inherits the request's, so every figure an organisation already sees
is unchanged: no existing row has a line work order (the column is new and null), and no data moves. A figure changes
only after a person names a work order on a line, which is the new action itself. (FR-WPL-007, AC-WPL-006.)

## Acceptance criteria (owner layer per ADR-0010)

- **AC-WPL-001** (pgTAP) Given a project with two work orders, When the requester sets line A to WO1 and line B to WO2
  through `set_cost_attribution('procurement_item', ...)`, Then both stored; a null clears; a PM may set any line of the org.
- **AC-WPL-002** (pgTAP) Given a work order of another project, another org, or a purchase with no project, When a line
  names it (RPC or direct write, any role including service role), Then 23514 `COST_WO_PROJECT` / `COST_WO_NO_PROJECT`; a
  newly named cancelled work order is `COST_WO_CANCELLED`; a line already on it keeps it. Mutation: drop the project check,
  the test goes red.
- **AC-WPL-003** (pgTAP) Given a caller who is not the requester and not a privileged role, or another org's caller, When
  they set a line, Then 42501 / not found, line unchanged. A discipline argument for a line is `COST_LINE_DISCIPLINE`.
- **AC-WPL-004** (pgTAP) Given one paid bill of 1,000.00, two lines 600.00 (WO1) and 400.00 (no own, request default WO2),
  no bill/PO/receipt work order, When `work_order_cost_amounts` is read, Then two `vendor_bill` rows: WO1 600.00, WO2
  400.00, the same `record_id`, sum 1,000.00; a 3-way odd split (three equal lines, 100.00) sums to exactly 100.00.
- **AC-WPL-005** (pgTAP) Given the same case with the bill itself on WO3, Then one row, WO3, 1,000.00 (FR-WPL-006).
- **AC-WPL-006** (pgTAP) Given a case where no line names a work order, Then `work_order_cost_amounts`,
  `_unpriced` and `work_order_cost_lines` return rows identical to those from a baseline captured before the line column
  exists (rows for existing seed data are unchanged), and project totals are equal before and after attributing a line.
- **AC-WPL-007** (pgTAP) Given the part of a paid amount not on a bill, with no PO/receipt work order, Then it splits by
  line share; Given a case whose lines total 0, Then the part is reported unassigned, never divided by zero.
- **AC-WPL-008** (pgTAP) Given a request record on WO2 and lines on WO1 and none, Then `work_order_cost_lines` and the
  commitment rows list the record under WO1 and WO2; with no line work order, one row under WO2.
- **AC-WPL-009** (pgTAP) Given a Finance reader without price access, Then the masked line view still returns the line's
  work order and still masks amount and rate (existing `1215_hide_prices` stays green).
- **AC-WPL-010** (unit) Plan-vs-actual and cost-line consumers key and page on (source, record, work order); two rows for
  one bill are both summed, neither dropped nor duplicated across a page boundary.
- **AC-WPL-011** (unit) The line form: work-order choice per line, "Same as the request" default, hidden with no work
  orders (with its reason), refusal text from the catalogue in both languages.
- **AC-WPL-012** (e2e, one journey) Given a purchase with two lines, When the requester picks WO1 for line 1 and leaves line
  2 on the request's WO2, saves, and the case is paid in full, Then the work-order cost page shows each work order's share.
- **AC-WPL-013** (pgTAP) Given an equipment plan with a work order approved, Then the rental purchase line carries that work
  order (and the description no longer does).

## Existing tests whose steps change (and why)

- `supabase/tests/0950_work_order_cost_attribution.test.sql`: asserts the list of cost sources / the `unknown cost source`
  refusal; the list gains `procurement_item`, so its "unknown source" probe must use another value. Goal assertions stay.
- `supabase/tests/1215_hide_prices.test.sql`: asserts the masked item view's columns; gains `work_order_id`.
- Equipment-plan pgTAP (`1359`/`1472` tests) asserting the work order text in the description: now asserts the column.
- To be confirmed by grep in the build (not verified here): pgTAP / vitest that pin `work_order_cost_lines` or
  `work_order_cost_amounts` row counts for a seeded split case, and any test using `procurement_items` select-lists.

## Open questions

- **OQ-WPL-1 (customer):** when a bill, PO or receipt is itself on a work order and a line says another, which wins?
  Recommended: the record, because someone attributed the actual document; the case page flags the difference. Built meanwhile.
- **OQ-WPL-2 (customer):** is a work order per line enough, or does the discipline also vary per line? Recommended: work order
  only now; discipline stays on the record (a line takes none).
- **OQ-WPL-3 (customer):** is splitting by line value right for a bill that covers several lines? Recommended: yes (lines
  carry value, bills do not name lines); a bill that is for one work order is attributed on the bill, which wins.
