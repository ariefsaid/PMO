# A work order on each purchase line

- **Map:** #2516 (contractor field operations). **Builds on:** ADR-0104 (work orders on the cost side),
  `docs/specs/work-order-cost-attribution.spec.md`. **Plan:** `docs/plans/2026-11-22-wo-per-purchase-line.md`.
- **Job story:** When I request a purchase for several work orders at once, I want to say which line is for which work
  order, so the cost lands on the right one.
- **Ruling (brief):** cost attribution follows the line. A line's OWN work order wins, always. The records' work orders
  (bill, then PO, then receipt, then request: today's order) are the DEFAULT for lines that name none.
- **Money path:** yes (cost attribution only; no approval, posting, ERP command or ledger figure changes).

## Today (verified on this branch, before the change)

- A purchase *request* here is a procurement case; its lines are `procurement_items`
  (`supabase/migrations/0001_init_schema.sql:111`, plus `category_id`/`needed_by` from `1346`). **A line had no work order
  column.** `create_procurement_with_items` (latest `1351`) takes none and makes no `purchase_requests` row (`1359:8`).
- The work order sat on the four purchase **records** (`work_order_id` + `discipline_id`, ADR-0104, `0951`): request record,
  PO, goods receipt, vendor bill, one value per record, set after the record exists by `set_cost_attribution` (latest `1261`)
  and the form `pages/procurement/RecordCaptureForm.tsx:233-236,618`. The same-project/org rule is `check_cost_attribution`
  (latest `1296`). The item text was right: the work order is per request record, not per line.
- **Where cost is attributed to a work order** (all read-time; nothing stores a cost per work order):
  - `work_order_cost_amounts_unrounded` (latest `1263`): a paid vendor bill's cost took the first of `bill`, `PO`, `receipt`
    (unique across the PO's receipts), `request record` (unique across the case's request records) (`1263:47,70-73`); the paid
    amount not on a bill ("`purchase_balance`") took a unique work order across PO, receipts and (only when neither exists)
    request records (`1263:88-96`); ambiguous or none is "unassigned". Wrapped by `1113` (two decimals), `1252` (labour),
    `1298` (current `work_order_cost_amounts`).
  - `work_order_cost_amounts_unpriced` (latest `1115`): one `commitment` row per request record, PO and receipt, no money.
  - `work_order_cost_lines` view (latest `1262`): one row per record by source, no money.
  - TS: `src/lib/db/workOrderFinance.ts` (pages `work_order_cost_amounts`), `src/lib/workOrderPlanVsActual.ts`,
    `src/lib/db/workOrderCosts.ts` (cost lines), `workOrderCostMoney.ts` / `workOrderCostView.ts` (record amounts of the document list).
  - Not cost: `1182` (inspection link refuses a purchase whose records name another work order) and `1359` (equipment-plan
    approval wrote the plan line's work order into the item's **description text**, `1359:8`).
- Project totals never read the work order (ADR-0104); they stay unchanged.

## Requirements (EARS)

- **FR-WPL-001** The system shall let each purchase line carry an optional work order.
- **FR-WPL-002** Where a line names no work order, the system shall treat it as being for the record-level work order (the
  chain bill, PO, receipt, request that the cost read resolves today), decided when cost is read, not copied onto the line.
- **FR-WPL-003** When a line names a work order, the system shall refuse it unless the work order is in the purchase's
  project and organisation (`COST_WO_PROJECT`), the purchase has a project (`COST_WO_NO_PROJECT`), and, when newly named,
  the work order is not cancelled (`COST_WO_CANCELLED`). The database refuses it for every writer.
- **FR-WPL-004** The system shall let a line's work order be set and changed through `set_cost_attribution` (new source
  `procurement_item`) by the same people, on the same terms, as the other purchase records: Admin, Executive, Finance and
  Project Manager for any line of their org; the requester for a line of their own purchase. Every change is audited per
  line. A line takes no discipline: a discipline on a `procurement_item` is refused (`COST_LINE_DISCIPLINE`). A purchase
  cannot move to another project while a line names a work order of the old one (`COST_LINE_PROJECT_MOVE`).
