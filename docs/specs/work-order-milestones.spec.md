# Work orders as billing milestones on the project plan (WOMS)

Issue #1640 (map #791; settles #1592). Status: **Draft, 2026-11-01** — awaiting owner sign-off of the open
questions below. Executor on sign-off: Orca worker per `docs/orca-dispatch.md`; slice S3 touches the entry
point of a money write and is Director-dispatched and **ships alone** (plan
`docs/plans/2026-11-01-work-order-milestones.md`).

**Owner rulings this encodes**

- **OD-GRILL-20261101** (`docs/decisions.md:3617`): "The project plan shows each work order as a milestone:
  dates, value, billing status (Planned / In progress / Invoiced / Paid), 'Invoice this'; each work order shows
  days since its acceptance with no invoice yet. OD-BILL-1 stands (bill by the client's PO); this is the same
  record shown on the plan, no second entry."
- **OD-BILL-1** (`docs/decisions.md:3162`): clients are billed by their PO/SO (the work order), never by tracker
  milestones; tracker milestones (shown to users as **Phase**, DD-VOCAB-1 `docs/decisions.md:3237`) stay
  progress-only and carry no amount.
- **DD-BWO-1..13** (`docs/decisions.md:3165-3182`): per-WO invoiced / pending / paid / remaining are derived,
  never stored; Paid = nothing left, nothing in draft, every submitted invoice Paid (DD-BWO-2); an untotallable
  WO fails closed (DD-BWO-3); the milestone→WO display link is a follow-up (DD-BWO-12); a WO with nothing left
  but a draft reads "Awaiting submission", never "Fully invoiced" (DD-BWO-13).

**Job story.** When I look at a project's plan, I want to see each of the client's work orders as a billing
milestone — when it runs, what it is worth, how far its billing has got, and how long accepted work has sat
un-invoiced — and invoice it from there, so that nothing the client has already accepted waits silently to be
billed.

## 1. AS-IS (shipped behaviour, cited)

All citations are against `origin/dev` at `6440a961`.

### 1.1 The work order record
- `public.work_orders` (`supabase/migrations/0193_work_orders.sql:130-182`): `wo_number`, `client_po_number`,
  `title`, `status` (`Draft`/`Issued`/`Closed`/`Cancelled`, `:128`), `order_value` + `tax_treatment` +
  `tax_amount`, `currency`, and three nullable dates `order_date`, `start_date`, `end_date` (`:164-166`),
  plus stamps `issued_at`, `closed_at`, `cancelled_at`. Lifecycle is deliberately **not** "invoiced/paid"
  (`0193:96-98`): paid-ness lives on the invoice.
- `work_orders.closing_value` / `closing_acceptance_id` (`0337_contract_quantities.sql:149-152`), written only by
  final-acceptance confirmation.
- There is **no acceptance column on `work_orders`**. Acceptance is its own table (§1.2).

### 1.2 Acceptance (BAST) — what "acceptance" means in shipped data
- `public.work_order_acceptances` (`0337_contract_quantities.sql:94-118`): per WO, cumulative, with
  `acceptance_date date not null` (the date on the client's acceptance record), `is_final`, `status`
  (`Draft`/`Confirmed`/`Withdrawn`), `confirmed_by`/`confirmed_at`/`confirm_basis`. Confirmed rows are immutable
  (`0337:175-187`); at most one Confirmed final per WO (`0337:117-118`).
- Confirmation is `confirm_work_order_acceptance` (live body `0339_read_model_access_and_confirmation_time.sql:7`),
  Admin/Finance, preparer ≠ confirmer unless sole operator, requires an Issued WO and an Issued/Approved
  document with a file. A final confirmation closes the WO at the accepted value.
- A BAST can only be prepared on a WO with allocated contract lines
  (`pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx:308-310`). A WO with no lines never has an acceptance.

### 1.3 Billing figures per work order
- `public.work_order_billing_lines` (`0262_billing_by_work_order.sql:39-52`): linked non-cancelled invoices at
  billed work (down payment = 0), `submitted` = status in (`Submitted`,`Unpaid`,`Paid`), `paid` = status `Paid`;
  plus live unraised claims at gross (never submitted, never paid).
- `public.work_order_billing` (live body `0337_contract_quantities.sql:1010-1021`, replacing `0262:63-77`): per
  WO `order_net` (closing value when stamped, else value excl. tax), `invoiced` (submitted), `pending` (drafts +
  unraised claims), `paid` (billed work of Paid invoices only), `remaining` (= order_net − invoiced − pending),
  `figures_complete`, `line_count`, `unpaid_count` (submitted and not Paid).
- `sales_invoices.status` domain is `Draft`/`Submitted`/`Unpaid`/`Paid`/`Cancelled`
  (`0123_sales_incoming_payments_flip.sql:27-28`). **An invoice becomes `Paid` only when nothing is outstanding**:
  native invoices via `native_invoice_restate` (`0275_native_revenue.sql:158-176`, `Paid` iff gross − settled ≤
  0, else `Unpaid`); ERP-owned invoices via the mirrored `erp_outstanding_amount` (`0100_invoices_payments_flip.sql:56`).
  A partly paid invoice stays `Unpaid`.
- FE classification `deriveWorkOrderBillingState` (`pmo-portal/src/lib/workOrderBilling.ts:16-27`): `incomplete`,
  `over-invoiced`, `not-billable` (Draft/Cancelled), `not-invoiced`, `paid`, `awaiting-submission`,
  `fully-invoiced`, `partly-invoiced`; `canInvoiceWorkOrder` (`:29-31`) offers invoicing only on an Issued/Closed
  WO whose figures total and whose remaining > 0. Read via `listWorkOrderBilling`
  (`pmo-portal/src/lib/db/workOrderBilling.ts:92-120`) and `useWorkOrderBilling`
  (`pmo-portal/src/hooks/useWorkOrderBilling.ts:9-17`, key `['work-order-billing', orgId, projectId]`).

### 1.4 The existing invoice-from-work-order flow (the only write path this spec uses)
- On the project's **Contract & billing** area (`/projects/:id/contract`; legacy `/work-orders` and `/billing`
  map there, `pmo-portal/pages/project-detail/projectDetailAreas.ts:4-7`) each customer order card offers
  **Raise invoice** when `canRaiseOrderInvoice` (`WorkOrdersTab.tsx:802-803`): the WO is invoiceable, and either
  it has contract lines and progress claims are allowed (`canBill`, `:301`), or it has none and the user may
  create a sales invoice in a ready revenue route (`canInvoice`, `:276`).
- `raiseOrderInvoice` (`WorkOrdersTab.tsx:817-822`) opens **`ProgressClaimModal`** for a WO with lines
  (`:1435-1450`) or **`InvoiceWorkOrderModal`** otherwise (`:1416-1433`;
  `pmo-portal/pages/project-detail/InvoiceWorkOrderModal.tsx:17-24`: one Draft linked to the WO, pre-filled with
  what is left, the repository routing to ERP dispatch or the native RPC). The database refuses invoicing past
  the WO (`0262` §4-§6, SQLSTATE `BW001`).
- Arriving with `?wo=<id>` scrolls to and focuses that WO (`ProjectSections.tsx:128`, `WorkOrdersTab.tsx:313-321`).
  No query parameter opens the invoice flow today.

### 1.5 The project plan surfaces
- Overview → **Phase timeline** block `DeliveryBlock` (`pmo-portal/pages/project-detail/ProjectBlocks.tsx:389-433`),
  rendered in both Overview lenses (`ProjectSections.tsx:96`, `:107`); tooltips call it "the project phase plan"
  (`public/locales/en/project.json:493-497`). Tasks → **Timeline** view is the task Gantt
  (`pages/project-detail/tabs/TasksTab.tsx:830-837`, `ProjectGantt.tsx`), laned by phase.
- Neither shows any work order today (searched `ProjectBlocks.tsx`, `MilestoneStrip.tsx`, `ProjectGantt.tsx`,
  `src/lib/gantt/*`, `TasksTab.tsx` for `workOrder`/`work_order`: no hits).

### 1.6 The "Still to invoice" card
- `StillToInvoiceCard` (`pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx:19-128`), on the Finance
  dashboard (`FinanceDashboard.tsx:454`), gated `salesInvoice.view`. Reads `get_unbilled_work_orders`
  (`0262_billing_by_work_order.sql:631-661`; only definition — no later migration replaces it): Issued/Closed WOs on
  unarchived projects with figures complete and remaining > 0, top N by remaining, each row carrying
  `days_since_closed` (org-local date difference, `:638-641`). The card prints "Days since closed: N"
  (`StillToInvoiceCard.tsx:103-105`). **No acceptance age exists anywhere today** (searched `supabase/migrations`,
  `pmo-portal/src` for `acceptance_date` consumers outside the BAST UI: none compute an age).
- The same RPC feeds the company figure "Still to invoice on work orders" (`restructure/useCompanyFigures.ts:264`)
  and "Needs you" (`restructure/useNeedsYou.ts:135`); those read totals only and are unchanged here.

## 2. Scope

**In**
1. A **Billing milestones** block on the project Overview, directly after the Phase timeline, listing every
   non-cancelled work order of the project as a billing milestone: number/title, dates, value, billing status,
   days since acceptance not invoiced, and **Invoice this**.
2. A pure, tested mapping from the shipped per-WO billing figures to the four owner statuses (+ a fail-closed
   "Can't total").
3. A server-derived **acceptance age** per WO ("days since acceptance, not invoiced"), read-only, shown on the
   plan, on the WO card in Contract & billing, and on the Still-to-invoice card rows.
4. **Invoice this** = navigate to the WO in Contract & billing and open the **existing** flow (§1.4) for it.

**Out of scope**
- Any new table, column or stored status on `work_orders`; any "milestone" record duplicating a WO; any amount
  or billing status on `project_milestones` (phases) — OD-BILL-1 and the ruling's "no second entry".
- The phase→work-order display link (DD-BWO-12) — still a follow-up.
- Work-order bars or markers inside the task Gantt (OQ-WOMS-5).
- Any change to invoice creation, approval, submission, payment recording, the BW001 fence or SoD.
- A "part paid" status; dunning or reminders on the acceptance age; re-cutting the showreel (ruled not re-cut).
- Changing the company figure / Needs-you totals.

## 3. Terms

- **Billing milestone** — a work order as displayed on the plan. Same row, same id; not a record of its own.
- **Acceptance** — a `work_order_acceptances` row with `status = 'Confirmed'`. Its date is `acceptance_date`.
- **Submitted invoice (for the clock)** — a linked `sales_invoices` row with status in (`Submitted`,`Unpaid`,
  `Paid`) that is not a down payment (as classified by `sales_invoice_work_billed.is_down_payment`).
- **Acceptance anchor** — the earliest `acceptance_date` among the WO's Confirmed acceptances that is **later
  than** the latest `invoice_date` of any submitted invoice on the WO (all Confirmed acceptances if there is none).
  A submitted invoice with no `invoice_date` counts as dated after every acceptance (it stops every clock).
- **Acceptance age** — org-local today − anchor, in whole days, floored at 0. Exists only while the WO is Issued
  or Closed, its figures total, and something is not yet submitted-invoiced (`remaining + pending > 0`).

## 4. Functional requirements (EARS)

### Plan block
- **FR-WOMS-001** Where the viewer may see billing (`salesInvoice.view`), the project Overview (non-pipeline
  stages, both lenses) shall show a **Billing milestones** block immediately after the Phase timeline block.
- **FR-WOMS-002** The block shall list each of the project's work orders whose status is not `Cancelled`, one row
  per work order id, read from the same sources as Contract & billing (`useProjectWorkOrders`,
  `useWorkOrderBilling`); it shall never read or write any other record to represent a milestone.
- **FR-WOMS-003** Each row shall show: the WO number (or "Not issued yet") and title; the dates as
  `start_date – end_date` when either is set, else `Ordered <order_date>` when set, else "No dates"; the value =
  `order_net` excl. tax in the WO's currency with the shared excl.-tax basis label; the billing status
  (FR-WOMS-010); and the acceptance age (FR-WOMS-020) when one exists.
- **FR-WOMS-004** The block shall order rows by the milestone date `coalesce(end_date, start_date, order_date)`
  ascending, then `wo_number`, then `id`; rows with no date at all shall come last.
- **FR-WOMS-005** While either read is pending the block shall show its loading state; if either read fails it
  shall show an error state with retry, and shall never show a status, value or age it could not read
  (NFR-BWO-005 posture).
- **FR-WOMS-006** When the project has no non-cancelled work order, the block shall say so and link to Contract &
  billing.
- **FR-WOMS-007** Each row's WO number shall link to that WO in Contract & billing (`/projects/:id/contract?wo=<id>`).

### Billing status
- **FR-WOMS-010** The system shall derive the billing status from the WO status and its `work_order_billing` row,
  in this order, all money compared in integer cents:
  1. If `figures_complete` is false → **Can't total** (no other status shown).
  2. If WO status is `Draft`, or `invoiced + pending = 0` → **Planned**.
  3. If `remaining > 0` or `pending > 0` → **In progress**.
  4. If `unpaid_count > 0` → **Invoiced**.
  5. Otherwise → **Paid**.
- **FR-WOMS-011** When `remaining < 0`, the row shall additionally show the shipped **Over-invoiced** flag beside
  the status from FR-WOMS-010.
- **FR-WOMS-012** The status shall be derived on every read and never stored (DD-BWO-2, DD-WO-3).
- **FR-WOMS-013** When a payment is recorded that leaves a WO's last unpaid submitted invoice `Paid` (native
  receipt or ERP read-back) and nothing remains or is pending, the WO's status shall read **Paid** on the next read
  of its billing, with no further user action.

