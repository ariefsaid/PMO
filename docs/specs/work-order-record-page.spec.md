# Work-order record page (WORP)

Issue #2518 (map #2516, blocked by #2517). Status: **Draft, 2026-11-20**. Executor on sign-off: Orca worker per
`docs/orca-dispatch.md`; plan `docs/plans/2026-11-20-work-order-record-page.md`. IDs: `FR-WORP-###`, `AC-WORP-###`.
**Money path: read-only.** No posting, no SoD change, no new write path. Layout is composed with the `restructure`
skill and judged on the rendered screen by the owner (`docs/ux/screen-rules.md`).

**Builds on #2517** (branch `feat/2517-work-order-cost-spine`, migrations 0950-0951, ADR-0103): nullable
`work_order_id` + `discipline_id` on seven cost sources and the `security_invoker` view `work_order_cost_lines`
(columns `source, record_id, org_id, project_id, work_order_id, discipline_id, occurred_on, reference, quantity,
quantity_unit`; money stays behind each source's own read).

**Job story.** When a client's work order is running, I want one page that shows what it covers, how far it has got,
what it has cost, what has been billed and accepted, and what is open on it, so I can run it without hopping between
the project's tabs and modals.

## 1. AS-IS

- A work order has no route. It lives as a card/modal set on the project page's Work Orders tab
  (`pages/project-detail/tabs/WorkOrdersTab.tsx`, `WorkOrderFormModal`, `WorkOrderLinesModal`,
  `InvoiceWorkOrderModal`, `WorkOrderAcceptances`, `WorkOrderCostVariations`).
- Reads exist per concern: `src/lib/db/workOrders.ts`, `workOrderAcceptances.ts`, `workOrderBilling.ts`
  (per-WO invoiced / pending / paid / remaining, derived, DD-BWO-1..13). BOQ allocations are `work_order_lines`
  (0337); acceptances `work_order_acceptances` (+ lines).
- Cost side: only PO variations and T&M claims named a work order before #2517.
- Routes are declared in `pmo-portal/App.tsx`; the shell's route matching is `src/components/shell/routeMatch.ts`.

## 2. Requirements (EARS)

**Route and access**
- FR-WORP-001 The system shall serve `/work-orders/:id` for any work order the caller's RLS lets them read.
- FR-WORP-002 When the id is absent, in another org, or unreadable, the page shall show the shared not-found state
  and shall not reveal whether the row exists.
- FR-WORP-003 The page shall show the work order's number, client PO number, title, status, project (linked), client
  and order value with currency; a Draft shows "not yet numbered".
- FR-WORP-004 Every affordance that writes (issue, record progress, invoice, accept) shall reuse the shipped
  `can()` gates and RPCs; the page adds no write path of its own.

**Entry points**
- FR-WORP-010 Each row of the project's work-order list shall link to its page.
- FR-WORP-011 Any record that names a work order shall link to that page: a sales invoice, an acceptance, a cost
  line (by source), a task, an issue. The link is rendered only where the caller can read the work order.
- FR-WORP-012 The project page's modals stay for creating and editing; the page is the place to read.

**Sections** (one column on a phone; section order fixed)
- FR-WORP-020 *Scope and progress*: BOQ lines allocated to this work order with quantity, accepted-to-date quantity
  and percent complete, and the work order's overall percent (value-weighted, as shipped). A work order with no
  lines shows an empty state with a link to allocate.
- FR-WORP-021 *Costs*: committed/booked cost lines for this work order grouped by source (purchase request, order,
  receipt, vendor bill, timesheet, stock, equipment) and by discipline, from the #2517 repository function. Records
  with no discipline group under "No discipline". Each group lists record, date and reference and links to the
  record. Quantities (hours, usage) show without money where the caller cannot read money.
- FR-WORP-022 Where the caller may read a source's money, the group shows its total in the work order's currency;
  where not, the total is omitted (not shown as zero) and a note says the figure is restricted.
- FR-WORP-023 *Billing and acceptances*: invoiced / pending / paid / remaining and the acceptance list (draft,
  confirmed, final) using the shipped derivations; no second formula.
- FR-WORP-024 *Documents*: files linked to the work order through the existing document seam, openable in place.
- FR-WORP-025 *Issues*: issues (#2521) naming the work order, with status and due time; *Open tasks* (#2531): tasks
  naming it that are not Done, with assignee and due date. Both link out and show an empty state.
- FR-WORP-026 A section whose read fails shall show its own error with retry; the other sections still render.
- FR-WORP-027 A section shall never render blank: loading, empty, error and restricted each have copy (English and
  Bahasa Indonesia).

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-WORP-001 | Given an Issued WO in my org, when I open `/work-orders/:id`, then I see its number, title, status, project and order value. | Unit (RTL) |
| AC-WORP-002 | Given an id from another org, when I open it, then I get the not-found state, same as a random id. | pgTAP (read returns no row) + Unit |
| AC-WORP-003 | Given a project's work-order list, when I click a row, then I land on that WO's page. | E2E (one journey) |
| AC-WORP-004 | Given a cost line, task or issue naming a WO, when I click the WO reference, then I land on its page. | Unit per host, one E2E |
| AC-WORP-005 | Given WO lines with confirmed acceptances, when I view Scope, then each line shows accepted quantity and percent equal to the acceptance data. | Unit (derivation) |
| AC-WORP-006 | Given cost lines on three sources and two disciplines plus one with none, when I view Costs, then groups by source and by discipline list exactly those records, with "No discipline" for the unlabelled one. | Unit + Layer-1 money test |
| AC-WORP-007 | Given a caller who cannot read purchase money, when I view Costs, then purchase groups list records with no total and a restricted note. | Unit |
| AC-WORP-008 | Given invoices in each state, when I view Billing, then figures equal `workOrderBilling` for the same WO. | Unit |
| AC-WORP-009 | Given one failing section read, when the page loads, then that section shows an error with retry and the rest render. | Unit |
| AC-WORP-010 | Given any state at 375 px, when I run `scripts/ux-proof.sh` on the route, then no small text, no horizontal scroll and no blank region. | ux-proof gate |
| AC-WORP-011 | Given Bahasa Indonesia selected, then every string on the page is translated. | Unit (locale parity guard) |

## 4. Open questions
1. Should the project's modals for lines/acceptances move to the page, or stay as the edit surface (FR-WORP-012 assumes stay)?
2. Does an Engineer role see the Costs section at all (hours of their own crew only)? Assumed: sees records RLS returns, no money.
3. Percent complete: value-weighted (as shipped for claims) or quantity-weighted? Assumed shipped behaviour.
4. Documents: link only (existing project documents tagged by WO) or upload here? Needs a ruling; assumed link-only in v1.
5. Cost groups: show cost money for stock issues only after the #2523 zero-cost rule lands? Assumed yes: the page shows whatever the stock value read returns.

## 5. Out of scope
Editing from the page beyond shipped RPCs; plan-vs-actual and margin (#2519); creating tasks or issues (#2531, #2521).