- **FR-WPL-005** While a purchase's lines name at least one own work order and the lines have value, the system shall split a
  paid vendor bill's cost, and the paid amount not on a bill, across the purchase's lines in proportion to line value
  (`quantity * rate`): each line's part goes to the line's own work order if it names one, else to the record-level default
  chain (FR-WPL-002) of that bill. Parts on the same work order are added; parts are whole cents summing exactly to the cost
  (largest remainder, ties by work order, none last). A part with no work order is reported unassigned.
- **FR-WPL-006** A line's own work order shall win over the work order its bill, PO, receipt or request names (the ruling).
  The record's work order remains the default for the lines that name none.
- **FR-WPL-007** Where no line of a purchase names a work order, or the lines have no value, the system shall return exactly
  the rows and figures it returns today. ERP-ledger mode is unchanged (the ledger is the oracle; bill rows are not allocated there).
- **FR-WPL-008** The document lists (`work_order_cost_lines`, the commitment rows) shall keep each record under its own work
  order. They carry no money, and the document list shows the record's own amount: listing a record under several work orders
  would count that amount more than once. Money by line lives only in `work_order_cost_amounts`.
- **FR-WPL-009** When a read returns a split cost, the system shall return one row per (record, work order), and every consumer
  shall key and page on `(source, record_id, work_order_id)`.
- **FR-WPL-010** The purchase form (create) and the case's Items tab shall let the person pick, per line, a work order of the
  purchase's project ("Same as the request" by default), on phone (390px) and desktop (1440px). With no project the section
  says to choose one; with no work orders on the project it says what is missing and who adds them. A cancelled work order
  already on a line stays visible, marked. At create the line is attributed right after the case is saved, and a refusal never
  undoes the case (ADR-0104 pattern, "saved, but ..."). On the Items tab the requester and Admin, Executive, Finance and
  Project Manager can change it; everyone else reads it.
- **FR-WPL-011** Where a line's own work order differs from the request's, the case page shall say so (information, not a block).
- **FR-WPL-012** Every refusal a person can meet here has an English and a Bahasa Indonesia sentence in the shared refusals
  catalogue, with a second line saying what to do next: `COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED` (each gains
  a `_detail` line), `COST_LINE_DISCIPLINE`, `COST_LINE_PROJECT_MOVE`.