### Acceptance age
- **FR-WOMS-020** The system shall derive, server-side and on every read, each WO's acceptance age per §3, using
  the organisation's default time zone (falling back to UTC), the same rule `get_unbilled_work_orders` uses for
  `days_since_closed`.
- **FR-WOMS-021** Where a WO has an acceptance age, the plan row and the WO's card in Contract & billing shall show
  "Days since acceptance, not invoiced: N" (N = 0 shows as 0), with a tooltip naming its source (the earliest
  confirmed BAST not yet followed by a submitted invoice).
- **FR-WOMS-022** `get_unbilled_work_orders` shall return each row's `days_since_acceptance` (null when none), and
  the Still-to-invoice card shall show "Days since acceptance, not invoiced: N" on that row; it shall show "Days
  since closed: N" only on a row with no acceptance age.
- **FR-WOMS-023** When a submitted invoice dated on or after the anchor's date is recorded, or the WO is fully
  submitted-invoiced, the age shall disappear on the next read; a later Confirmed acceptance starts a new age from
  its own date.
- **FR-WOMS-024** A draft invoice, an unraised claim or a down-payment invoice shall not stop the age.

### Invoice this
- **FR-WOMS-030** Where the viewer may create a sales invoice and `canInvoiceWorkOrder` holds for the row, the row
  shall offer **Invoice this**.
