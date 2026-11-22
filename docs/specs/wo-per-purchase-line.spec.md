# A work order on each purchase line (trace only)

- **Map:** #2516 (contractor field operations). **Builds on:** ADR-0104 and the purchase header's work order and discipline (migration
  1580, fix lane walk-purchasing). **Plan:** `docs/plans/2026-11-22-wo-per-purchase-line.md`.
- **Job story:** When I request a purchase for several work orders at once, I want to say which line is for which work order, so the
  paper and the request show what each line is for, and the request's own work order follows when all lines agree.
- **Ruling (coordinator, binding):** this item is TRACE ONLY. No cost read is split per line or restated. Whether cost should be split
  per line is a customer question (below); until it is answered the line value is shown, never summed.
- **Money path:** no. No figure, approval or posting changes; a header value is copied only by a rule that already exists for the header.

## Today (verified on this branch, after merging land/fix-1122)

- A purchase's lines are `procurement_items` (`supabase/migrations/0001_init_schema.sql:111`, `category_id`/`needed_by` from `1346`); a line
  had no work order or discipline.
- The purchase **header** carries a work order and discipline: `procurements.work_order_id` / `discipline_id` (`1580`, tracked by `1650`). The
  request form asks for them (`pages/ProcurementCreate.tsx`, `CostAttributionFields`, starting on the project's only open work order);
  `create_procurement_with_items` accepts them and `transition_procurement` stamps the request and order records with them (`1580`). The
  rule that the work order is on the purchase's project, not cancelled, and the discipline live is `check_cost_attribution`
  (latest `1580`, which has a `procurements` case and a generic `procurement_id` case used by the four purchase records).
- Cost reads resolve a work order from the **records** (bill, PO, receipt, request record), `work_order_cost_amounts_unrounded` (`1263`,
  wrapped by `1113`, `1252`, `1298`). Nothing reads the header directly. This item does not touch any of them.
- The order print (`pages/PurchaseOrderPrint.tsx`) shows the order's work order in its header block and printed no line attribution.
- Equipment-plan approval (`approve_equipment_plan`, latest `1472`) wrote the plan line's work order into the purchase item's description
  text (`1359:8`).

## Requirements (EARS)

- **FR-WPL-001** The system shall let each purchase line carry an optional work order and an optional discipline.
- **FR-WPL-002** When a line names a work order or discipline, the system shall check it with the SAME rule the purchase documents use
  (`check_cost_attribution`, run on `procurement_items` too): a work order of another project or org, a purchase with no project, a newly
  named cancelled work order and a discipline not on the organisation's live list are refused, for every writer.
- **FR-WPL-003** The system shall let a line's attribution be set through `set_cost_attribution` (new source `procurement_item`) by the same
  people, on the same terms, as the other purchase records, audit every change per line, and refuse moving a purchase to another project
  while a line names a work order of the old one (`COST_LINE_PROJECT_MOVE`).
- **FR-WPL-004** The request form shall offer, per line, a work order of the purchase's project and a discipline ("Same as the request" /
  "No discipline" by default), on phone (390px) and desktop (1440px), using the shared form primitives, in English and Bahasa Indonesia.
  With no project it says to choose one; with no work orders on the project it says what is missing and who adds them. A cancelled work
  order already on a line stays visible, marked. At create the lines are attributed right after the case is saved; a refusal says
  "saved, but ..." and why, and never undoes the case.
- **FR-WPL-005** When every line of a purchase names the same (non-cancelled) work order, the system shall copy it to the purchase header's
  work order, only before submit (the purchase is Draft or Rejected); lines that differ, any line with none, or a purchase already
  submitted leave the header exactly as it is (the person may still set it by hand; after submit the request and order records carry the
  attribution and are re-attributed through their own path). The copy changes only the header.
- **FR-WPL-006** The request (Items tab) shall show each line's work order and discipline, editable by the requester and by Admin,
  Executive, Finance and Project Manager (the database decides), read-only otherwise, and note, as information only, a line whose work order
  differs from the request's. The order print shall show each line's work order and discipline under the item.