- **FR-WPL-013** The system shall not add an organisation switch for this (see Settings).
- **FR-WPL-014** When equipment-plan approval creates a rental purchase, the system shall put the plan line's work order on
  the purchase line (the column), replacing the text in the description (`1359:8`). (A cancelled or other-project work order now
  refuses the approval with the cost rule's refusal and creates nothing; before, the text was written unchecked.)

## Settings

**None added.** A line with no work order of its own takes the record-level default, so every figure an organisation already
sees is unchanged: the column is new and NULL for every existing line, no data moves, and the rows of a purchase whose lines
name nothing are the rows of today (FR-WPL-007, AC-WPL-006). A figure moves only after a person names a work order on a line,
which is the new action itself. The one behaviour change for an organisation already using equipment plans is FR-WPL-014's
refusal of an invalid work order at approval, which the earlier free text could not express.

## Acceptance criteria (owner layer per ADR-0010)

- **AC-WPL-001** (pgTAP `1880`) Given a project with two work orders, When the requester sets a line through
  `set_cost_attribution('procurement_item', ...)` and a PM sets another, Then both are stored; a null clears; a PM may set any line.
- **AC-WPL-002** (pgTAP `1880`, mutation-checked) Given a work order of another project, another org, a purchase with no
  project or a newly named cancelled work order, When a line names it (RPC or direct write, any writer), Then 23514 with the
  `COST_*` code; a line already on a work order keeps it after the work order is cancelled.
- **AC-WPL-003** (pgTAP `1880`, mutation-checked) Given another engineer, Then 42501; another org's caller, Then absent; a
  discipline on a line, Then `COST_LINE_DISCIPLINE`.
- **AC-WPL-004** (pgTAP `1882`, mutation-checked) Given one paid bill of 1,000.00 and two lines 600.00 (own WO1) and 400.00
  (none, request record on WO2), Then two `vendor_bill` rows WO1 600.00 and WO2 400.00 with the same `record_id`, the defaulted
  part keeping the record's discipline; an odd three-way split of 100.00 sums to exactly 100.00 (33.34 / 33.33 / 33.33).
- **AC-WPL-005** (pgTAP `1882`, mutation-checked) Given the bill itself on WO3 and a line of 600.00 on WO1, Then the line's own
  work order wins over the bill's: WO1 600.00, and the line with none takes the bill's WO3 400.00.
- **AC-WPL-006** (pgTAP `1882`) Given lines that name nothing, Then each bill is one row on today's record-level chain
  (literal expected rows), the project total equals `get_project_finances` actuals, and naming lines on other purchases leaves
  those rows and the project total unchanged.
- **AC-WPL-007** (pgTAP `1882`, mutation-checked) Given a paid amount not on a bill, Then it splits by line value the same way;
  given lines of no value, Then one unassigned row and no division by zero.
- **AC-WPL-008** (pgTAP `1882`) Then `work_order_cost_lines` lists the request record once, under its own work order.
- **AC-WPL-009** (pgTAP `1880`; `1215_hide_prices` stays green) The masked line view carries the line's work order.
- **AC-WPL-010** (unit) `listProjectCostAmounts` pages on `(record_id, source, work_order_id)` and returns both parts of a
  split bill; `rollupProject` counts both parts, each on its own work order.
- **AC-WPL-011** (unit) The line work-order panel: choices, default label, information note on a difference, read-only text,
  empty states (no project / no work orders), saving only changed lines grouped by work order, a refusal in words, the
  repository's grouped write and its "saved, but" error.
- **AC-WPL-012** (e2e, one journey, `AC-WPL-012-work-order-per-purchase-line.spec.ts`, written for the orchestrator's run) A
  purchase with two lines, line one for WO1 and line two following the request's WO2, paid in full: the plan-vs-actual row
  shows 600 on WO1 and 400 on WO2.
- **AC-WPL-013** (pgTAP `equipment_plan_orders`) Approving a plan puts the plan line's work order on the rental purchase line
  as its column, and the description no longer carries it.

## Existing tests whose steps change (and why)

Greps over `supabase/tests` and `pmo-portal` for `work_order_cost_lines`, `work_order_cost_amounts`, `procurement_items_masked`,
`set_cost_attribution` and `approve_equipment_plan`:

- `supabase/tests/equipment_plan_orders.test.sql` (AC-EQP-010): asserted the work order inside the item description
  (`'... · Work order EQP WO on project'`). Goal kept (the item carries the work order); the oracle is now the line's
  `work_order_id`, the description is the plain plan text.
- `supabase/tests/1472_approve_equipment_plan_taken_reference.test.sql`: pre-creates "the exact payload the approval would send"
  for the idempotent take-over; that payload's description loses the work-order text so it still matches the approval's.
- Verified unchanged (no purchase lines in their fixtures, so every row stays the record-level chain): `0950_work_order_cost_attribution`
  (the source-count assertion lists records, and its unknown-source probe uses `journal`), `0997_work_order_plan_vs_actual`,
  `1115`, `1251`, `1298`, `1260`, `csr_cost_attribution`, `1182_third_party_inspection_purchase`, `work_order_performance`;
  `1215_hide_prices` reads `rate`/`amount`/`quantity` by name, so the added view column does not touch it.
- `pmo-portal/src/lib/db/workOrderFinance.test.ts`: gains the ordering/keying assertion (AC-WPL-010); existing steps unchanged.
- Not run here (no database in this lane): the orchestrator's pgTAP and e2e wave is the proof.

## Questions to the customer, with answers adopted

- **OQ-WPL-1 (answered by the brief):** a line's own work order wins over the bill's, PO's, receipt's and request's; those become
  the default for lines that name none. The case page flags a difference as information.
- **OQ-WPL-2 (recommended answer adopted):** a work order per line only; the discipline stays on the purchase records.
- **OQ-WPL-3 (recommended answer adopted):** a bill that covers several lines is split by line value (lines carry value, bills do not name lines).