- **FR-WOMS-031** When the viewer chooses Invoice this, the system shall navigate to
  `/projects/:id/contract?wo=<id>&invoice=1`; Contract & billing shall focus that WO (shipped behaviour) and, once
  its figures are read, run the **same** `raiseOrderInvoice` the card's Raise invoice button runs, opening
  `ProgressClaimModal` or `InvoiceWorkOrderModal` exactly as that button would.
- **FR-WOMS-032** If on arrival the full shipped gate (`canRaiseOrderInvoice`) does not hold for that WO, Contract &
  billing shall open nothing, focus the WO, and announce "This work order can't be invoiced from here right now."
  in a polite status region.
- **FR-WOMS-033** The system shall remove `invoice=1` from the URL once it has been acted on, so reload or Back does
  not reopen the dialog.
- **FR-WOMS-034** The plan shall introduce no new write path: every invoice or claim it leads to is created by the
  shipped modals, repository routes and RPCs, under the shipped BW001 fence and SoD.

## 5. Non-functional requirements
- **NFR-WOMS-001 Tenancy.** The new view is `security_invoker`, so RLS on `work_orders`, `work_order_acceptances`,
  `sales_invoices` and `organizations` scopes every row; anon has no SELECT; authenticated has SELECT only; no
  client-callable SECURITY DEFINER function is added. An isolation probe proves another org's rows never appear.