- **FR-WPL-007** When equipment-plan approval creates a rental purchase, the system shall put the plan line's work order on the purchase
  line (the column) instead of in the description text. (A cancelled or other-project work order now refuses the approval with the cost
  rule's refusal and creates nothing; before, the text was unchecked.) This is a small restatement (one call added, one description part
  removed) and is included.
- **FR-WPL-008** Every refusal a person can meet here has an English and a Bahasa Indonesia sentence in the shared refusals catalogue with a
  next step: `COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED` (each gains a `_detail` line), `COST_DISCIPLINE` (existing),
  `COST_LINE_PROJECT_MOVE` (new).
- **FR-WPL-009** The system shall not change any cost read, the cost-lines view, the commitment rows or any money figure.

## Settings

**None added.** The columns are new and NULL for every existing line, no cost read changes, and the header is only written by FR-WPL-005 when
a person has named a work order on every line, which is the new action itself. Every figure an organisation sees today is unchanged.

## Acceptance criteria (owner layer per ADR-0010)

- **AC-WPL-001** (pgTAP `1880`) A requester sets a line, a Project Manager sets any line; a null clears; a live discipline is stored.
- **AC-WPL-002** (pgTAP `1880`, mutation-checked) Another project's work order, another org's, a purchase with no project, a newly named
  cancelled work order and a retired discipline are refused (RPC and direct write); a line already on a work order keeps it after the work
  order is cancelled.
- **AC-WPL-003** (pgTAP `1880`, mutation-checked) Another engineer is refused (42501); another org's caller reads the line as absent; a
  purchase cannot move away from its lines' work orders; every change is audited per line.
- **AC-WPL-004** (pgTAP `1880`; `1215_hide_prices` unchanged) The masked line view carries the work order.
- **AC-WPL-005** (pgTAP `1883`, mutation-checked) Every line on one work order: the header takes it; lines that differ or a line with none
  leave the header as it is.
- **AC-WPL-006** (pgTAP `1883`, mutation-checked) The copy changes only the header (the request record is untouched); a cancelled work
  order is never copied; another purchase's header is untouched; after submit, every line naming one work order leaves the header unchanged.
- **AC-WPL-007** (unit) The per-line picker and Items-tab panel: choices and default labels, information note on a difference, read-only
  text, empty states, saving only changed lines grouped by what they name, discipline saved, a refusal in words; the repository's grouped
  write and its "saved, but" error.
- **AC-WPL-008** (e2e `AC-WPL-012-work-order-per-purchase-line.spec.ts`, written for the orchestrator's run) A purchase with two lines both
  for WO-1 gives the request WO-1; changing line two to WO-2 leaves the request on WO-1 and shows both lines' work orders.
- **AC-WPL-009** (pgTAP `equipment_plan_orders`) Approving a plan puts the plan line's work order on the purchase line as its column.

## Existing tests whose steps change (and why)

- `supabase/tests/equipment_plan_orders.test.sql` (AC-EQP-010): asserted the work order inside the item description; goal kept (the item
  carries the work order), the oracle is now the line's `work_order_id`.
- `supabase/tests/1472_approve_equipment_plan_taken_reference.test.sql`: its pre-created "exact payload the approval would send" loses the
  work-order text in the description so the idempotent take-over still matches.
- Verified unchanged (no purchase lines in their fixtures, and no cost read changes): `0950`, `0997`, `1115`, `1251`, `1298`, `1260`,
  `csr_cost_attribution`, `1182_third_party_inspection_purchase`, `work_order_performance`, `1215_hide_prices`.
- Typed fixtures of a line row (`LineItemsSection*.test.tsx`, `ProcurementDetailTabs.test.tsx`) gain `work_order_id: null` and `discipline_id: null`.
- Not run here (no database in this lane): the orchestrator's pgTAP and e2e wave is the proof.

## Customer question (for the final report)

- **Should cost be split per line?** Today the cost of a purchase lands on the work order of its records (bill, then PO, receipt, request).
  With lines on different work orders, the cost of one bill still lands on one work order. Recommended answer: **yes, later, as its own
  item**: split a bill's paid cost by line value, a line's own work order winning over the records' (a design was written and withdrawn on
  the coordinator's ruling; it needs `work_order_cost_amounts_unrounded` restated and one more row per work order in every money consumer).
  Built meanwhile: the trace only.