- **NFR-WOMS-002 One authority.** The acceptance age is computed only in SQL (one view); the FE never recomputes it.
  The status mapping is one pure FE function over the shipped view, unit-tested to the cent.
- **NFR-WOMS-003 Performance.** Project reads are one extra request per project (filtered by `project_id`); the
  dashboard adds a left join inside the existing RPC — no N+1, no extra round trip.
- **NFR-WOMS-004 Reversibility.** One additive migration with a rollback file restoring the `0262` §9 body verbatim.
- **NFR-WOMS-005 UI.** Shared primitives (`Card`, `StatusPill`, `TaxBasisLabel`, `Tooltip`, `ListState`,
  `Button`), `DESIGN.md` tokens, en + id copy, all states (loading/error/empty/ready), 390px with no horizontal
  scroll; `scripts/ux-proof.sh` clean on `/projects/:id/overview`, `/projects/:id/contract`, `/` (Finance).

## 6. Acceptance criteria (Given / When / Then)

- **AC-WOMS-001** *Given* a project with three work orders (Issued, Draft, Cancelled), *when* Finance opens the
  Overview, *then* the Billing milestones block lists the Issued and Draft ones (one row each, by id) and not the
  Cancelled one; *and* an Engineer (no `salesInvoice.view`) sees no block.
- **AC-WOMS-002** *Given* rows with (no dates at all), (start 2026-11-10 and end 2026-12-01), (order date
  2026-10-01 only), (start 2026-11-10 only), *then* they render as: order-date row ("Ordered" + the date), the
  start-only row, the start–end row, the undated row ("No dates"); each value is `order_net` with the excl.-tax
  basis.
- **AC-WOMS-003** *Given* billing rows, *then* the status is: figures incomplete → Can't total; Draft WO →
  Planned; invoiced 0 + pending 0 → Planned; remaining 100 → In progress; remaining 0 + pending 50 → In progress;
  remaining 0 + pending 0 + unpaid 1 → Invoiced; remaining 0 + pending 0 + unpaid 0 → Paid; remaining −10 +
  unpaid 1 → Invoiced + Over-invoiced; remaining 0.004 (rounds to 0 cents) + pending 0 + unpaid 0 → Paid.
- **AC-WOMS-004** *Given* a fully invoiced WO with one Unpaid invoice, *when* the remaining balance is recorded as
  received so the invoice becomes Paid, *then* `work_order_billing` for that WO has `unpaid_count = 0`,
  `remaining = 0`, `pending = 0` and the plan row reads Paid.
- **AC-WOMS-005** *Given* an Issued WO with a Confirmed acceptance dated 10 org-local days ago and no submitted
  invoice, *then* `work_order_uninvoiced_acceptance` returns days = 10 computed in the org's time zone (not UTC);
  *and given* a Draft invoice and a Paid down-payment invoice on it, *then* the days are still 10.
- **AC-WOMS-006** *Given* that WO, *when* a submitted invoice dated 5 org-local days ago is linked (remaining still
  > 0), *then* no row is returned; *when* a further Confirmed acceptance dated 2 days ago exists, *then* a row
  returns with days = 2 anchored on it; *and* a submitted invoice with no invoice date stops every clock.
- **AC-WOMS-007** *Given* a WO with acceptances but `figures_complete = false`, or status Draft/Cancelled, or
  `remaining + pending ≤ 0`, *then* no acceptance age is returned.
- **AC-WOMS-008** *Given* org A and org B each with an aged WO, *when* a user of org B reads the view or calls
  `get_unbilled_work_orders`, *then* only org B's rows appear; anon cannot select the view.
- **AC-WOMS-009** *Given* an aged Issued WO with remaining > 0, *then* `get_unbilled_work_orders(8)` returns its row
  with `days_since_acceptance` = the view's days, and a WO with no acceptance returns null for it; the existing
  `days_since_closed` is unchanged.
- **AC-WOMS-010** *Given* card rows with `daysSinceAcceptance` 12 and `daysSinceClosed` 3, *then* the row shows
  "Days since acceptance, not invoiced: 12" and not the closed count; a row with no acceptance age but closed 3
  days ago shows "Days since closed: 3".
- **AC-WOMS-011** *Given* an aged WO, *then* its card in Contract & billing and its plan row both show "Days since
  acceptance, not invoiced: N" with the source tooltip; a WO without one shows neither.
- **AC-WOMS-012** *Given* Finance on a native-revenue org with an Issued WO without contract lines and remaining
  > 0, *when* they choose Invoice this on the Overview plan, *then* they land on Contract & billing with that WO
  focused and the shipped invoice dialog open pre-filled with what is left; *when* they save, *then* the Draft is
  created linked to the WO and, back on the Overview, the row reads In progress. *(Curated journey.)*
- **AC-WOMS-013** *Given* `?wo=<id>&invoice=1` for a WO with contract lines, *then* `ProgressClaimModal` opens with
  that WO preselected; for one without lines `InvoiceWorkOrderModal` opens with its remaining; for one the user
  cannot invoice (no create permission, remaining 0, revenue route not ready, no client) nothing opens and the
  status message is announced; in every case `invoice` is removed from the URL.
- **AC-WOMS-014** *Given* a PM (can view, cannot create invoices), *then* the plan rows show status and value but
  no Invoice this.
- **AC-WOMS-015** *Given* any billing read pending or failed, *then* the block shows loading or error with retry and
  no status, value or age.

## 7. Traceability (owning layer, ADR-0010)

| AC | Owning layer | File (plan names the exact test titles) |
|---|---|---|
| 003 | Vitest (pure) | `pmo-portal/src/lib/billingMilestones.test.ts` |
| 001, 002, 014, 015 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/BillingMilestonesBlock.test.tsx` |
| 004 | pgTAP | `supabase/tests/<NNNN>_work_order_milestones.test.sql` |
| 005, 006, 007, 008, 009 | pgTAP | `supabase/tests/<NNNN>_work_order_milestones.test.sql` |
| 010 | Vitest/RTL | `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.test.tsx` |
| 011 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` (card) + BillingMilestonesBlock test (plan) |
| 013 | Vitest/RTL | `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` |
| 012 | Playwright | `pmo-portal/e2e/AC-WOMS-012-invoice-from-plan.spec.ts` |

## 8. Open questions (owner signs; each has a recommended default)

1. **OQ-WOMS-1 What does "In progress" mean — billing or delivery?** The reel's Planned/In progress was about the
   work. Recommended: **billing only** (FR-WOMS-010): In progress = something invoiced or drafted but not all of it
   submitted. Delivery progress already shows on the WO card (delivered quantities) and the urgency of accepted
   work shows as the acceptance age. Consequence: a Closed WO with nothing invoiced reads Planned + its age.
   Alternative: In progress also when a BAST is confirmed or `start_date` ≤ today.
2. **OQ-WOMS-2 Which date is "acceptance"?** The shipped model stores `acceptance_date` (the date on the BAST) and
   `confirmed_at` (when PMO recorded it). Recommended: **`acceptance_date`** — the client's acceptance is the
   billing trigger; `confirmed_at` would hide days lost before recording.
3. **OQ-WOMS-3 Partial invoices and stage BASTs — when does the clock reset?** Recommended: §3 anchor rule — a
   submitted invoice dated on/after an acceptance satisfies it; a later BAST starts a new clock; drafts, unraised
   claims and down payments never stop it. Alternative (simpler, literal "no invoice yet"): only until the first
   submitted invoice, ever.
4. **OQ-WOMS-4 Partial payments.** Shipped data marks an invoice Paid only when fully settled (`0275:158-176`;
   ERP outstanding 0). Recommended: **no "Part paid" status**; the WO stays Invoiced until every submitted invoice
   is Paid (DD-BWO-2). Part-payment amounts stay on Contract & billing.
5. **OQ-WOMS-5 Where is "the project plan"?** Recommended: the **Overview, directly under the Phase timeline**
   (the screen the product calls the phase plan) for v1; WO markers on Tasks › Timeline are a follow-up (they
   would need a non-phase lane in `buildGanttModel`).
6. **OQ-WOMS-6 WOs that can never have a BAST** (no contract lines): Recommended: no acceptance age; the card keeps
   "Days since closed" for them. A "days since issued" fallback is not added.
7. **OQ-WOMS-7 Action label.** Recommended: "Invoice this" on the plan (owner wording, id "Tagih ini"); Contract &
   billing keeps its shipped "Raise invoice". Both open the same flow.
8. **OQ-WOMS-8 Draft work orders on the plan.** Recommended: shown as **Planned** with "Not issued yet" (the client
   PO is expected); Cancelled hidden.

## 9. Follow-ups
Phase→WO display link (DD-BWO-12); WO markers on the task Gantt; acceptance-age threshold highlighting / reminders
(would ride the confirmed "Remind this person" from OD-GRILL-20261101); a part-paid display if OQ-WOMS-4 changes.
